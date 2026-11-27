import { defineModel, makeSchema } from '../../common/models/makeSchema';

export const HelpdeskContact = defineModel(
  'HelpdeskContact',
  makeSchema(
    {
      name: { type: String, required: true, trim: true },
      mobile: { type: String, required: true, trim: true },
      alternateMobile: { type: String, trim: true },
      category: { type: String, required: true, uppercase: true, trim: true, index: true },
      designation: { type: String, trim: true },
      description: String,
      availability: String,
      isVisible: { type: Boolean, default: true, index: true },
      order: { type: Number, default: 0 },
    },
    { indexes: [[{ societyId: 1, category: 1, order: 1 }], [{ societyId: 1, isVisible: 1 }]] },
  ),
);
