import { Request, Response } from 'express';
import { UserType } from '../../common/constants/enums';
import { adminListingRoutes, residentListingRoutes } from '../../common/openapi/listingRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { ApiError } from '../../common/utils/apiError';
import { paginate } from '../../common/utils/pagination';
import { idParam } from '../../common/validators/common';
import { createListingService } from '../marketplace/listing.factory';
import { VISIBLE_STATUSES } from '../approvals/approval.service';
import { chatService } from '../chat/chat.service';
import { notifyUsers } from '../notifications/notify.service';
import { PropertyInquiry, PropertyListing } from './property.model';
import * as s from './property.schema';

export const propertyService = createListingService({
  model: PropertyListing,
  modelName: 'PropertyListing',
  entityType: 'PROPERTY_LISTING',
  label: 'Property',
  typeField: 'propertyType',
  closedField: 'isClosed',
  searchFields: ['title', 'description', 'amenities'],
  filterable: ['propertyType', 'bedrooms', 'furnishing'],
  sortable: ['createdAt', 'price', 'publishedAt', 'areaSqft'],
});

const sid = (r: Request) => r.auth.societyId!;
const cfg = { path: '/property/listings', name: 'Property', svc: propertyService, body: s.propertyBody, item: s.propertyItem, browseQuery: s.propertyQuery, adminQuery: s.adminPropertyQuery, closeVerb: 'close', closeSummary: 'Mark property as sold / rented / closed' };

export const propertyResidentRouter = new ModuleRouter('/api/v1/user', {
  tag: 'Resident - Property',
  tagDescription: 'List and search properties for sale, rent, paying-guest/shared accommodation, commercial and vacant spaces',
  roles: [UserType.RESIDENT],
  societyScoped: true,
  feature: 'property',
});
residentListingRoutes(propertyResidentRouter, cfg);
propertyResidentRouter
  .add({ method: 'post', path: '/property/listings/:id/inquiries', summary: 'Express interest in a property', description: 'Notifies the owner and opens a chat conversation.', params: idParam, body: s.inquiryBody, response: s.inquiryItem, status: 201, errors: [409], handler: async (req: Request, res: Response) => {
    const l: any = await PropertyListing.findOne({ _id: req.valid.params.id, societyId: sid(req), status: { $in: VISIBLE_STATUSES }, isClosed: false });
    if (!l) throw ApiError.notFound('Property not found');
    if (String(l.sellerId) === req.auth.userId) throw ApiError.badRequest('You cannot enquire on your own listing');
    const conv: any = await chatService.start(sid(req), req.auth.userId, { recipientUserId: String(l.sellerId), contextType: 'PROPERTY_LISTING', contextId: String(l._id), message: req.valid.body.message });
    const inq = await PropertyInquiry.findOneAndUpdate({ societyId: sid(req), listingId: l._id, userId: req.auth.userId }, { $set: { message: req.valid.body.message, ownerId: l.sellerId, conversationId: conv._id }, $setOnInsert: { createdBy: req.auth.userId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    await notifyUsers({ societyId: sid(req), userIds: [l.sellerId], type: 'MARKETPLACE', title: 'New property inquiry', body: l.title, data: { listingId: String(l._id) }, event: 'property:inquiry' });
    created(res, inq, 'Inquiry sent');
  } })
  .add({ method: 'get', path: '/property/inquiries/received', summary: 'Interested buyers or tenants for my properties', query: s.inquiryQuery, response: s.inquiryItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await paginate(PropertyInquiry, { societyId: sid(req), ownerId: req.auth.userId, ...(req.valid.query.status ? { status: req.valid.query.status } : {}) }, req.valid.query)) })
  .add({ method: 'patch', path: '/property/inquiries/:id', summary: 'Update inquiry status', params: idParam, body: s.inquiryUpdate, response: s.inquiryItem, handler: async (req: Request, res: Response) => {
    const r = await PropertyInquiry.findOneAndUpdate({ _id: req.valid.params.id, societyId: sid(req), ownerId: req.auth.userId }, { $set: { status: req.valid.body.status } }, { new: true });
    if (!r) throw ApiError.notFound('Inquiry not found');
    ok(res, r, 'Updated');
  } });

export const propertyAdminRouter = new ModuleRouter('/api/v1/admin', {
  tag: 'Society Admin - Marketplace',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
  feature: 'property',
});
adminListingRoutes(propertyAdminRouter, cfg);
