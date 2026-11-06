import { z } from 'zod';
import { DocumentCategory, DocumentScope, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { listQuery, objectId } from '../../common/validators/common';

export const docBody = z.object({ title: z.string().trim().min(2).max(150), description: z.string().max(500).optional(), category: z.enum(vals(DocumentCategory)).default('OTHER'), scope: z.enum(['SOCIETY', 'FLAT']).default('SOCIETY'), fileId: objectId, flatId: objectId.optional(), adminOnly: z.boolean().default(false) });
export const personalDocBody = z.object({ title: z.string().trim().min(2).max(150), description: z.string().max(500).optional(), category: z.enum(vals(DocumentCategory)).default('PERSONAL'), fileId: objectId });
export const docItem = entity({ title: z.string(), description: z.string().optional(), category: z.enum(vals(DocumentCategory)), scope: z.enum(vals(DocumentScope)), fileId: objectId, flatId: objectId.optional(), adminOnly: z.boolean() });
export const docQuery = listQuery.extend({ category: z.enum(vals(DocumentCategory)).optional(), scope: z.enum(vals(DocumentScope)).optional(), flatId: objectId.optional() });
