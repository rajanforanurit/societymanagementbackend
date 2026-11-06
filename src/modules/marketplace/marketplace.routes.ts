import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { adminListingRoutes, residentListingRoutes } from '../../common/openapi/listingRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { crudController } from '../../common/services/crud.controller';
import { createCrudService } from '../../common/services/crud.service';
import { createListingService } from './listing.factory';
import { MarketplaceCategory, MarketplaceListing } from './marketplace.model';
import * as s from './marketplace.schema';

export const marketplaceService = createListingService({
  model: MarketplaceListing,
  modelName: 'MarketplaceListing',
  entityType: 'MARKETPLACE_LISTING',
  label: 'Listing',
  typeField: 'listingType',
  closedField: 'isSold',
  searchFields: ['title', 'description', 'tags'],
  filterable: ['listingType', 'categoryId', 'condition'],
  sortable: ['createdAt', 'price', 'publishedAt', 'viewCount'],
});

export const categoryService = createCrudService({ model: MarketplaceCategory, name: 'Category', searchFields: ['name'], sortable: ['order', 'name'], defaultSort: 'order' });

const cfg = { path: '/marketplace/listings', name: 'Listing', svc: marketplaceService, body: s.marketplaceBody, item: s.marketplaceItem, browseQuery: s.marketplaceQuery, adminQuery: s.adminListingQuery, closeVerb: 'mark-sold', closeSummary: 'Mark item as sold' };

export const marketplaceResidentRouter = new ModuleRouter('/api/v1/user', {
  tag: 'Resident - Marketplace',
  tagDescription: 'Buy & sell products, second-hand goods, local businesses and community announcements. Listings must be approved by an admin before other residents can see them.',
  roles: [UserType.RESIDENT],
  societyScoped: true,
  feature: 'marketplace',
});
residentListingRoutes(marketplaceResidentRouter, cfg);
marketplaceResidentRouter.add({ method: 'get', path: '/marketplace/categories', summary: 'Active listing categories', query: s.categoryQuery, response: s.categoryItem, paginated: true, handler: async (req, res) => {
  const r = await categoryService.list(req.auth.societyId!, req.valid.query, { isActive: true });
  res.json({ success: true, message: 'Success', data: r.items, meta: r.meta });
} });

export const marketplaceAdminRouter = new ModuleRouter('/api/v1/admin', {
  tag: 'Society Admin - Marketplace',
  tagDescription: 'Moderate resident listings, manage categories and expiry. Approval decisions go through the reusable /approvals workflow.',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
  feature: 'marketplace',
});
adminListingRoutes(marketplaceAdminRouter, cfg);
crudRoutes(marketplaceAdminRouter, { path: '/marketplace/categories', name: 'Category', plural: 'Categories', controller: crudController(categoryService, { label: 'Category' }), create: s.categoryBody, query: s.categoryQuery, item: s.categoryItem, read: [P.LISTING_MANAGE], write: [P.LISTING_MANAGE] });
