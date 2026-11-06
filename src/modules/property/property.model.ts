import { Furnishing, InquiryStatus, PropertyListingType, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';
import { listingCommon } from '../marketplace/marketplace.model';

export const PropertyListing = defineModel(
  'PropertyListing',
  makeSchema(
    {
      ...listingCommon,
      propertyType: { type: String, enum: vals(PropertyListingType), required: true, index: true },
      price: { type: Number, required: true, min: 0 },
      deposit: Number,
      maintenanceCharges: Number,
      bedrooms: Number,
      bathrooms: Number,
      areaSqft: Number,
      furnishing: { type: String, enum: vals(Furnishing) },
      floorNumber: Number,
      availableFrom: Date,
      preferredTenants: String,
      amenities: [String],
      parkingIncluded: { type: Boolean, default: false },
      isClosed: { type: Boolean, default: false },
      closedAt: Date,
      isSold: { type: Boolean, default: false },
    },
    { indexes: [[{ societyId: 1, status: 1, isClosed: 1, createdAt: -1 }], [{ societyId: 1, propertyType: 1, price: 1 }], [{ societyId: 1, expiresAt: 1 }]] },
  ),
);

export const PropertyInquiry = defineModel(
  'PropertyInquiry',
  makeSchema(
    { listingId: refReq('PropertyListing', { index: true }), ownerId: refReq('User', { index: true }), userId: refReq('User'), message: { type: String, required: true, maxlength: 1000 }, status: { type: String, enum: vals(InquiryStatus), default: 'NEW' }, conversationId: ref('Conversation') },
    { indexes: [[{ societyId: 1, listingId: 1, userId: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);
