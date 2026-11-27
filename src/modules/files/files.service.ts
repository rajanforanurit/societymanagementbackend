import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { ApiError } from '../../common/utils/apiError';
import { randomToken, sha256 } from '../../common/utils/crypto';
import { env } from '../../config/env';
import { AdminProfile } from '../admin/admin.model';
import { User } from '../auth/auth.model';
import { CommunityPost } from '../community/community.model';
import { Resident } from '../resident/resident.model';
import { File } from './files.model';

const dir = path.resolve(env.UPLOAD_DIR);
fs.mkdirSync(dir, { recursive: true });

const ALLOWED: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };

const signatures: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/png': (b) => b.subarray(0, 4).toString('hex') === '89504e47',
  'image/webp': (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 4).toString() === '%PDF',
};

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (ALLOWED[file.mimetype] ? cb(null, true) : cb(ApiError.badRequest('Only JPEG, PNG, WebP and PDF files are allowed', 'UNSUPPORTED_FILE_TYPE') as any)),
}).single('file');

export async function saveFile(societyId: string, userId: string, file: Express.Multer.File | undefined, opts: { purpose: string; visibility: string }) {
  if (!file) throw ApiError.badRequest('A "file" field is required', 'FILE_REQUIRED');
  if (!signatures[file.mimetype]?.(file.buffer)) throw ApiError.badRequest('File content does not match its declared type', 'FILE_SIGNATURE_MISMATCH');
  const storageName = `${randomToken(16)}${ALLOWED[file.mimetype]}`;
  await fs.promises.writeFile(path.join(dir, storageName), file.buffer, { mode: 0o640 });
  const safeName = path.basename(file.originalname).replace(/[^\w.\- ]/g, '_').slice(0, 120);
  const [doc] = await File.create([{ societyId, uploadedBy: userId, createdBy: userId, originalName: safeName, mimeType: file.mimetype, size: file.size, storageName, checksum: sha256(file.buffer.toString('base64')), purpose: opts.purpose, visibility: opts.visibility }]);
  return doc;
}

async function isSocietyMember(societyId: string, userId: unknown) {
  if (await Resident.exists({ societyId, userId, status: 'APPROVED' })) return true;
  return Boolean(await AdminProfile.exists({ societyId, userId, status: 'ACTIVE' }));
}

async function findAvatarElsewhere(societyId: string, id: string) {
  const file: any = await File.findOne({ _id: id, purpose: 'PROFILE' }).select('+storageName').setOptions({ skipTenantCheck: true });
  if (!file) return null;
  if (!(await User.exists({ _id: file.uploadedBy, avatarFileId: file._id }))) return null;
  return (await isSocietyMember(societyId, file.uploadedBy)) ? file : null;
}

async function canSeePrivate(societyId: string, userId: string, file: any, isAdmin: boolean) {
  if (isAdmin || String(file.uploadedBy) === userId) return true;
  if (file.purpose === 'PROFILE') return true;
  return Boolean(await CommunityPost.exists({ societyId, images: file._id, status: { $in: ['APPROVED', 'PUBLISHED'] } }));
}

export async function resolveFile(societyId: string, userId: string, id: string, isAdmin: boolean) {
  const file: any = (await File.findOne({ _id: id, societyId }).select('+storageName')) ?? (await findAvatarElsewhere(societyId, id));
  if (!file) throw ApiError.notFound('File not found');
  if (file.visibility === 'PRIVATE' && !(await canSeePrivate(societyId, userId, file, isAdmin))) throw ApiError.forbidden('You cannot access this file', 'FILE_FORBIDDEN');
  return { file, fullPath: path.join(dir, file.storageName) };
}
