import { ApprovalStatus, ItemCondition, MarketplaceListingType, ReportStatus, vals } from '../../common/constants/enums';
import { Schema } from 'mongoose';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const listingCommon = {
  sellerId: refReq('User', { index: true }),
  flatId: ref('Flat'),
  flatLabel: String,
  title: { type: String, required: true, trim: true, maxlength: 150 },
  description: { type: String, required: true, maxlength: 5000 },
  images: [ref('File')],
  tags: [{ type: String, lowercase: true, trim: true }],
  status: { type: String, enum: vals(ApprovalStatus), default: 'DRAFT', index: true },
  rejectionReason: String,
  moderationNotes: String,
  publishedAt: Date,
  expiresAt: Date,
  reportCount: { type: Number, default: 0 },
  viewCount: { type: Number, default: 0 },
  favouriteCount: { type: Number, default: 0 },
};

export const MarketplaceCategory = defineModel(
  'MarketplaceCategory',
  makeSchema(
    { name: { type: String, required: true, trim: true }, slug: { type: String, required: true, lowercase: true }, parentId: ref('MarketplaceCategory'), order: { type: Number, default: 0 }, isActive: { type: Boolean, default: true }, expiryDays: Number },
    { indexes: [[{ societyId: 1, slug: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);

export const MarketplaceListing = defineModel(
  'MarketplaceListing',
  makeSchema(
    {
      ...listingCommon,
      listingType: { type: String, enum: vals(MarketplaceListingType), required: true, index: true },
      categoryId: ref('MarketplaceCategory', { index: true }),
      price: { type: Number, min: 0 },
      currency: { type: String, default: 'INR' },
      negotiable: { type: Boolean, default: true },
      condition: { type: String, enum: vals(ItemCondition) },
      isSold: { type: Boolean, default: false },
      soldAt: Date,
      contactPreference: { type: String, enum: ['CHAT', 'CALL'], default: 'CHAT' },
    },
    { indexes: [[{ societyId: 1, status: 1, isSold: 1, createdAt: -1 }], [{ societyId: 1, title: 'text', description: 'text' }], [{ societyId: 1, expiresAt: 1 }]] },
  ),
);

export const FavouriteListing = defineModel(
  'FavouriteListing',
  makeSchema({ userId: refReq('User'), listingId: { type: Schema.Types.ObjectId, required: true }, listingModel: { type: String, enum: ['MarketplaceListing', 'PropertyListing'], required: true } }, { audited: false, indexes: [[{ societyId: 1, userId: 1, listingId: 1 }, { unique: true }]] }),
);

export const ListingReport = defineModel(
  'ListingReport',
  makeSchema(
    { listingId: { type: Schema.Types.ObjectId, required: true, index: true }, listingModel: { type: String, required: true }, reportedBy: refReq('User'), reason: { type: String, required: true }, details: String, status: { type: String, enum: vals(ReportStatus), default: 'OPEN', index: true }, reviewedBy: ref('User') },
    { audited: false, indexes: [[{ societyId: 1, listingId: 1, reportedBy: 1 }, { unique: true }]] },
  ),
);
