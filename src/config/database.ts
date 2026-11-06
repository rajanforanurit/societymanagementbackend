import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../common/utils/logger';

export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, { autoIndex: !env.isProd, serverSelectionTimeoutMS: 10000 });
  const admin = mongoose.connection.db!.admin();
  const info: any = await admin.command({ hello: 1 });
  const supportsTransactions = Boolean(info.setName) || info.msg === 'isdbgrid';
  if (env.ENABLE_TRANSACTIONS && !supportsTransactions) {
    logger.warn('transactions_unavailable', { hint: 'MongoDB must run as a replica set. Use docker compose up -d or set ENABLE_TRANSACTIONS=false for local standalone dev.' });
  }
  logger.info('mongodb_connected', { name: mongoose.connection.name, replicaSet: info.setName ?? null });
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
