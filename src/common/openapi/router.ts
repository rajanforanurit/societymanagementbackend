import { Request, RequestHandler, Response, Router } from 'express';
import { ZodType } from 'zod';
import { FeatureKey, UserType } from '../constants/enums';
import { auditTrail } from '../../middleware/audit.middleware';
import { authenticate } from '../../middleware/auth.middleware';
import { requirePermissions } from '../../middleware/permission.middleware';
import { requireFeature, requireRoles, requireSociety } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import { describeTag, HttpMethod, registerOperation } from './registry';

export interface RouteDef {
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  tag?: string;
  roles?: UserType[];
  permissions?: string[];
  feature?: FeatureKey;
  societyScoped?: boolean;
  public?: boolean;
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
  response?: ZodType | null;
  paginated?: boolean;
  status?: number;
  limiter?: RequestHandler;
  bodyExample?: unknown;
  responseExample?: unknown;
  errors?: number[];
  handler: (req: Request, res: Response) => unknown;
}

export interface RouterDefaults {
  tag: string;
  tagDescription?: string;
  roles: UserType[];
  societyScoped?: boolean;
  feature?: FeatureKey;
}

export class ModuleRouter {
  readonly router = Router();

  constructor(
    readonly prefix: string,
    private readonly defaults: RouterDefaults,
  ) {
    if (defaults.tagDescription) describeTag(defaults.tag, defaults.tagDescription);
  }

  add(def: RouteDef) {
    const tag = def.tag ?? this.defaults.tag;
    const roles = def.roles ?? this.defaults.roles;
    const societyScoped = def.societyScoped ?? this.defaults.societyScoped ?? false;
    const feature = def.feature ?? this.defaults.feature;
    const permissions = def.permissions ?? [];
    const fullPath = `${this.prefix}${def.path === '/' ? '' : def.path}`;
    const chain: RequestHandler[] = [];
    if (def.limiter) chain.push(def.limiter);
    if (!def.public) {
      chain.push(authenticate, requireRoles(roles));
      if (societyScoped) chain.push(requireSociety);
      if (feature) chain.push(requireFeature(feature));
      if (permissions.length) chain.push(requirePermissions(permissions));
      chain.push(auditTrail(fullPath, tag));
    }
    if (def.params || def.query || def.body) chain.push(validate({ params: def.params, query: def.query, body: def.body }));
    chain.push((req, res, next) => {
      Promise.resolve(def.handler(req, res)).catch(next);
    });
    this.router[def.method](def.path, ...chain);
    registerOperation({
      method: def.method,
      path: fullPath,
      tag,
      summary: def.summary,
      description: def.description,
      auth: !def.public,
      roles,
      permissions,
      feature,
      params: def.params,
      query: def.query,
      body: def.body,
      response: def.response === undefined ? null : def.response,
      paginated: def.paginated,
      status: def.status ?? 200,
      bodyExample: def.bodyExample,
      responseExample: def.responseExample,
      errors: def.errors ?? [],
    });
    return this;
  }
}
