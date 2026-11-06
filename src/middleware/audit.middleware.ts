import { RequestHandler } from 'express';
import { writeAudit } from '../modules/audit/audit.service';

export const auditTrail =
  (routePath: string, tag: string): RequestHandler =>
  (req, res, next) => {
    const impersonating = Boolean(req.auth.impersonationId);
    if (req.method === 'GET' && !impersonating) return next();
    res.on('finish', () => {
      if (res.statusCode >= 400 && !impersonating) return;
      writeAudit({
        actorId: req.auth.userId,
        actorRole: req.auth.userType,
        societyId: req.auth.societyId,
        action: `${req.method} ${routePath}`,
        entityType: tag,
        entityId: req.params.id,
        statusCode: res.statusCode,
        impersonationId: req.auth.impersonationId,
        ip: req.ip,
        requestId: req.requestId,
      }).catch(() => undefined);
    });
    next();
  };
