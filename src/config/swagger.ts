import { Express, Request, Response, NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApi } from '../common/openapi/registry';

let cached: ReturnType<typeof buildOpenApi> | undefined;
export const getOpenApiSpec = () => (cached ??= buildOpenApi());

export function mountDocs(app: Express) {
  app.get('/api-docs.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(getOpenApiSpec()));
  });
  app.use('/api-docs', swaggerUi.serve, (req: Request, res: Response, next: NextFunction) =>
    swaggerUi.setup(getOpenApiSpec() as any, {
      customSiteTitle: 'Society Management API',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true, docExpansion: 'none', filter: true, tagsSorter: 'alpha' },
    })(req, res, next),
  );
}
