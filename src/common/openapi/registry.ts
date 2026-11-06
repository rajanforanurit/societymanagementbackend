import { z, ZodType } from 'zod';
import { env } from '../../config/env';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface OperationDoc {
  method: HttpMethod;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  auth: boolean;
  roles: string[];
  permissions: string[];
  feature?: string;
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
  response?: ZodType | null;
  paginated?: boolean;
  status: number;
  bodyExample?: unknown;
  responseExample?: unknown;
  errors: number[];
}

const operations: OperationDoc[] = [];
const tagDescriptions = new Map<string, string>();

export const registerOperation = (op: OperationDoc) => {
  operations.push(op);
};
export const describeTag = (tag: string, description: string) => {
  if (!tagDescriptions.has(tag)) tagDescriptions.set(tag, description);
};
export const registeredOperations = () => operations;

export const toJsonSchema = (schema: ZodType, io: 'input' | 'output'): any => {
  const js: any = z.toJSONSchema(schema, { io, unrepresentable: 'any' });
  delete js.$schema;
  return js;
};

const exampleString = (js: any, name = '') => {
  const n = name.toLowerCase();
  if (js.pattern && String(js.pattern).includes('{24}')) return '64f1c0a2b3c4d5e6f7a8b9c0';
  if (js.format === 'date-time') return '2026-11-02T10:30:00.000Z';
  if (js.format === 'date') return '2026-11-02';
  if (js.format === 'email' || n.includes('email')) return 'user@example.com';
  if (js.format === 'uri' || js.format === 'url' || n.includes('url')) return 'https://example.com/resource';
  if (js.pattern && String(js.pattern).includes('[01]\\d|2[0-3]')) return '09:00';
  if (n.includes('mobile') || n.includes('phone') || n.includes('identifier')) return '+919876543210';
  if (n.includes('password')) return 'Passw0rd!23';
  if (n.includes('otp')) return '123456';
  if (n.includes('token')) return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
  if (n === 'name' || n.endsWith('name')) return 'Sample name';
  const min = js.minLength ?? 0;
  return 'string'.padEnd(Math.max(min, 6), 'x');
};

export const exampleOf = (js: any, name = '', depth = 0): any => {
  if (!js || depth > 6) return null;
  if (js.example !== undefined) return js.example;
  if (js.const !== undefined) return js.const;
  if (js.enum) return js.enum[0];
  if (js.default !== undefined) return js.default;
  if (js.anyOf || js.oneOf) {
    const list = js.anyOf ?? js.oneOf;
    return exampleOf(list.find((x: any) => x.type !== 'null') ?? list[0], name, depth + 1);
  }
  if (js.allOf) return Object.assign({}, ...js.allOf.map((x: any) => exampleOf(x, name, depth + 1)));
  const type = Array.isArray(js.type) ? js.type.find((t: string) => t !== 'null') : js.type;
  switch (type) {
    case 'string':
      return exampleString(js, name);
    case 'integer':
      return Math.max(js.minimum ?? 1, 1);
    case 'number':
      return js.minimum !== undefined && js.minimum > 1 ? js.minimum : 100;
    case 'boolean':
      return true;
    case 'array':
      return depth > 4 ? [] : [exampleOf(js.items, name, depth + 1)];
    case 'object': {
      if (!js.properties) return {};
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries<any>(js.properties)) out[k] = exampleOf(v, k, depth + 1);
      return out;
    }
    default:
      return null;
  }
};

const paramsOf = (schema: ZodType | undefined, where: 'query' | 'path') => {
  if (!schema) return [];
  const js = toJsonSchema(schema, 'input');
  const required = new Set<string>(js.required ?? []);
  return Object.entries<any>(js.properties ?? {}).map(([name, s]) => ({
    name,
    in: where,
    required: where === 'path' || required.has(name),
    description: s.description,
    schema: s,
    example: exampleOf(s, name),
  }));
};

const errorRef = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
});

const ERROR_TEXT: Record<number, string> = {
  400: 'Bad request',
  401: 'Missing, invalid or expired access token',
  403: 'Authenticated but not permitted (role, permission, feature flag or tenant)',
  404: 'Resource not found in the caller\'s society',
  409: 'Conflict with current resource state',
  422: 'Request validation failed',
  429: 'Rate limit exceeded',
  500: 'Unexpected server error',
};

