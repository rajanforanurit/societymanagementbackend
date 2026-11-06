import { z } from 'zod';
import { Furnishing, InquiryStatus, PropertyListingType, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateOnly, listQuery, money, objectId } from '../../common/validators/common';
import { commonItem, listingCommonBody } from '../marketplace/marketplace.schema';

const pType = z.enum(vals(PropertyListingType));
export const propertyBody = z.object({
  ...listingCommonBody,
  propertyType: pType,
  price: money,
  deposit: money.optional(),
  maintenanceCharges: money.optional(),
  bedrooms: z.number().int().min(0).max(20).optional(),
  bathrooms: z.number().int().min(0).max(20).optional(),
  areaSqft: z.number().min(1).max(1000000).optional(),
  furnishing: z.enum(vals(Furnishing)).optional(),
  floorNumber: z.number().int().optional(),
  availableFrom: dateOnly.optional(),
  preferredTenants: z.string().max(200).optional(),
  amenities: z.array(z.string().max(40)).max(30).default([]),
  parkingIncluded: z.boolean().default(false),
});
export const propertyItem = entity({ ...commonItem, propertyType: pType, price: z.number(), deposit: z.number().optional(), maintenanceCharges: z.number().optional(), bedrooms: z.number().optional(), bathrooms: z.number().optional(), areaSqft: z.number().optional(), furnishing: z.string().optional(), amenities: z.array(z.string()), isClosed: z.boolean() });
export const propertyQuery = listQuery.extend({ propertyType: pType.optional(), minPrice: z.coerce.number().min(0).optional(), maxPrice: z.coerce.number().min(0).optional(), bedrooms: z.coerce.number().int().optional(), furnishing: z.enum(vals(Furnishing)).optional() });
export const inquiryBody = z.object({ message: z.string().trim().min(3).max(1000) });
export const inquiryItem = entity({ listingId: objectId, ownerId: objectId, userId: objectId, message: z.string(), status: z.enum(vals(InquiryStatus)), conversationId: objectId.optional() });
export const inquiryQuery = listQuery.extend({ status: z.enum(vals(InquiryStatus)).optional() });
export const inquiryUpdate = z.object({ status: z.enum(vals(InquiryStatus)) });
import { ApprovalStatus } from '../../common/constants/enums';
export const adminPropertyQuery = propertyQuery.extend({ status: z.enum(vals(ApprovalStatus)).optional() });
