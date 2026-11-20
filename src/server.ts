import http from 'http';
import { logger } from './common/utils/logger';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { createApp } from './app';
import { startScheduler } from './jobs/scheduler';
import { syncSystemRoles } from './modules/roles/roles.sync';
import { callService } from './modules/calls/call.service';
import { initSocket } from './realtime/socket';

async function main() {
  await connectDatabase();
  await syncSystemRoles().catch((e) => logger.error('role_sync_failed', { error: String(e) }));
  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  const stopScheduler = env.SCHEDULER_ENABLED ? startScheduler() : () => undefined;

  const callSweep = setInterval(() => void callService.sweep().catch(() => undefined), 30000);
  callSweep.unref();

  server.listen(env.PORT, () => {
    logger.info('server_started', { port: env.PORT, docs: `http://localhost:${env.PORT}/api-docs`, openapi: `http://localhost:${env.PORT}/api-docs.json` });
  });

  const shutdown = async (signal: string) => {
    logger.info('shutdown', { signal });
    stopScheduler();
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error('unhandled_rejection', { reason: String(reason) }));
}

main().catch((err) => {
  logger.error('startup_failed', { error: err.message });
  process.exit(1);
});
