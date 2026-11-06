import { Request } from 'express';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { ApiError } from '../../common/utils/apiError';
import { crudController } from '../../common/services/crud.controller';
import { createCrudService } from '../../common/services/crud.service';
import { File } from '../files/files.model';
import { Document } from './document.model';
import * as s from './document.schema';

export const documentService = createCrudService({ model: Document, name: 'Document', searchFields: ['title', 'description'], filterable: ['category', 'scope', 'flatId'], sortable: ['createdAt', 'title'] });

const ensureFile = async (societyId: string, fileId: string) => {
  if (!(await File.exists({ _id: fileId, societyId }))) throw ApiError.badRequest('File not found', 'FILE_NOT_FOUND');
};

export const documentAdminRouter = new ModuleRouter('/api/v1/admin/documents', { tag: 'Society Admin - Documents', tagDescription: 'Society document repository (bylaws, minutes, policies, flat documents)', roles: [UserType.SOCIETY_ADMIN], societyScoped: true, feature: 'documents' });
crudRoutes(documentAdminRouter, {
  path: '/',
  name: 'Document',
  controller: crudController(documentService, {
    label: 'Document',
    scope: () => ({ scope: { $in: ['SOCIETY', 'FLAT'] } }),
    prepare: (_r, b) => {
      if (b.scope === 'FLAT' && !b.flatId) throw ApiError.badRequest('flatId is required for FLAT scope', 'FLAT_REQUIRED');
      return b;
    },
  }),
  create: s.docBody,
  query: s.docQuery,
  item: s.docItem,
  read: [P.DOCUMENT_MANAGE],
  write: [P.DOCUMENT_MANAGE],
});

const residentScope = (r: Request) => ({ $or: [{ scope: 'SOCIETY', adminOnly: false }, { scope: 'FLAT', flatId: { $in: r.auth.flatIds } }, { scope: 'PERSONAL', ownerUserId: r.auth.userId }] });

export const documentResidentRouter = new ModuleRouter('/api/v1/user/documents', { tag: 'Resident - Documents', tagDescription: 'Society documents, flat documents and personal records', roles: [UserType.RESIDENT], societyScoped: true, feature: 'documents' });
crudRoutes(documentResidentRouter, {
  path: '/',
  name: 'Document',
  controller: {
    ...crudController(documentService, { label: 'Document', scope: residentScope }),
    create: async (req, res) => {
      await ensureFile(req.auth.societyId!, req.valid.body.fileId);
      const doc = await documentService.create(req.auth.societyId!, req.auth.userId, { ...req.valid.body, scope: 'PERSONAL', ownerUserId: req.auth.userId });
      res.status(201).json({ success: true, message: 'Document saved', data: doc });
    },
    update: async (req, res) => {
      const doc = await documentService.update(req.auth.societyId!, req.valid.params.id, req.auth.userId, req.valid.body, { scope: 'PERSONAL', ownerUserId: req.auth.userId });
      res.json({ success: true, message: 'Document updated', data: doc });
    },
    remove: async (req, res) => {
      await documentService.remove(req.auth.societyId!, req.valid.params.id, req.auth.userId, { scope: 'PERSONAL', ownerUserId: req.auth.userId });
      res.json({ success: true, message: 'Document deleted', data: null });
    },
  },
  create: s.personalDocBody,
  query: s.docQuery,
  item: s.docItem,
});
