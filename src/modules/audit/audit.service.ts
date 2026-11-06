import { ClientSession } from 'mongoose';
import { AuditLog } from './audit.model';
import { logger } from '../../common/utils/logger';

export interface AuditEntry {
  actorId?: string;
  actorRole?: string;
  societyId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  statusCode?: number;
  impersonationId?: string;
  ip?: string;
  requestId?: string;
}

export async function writeAudit(entry: AuditEntry, session?: ClientSession) {
  try {
    await AuditLog.create([entry as any], { session });
  } catch (err) {
    logger.error('audit_write_failed', { action: entry.action, error: (err as Error).message });
    if (session) throw err;
  }
}