export const toOpenApiPath = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

export const buildOpenApi = () => {
  const paths: Record<string, any> = {};
  for (const op of operations) {
    const key = toOpenApiPath(op.path);
    paths[key] ??= {};
    const access = [
      op.auth ? `Required role: ${op.roles.join(' | ')}.` : 'Public endpoint (no authentication).',
      op.permissions.length ? `Required permissions: ${op.permissions.join(', ')}.` : '',
      op.feature ? `Requires society feature: ${op.feature}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const parameters = [...paramsOf(op.params, 'path'), ...paramsOf(op.query, 'query')];
    const dataSchema = op.response ? toJsonSchema(op.response, 'output') : { type: 'null' };
    const success: any = {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean', const: true },
        message: { type: 'string' },
        data: op.paginated ? { type: 'array', items: dataSchema } : dataSchema,
        ...(op.paginated ? { meta: { $ref: '#/components/schemas/PaginationMeta' } } : {}),
      },
    };
    const responseExample = {
      success: true,
      message: 'Success',
      data: op.responseExample ?? (op.paginated ? [exampleOf(dataSchema)] : exampleOf(dataSchema)),
      ...(op.paginated ? { meta: { page: 1, limit: 20, total: 1, totalPages: 1 } } : {}),
    };
    const responses: Record<string, any> = {
      [String(op.status)]: {
        description: 'Successful response',
        content: { 'application/json': { schema: success, example: responseExample } },
      },
    };
    const codes = new Set<number>([...op.errors, 500]);
    if (op.auth) [401, 403].forEach((c) => codes.add(c));
    if (op.params) codes.add(404);
    if (op.body || op.query) codes.add(422);
    codes.add(429);
    [...codes].sort().forEach((c) => (responses[String(c)] = errorRef(ERROR_TEXT[c] ?? 'Error')));

    const operation: any = {
      tags: [op.tag],
      summary: op.summary,
      description: [op.description, access].filter(Boolean).join('\n\n'),
      operationId: `${op.method}_${key.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
      security: op.auth ? [{ bearerAuth: [] }] : [],
      'x-required-role': op.roles,
      'x-required-permissions': op.permissions,
      responses,
    };
    if (parameters.length) operation.parameters = parameters;
    if (op.body) {
      const bodySchema = toJsonSchema(op.body, 'input');
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: bodySchema, example: op.bodyExample ?? exampleOf(bodySchema) } },
      };
    }
    paths[key][op.method] = operation;
  }

  const tags = [...new Set(operations.map((o) => o.tag))].sort().map((name) => ({ name, description: tagDescriptions.get(name) }));
  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'Society Management Platform API',
      version: '1.0.0',
      description:
        'Multi-tenant society management backend. Every society is an isolated tenant; the society context is carried in the JWT, never in client-supplied identifiers. Authenticate via /api/v1/auth/login and use the returned access token as a Bearer token.',
    },
    servers: [{ url: `http://localhost:${env.PORT}`, description: 'Local development' }],
    tags,
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        PaginationMeta: {
          type: 'object',
          required: ['page', 'limit', 'total', 'totalPages'],
          properties: {
            page: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1 },
            total: { type: 'integer', minimum: 0 },
            totalPages: { type: 'integer', minimum: 1 },
          },
        },
        ErrorResponse: {
          type: 'object',
          required: ['success', 'error'],
          properties: {
            success: { type: 'boolean', const: false },
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', examples: ['VALIDATION_ERROR'] },
                message: { type: 'string' },
                details: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { location: { type: 'string' }, path: { type: 'string' }, message: { type: 'string' }, code: { type: 'string' } },
                  },
                },
              },
            },
            requestId: { type: 'string', format: 'uuid' },
          },
          example: {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ location: 'body', path: 'mobile', message: 'Invalid mobile number', code: 'invalid_format' }] },
            requestId: '0b7e2f0e-5f43-4f7a-a1a6-0e1c2a9f4b11',
          },
        },
      },
    },
  };
};
