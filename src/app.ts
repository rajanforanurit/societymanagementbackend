import cors from 'cors';
import express, { Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { mountDocs } from './config/swagger';
import { errorHandler, notFoundHandler, requestContext } from './middleware/error.middleware';
import { globalLimiter } from './middleware/rateLimit.middleware';
import { allRouters } from './routes';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestContext);
  app.use((req, res, next) => (req.path.startsWith('/api-docs') ? next() : helmet()(req, res, next)));
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(globalLimiter);

  app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } }));
  allRouters.forEach((r) => app.use(r.prefix, r.router));
  mountDocs(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
