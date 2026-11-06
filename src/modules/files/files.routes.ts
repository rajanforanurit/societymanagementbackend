import fs from 'fs';
import { Request, Response } from 'express';
import { UserType } from '../../common/constants/enums';
import { ModuleRouter } from '../../common/openapi/router';
import { created } from '../../common/responses/respond';
import { idParam } from '../../common/validators/common';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRoles, requireSociety } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import { Resident } from '../resident/resident.model';
import { fileItem, uploadQuery } from './files.schema';
import { resolveFile, saveFile, uploadMiddleware } from './files.service';
import { registerOperation } from '../../common/openapi/registry';
import { z } from 'zod';

const ROLES = [UserType.SOCIETY_ADMIN, UserType.GUARD, UserType.RESIDENT];

export const filesRouter = new ModuleRouter('/api/v1/files', { tag: 'Files', tagDescription: 'Validated, tenant-scoped file storage (local disk)', roles: ROLES, societyScoped: true });

const pendingResidentSociety = async (req: Request, _res: Response, next: (e?: unknown) => void) => {
  try {
    const sid = req.query.societyId;
    if (!req.auth.societyId && req.auth.role === UserType.RESIDENT && typeof sid === 'string' && /^[a-f\d]{24}$/i.test(sid)) {
      const ok = await Resident.exists({ userId: req.auth.userId, societyId: sid, status: { $in: ['PENDING', 'APPROVED'] } });
      if (ok) req.auth.societyId = sid;
    }
    next();
  } catch (e) {
    next(e);
  }
};

filesRouter.router.post('/', authenticate, requireRoles(ROLES), pendingResidentSociety, requireSociety, uploadMiddleware, validate({ query: uploadQuery }), async (req: Request, res: Response, next) => {
  try {
    const f = await saveFile(req.auth.societyId!, req.auth.userId, req.file, req.valid.query);
    created(res, f, 'File uploaded');
  } catch (e) {
    next(e);
  }
});

registerOperation({ method: 'post', path: '/api/v1/files', tag: 'Files', summary: 'Upload a file (multipart/form-data, field "file")', description: 'Accepts JPEG, PNG, WebP or PDF up to MAX_UPLOAD_MB. Residents with a pending membership request may pass societyId to upload verification documents. The file signature is verified against the declared type. Use the returned id wherever a file reference is required.', auth: true, roles: ROLES, permissions: [], query: uploadQuery, response: fileItem, status: 201, errors: [400, 413], bodyExample: undefined, responseExample: undefined });

filesRouter.router.get('/:id', authenticate, requireRoles(ROLES), requireSociety, validate({ params: idParam }), async (req: Request, res: Response, next) => {
  try {
    const { file, fullPath } = await resolveFile(req.auth.societyId!, req.auth.userId, req.valid.params.id, req.auth.role === UserType.SOCIETY_ADMIN);
    if (!fs.existsSync(fullPath)) throw new Error('missing file on disk');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
    fs.createReadStream(fullPath).pipe(res);
  } catch (e) {
    next(e);
  }
});

registerOperation({ method: 'get', path: '/api/v1/files/:id', tag: 'Files', summary: 'Download a file', description: 'Streams the binary file. PRIVATE files are visible to the uploader and society admins only; SOCIETY files to all members.', auth: true, roles: ROLES, permissions: [], params: idParam, response: z.any(), status: 200, errors: [403, 404] });
