import { z } from 'zod';
import { ApprovalStatus, ItemCondition, MarketplaceListingType, ReportStatus, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateTime, listQuery, money, objectId } from '../../common/validators/common';

export const listingCommonBody = {
  flatId: objectId.optional(),
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().min(10).max(5000),
  images: z.array(objectId).max(10).default([]),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
};
export const commonItem = {
  sellerId: z.any(),
  flatLabel: z.string().optional(),
  title: z.string(),
  description: z.string(),
  images: z.array(objectId),
  tags: z.array(z.string()),
  status: z.enum(vals(ApprovalStatus)),
  rejectionReason: z.string().optional(),
  publishedAt: dateTime.optional(),
  expiresAt: dateTime.optional(),
  reportCount: z.number().int(),
  viewCount: z.number().int(),
  favouriteCount: z.number().int(),
};

const lType = z.enum(vals(MarketplaceListingType));
export const marketplaceBody = z.object({ ...listingCommonBody, listingType: lType, categoryId: objectId.optional(), price: money.optional(), negotiable: z.boolean().default(true), condition: z.enum(vals(ItemCondition)).optional(), contactPreference: z.enum(['CHAT', 'CALL']).default('CHAT') });
export const marketplaceItem = entity({ ...commonItem, listingType: lType, categoryId: objectId.optional(), price: z.number().optional(), currency: z.string(), negotiable: z.boolean(), condition: z.string().optional(), isSold: z.boolean(), soldAt: dateTime.optional() });
export const marketplaceQuery = listQuery.extend({ listingType: lType.optional(), categoryId: objectId.optional(), minPrice: z.coerce.number().min(0).optional(), maxPrice: z.coerce.number().min(0).optional(), condition: z.enum(vals(ItemCondition)).optional() });
export const myListingQuery = listQuery.extend({ status: z.enum(vals(ApprovalStatus)).optional() });
export const adminListingQuery = marketplaceQuery.extend({ status: z.enum(vals(ApprovalStatus)).optional() });
export const adminListingUpdate = z.object({ title: z.string().trim().min(3).max(150), description: z.string().trim().min(10).max(5000), images: z.array(objectId).max(10), tags: z.array(z.string()).max(10), moderationNotes: z.string().max(500), categoryId: objectId, price: money }).partial();
export const reportBody = z.object({ reason: z.string().trim().min(3).max(100), details: z.string().max(500).optional() });
export const reportQuery = listQuery.extend({ status: z.enum(vals(ReportStatus)).optional() });
export const reportItem = entity({ listingId: objectId, listingModel: z.string(), reportedBy: objectId, reason: z.string(), details: z.string().optional(), status: z.enum(vals(ReportStatus)) });

export const categoryBody = z.object({ name: z.string().trim().min(2).max(60), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/), parentId: objectId.optional(), order: z.number().int().default(0), isActive: z.boolean().default(true), expiryDays: z.number().int().min(1).max(365).optional() });
export const categoryItem = entity({ name: z.string(), slug: z.string(), parentId: objectId.optional(), order: z.number().int(), isActive: z.boolean(), expiryDays: z.number().int().optional() });
export const categoryQuery = listQuery;
