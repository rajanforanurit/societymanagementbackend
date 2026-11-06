import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodType } from 'zod';
import { ApiError } from '../common/utils/apiError';

export const validate = (schemas: { params?: ZodType; query?: ZodType; body?: ZodType }): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const issues: unknown[] = [];
    const out: Request['valid'] = { body: req.body, query: req.query, params: req.params };
    (['params', 'query', 'body'] as const).forEach((loc) => {
      const schema = schemas[loc];
      if (!schema) return;
      const result = schema.safeParse(req[loc] ?? {});
      if (result.success) out[loc] = result.data;
      else
        result.error.issues.forEach((i) =>
          issues.push({ location: loc, path: i.path.join('.'), message: i.message, code: i.code }),
        );
    });
    if (issues.length) return next(ApiError.validation(issues));
    req.valid = out;
    next();
  };
};
