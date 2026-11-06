import { z } from 'zod';
import { FilePurpose, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';

export const uploadQuery = z.object({ purpose: z.enum(vals(FilePurpose)).default('OTHER'), visibility: z.enum(['PRIVATE', 'SOCIETY']).default('PRIVATE'), societyId: z.string().regex(/^[a-f\d]{24}$/i).optional() });
export const fileItem = entity({ uploadedBy: z.string(), originalName: z.string(), mimeType: z.string(), size: z.number(), purpose: z.enum(vals(FilePurpose)), visibility: z.enum(['PRIVATE', 'SOCIETY']), checksum: z.string().optional() });
