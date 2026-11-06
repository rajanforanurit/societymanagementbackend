import mongoose, { Schema, SchemaDefinition } from 'mongoose';

const transform = (_doc: unknown, ret: any) => {
  if (ret._id !== undefined) {
    ret.id = String(ret._id);
    delete ret._id;
  }
  delete ret.__v;
  return ret;
};

mongoose.plugin((schema: Schema) => {
  schema.set('toJSON', { transform });
});

const READ_OPS = ['find', 'findOne', 'countDocuments', 'distinct'];
const WRITE_OPS = ['findOneAndUpdate', 'findOneAndDelete', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany'];
const ALL_OPS = [...READ_OPS, ...WRITE_OPS];

export interface SchemaOptions {
  tenant?: boolean;
  softDelete?: boolean;
  audited?: boolean;
  immutable?: boolean;
  indexes?: [Record<string, 1 | -1 | 'text'>, Record<string, unknown>?][];
}

export function makeSchema(def: SchemaDefinition, opts: SchemaOptions = {}): Schema<any> {
  const { tenant = true, softDelete = true, audited = true, immutable = false, indexes = [] } = opts;
  const fields: SchemaDefinition = { ...def };
  if (tenant) fields.societyId = { type: Schema.Types.ObjectId, ref: 'Society', required: true, index: true };
  if (audited) {
    fields.createdBy = { type: Schema.Types.ObjectId, ref: 'User' };
    fields.updatedBy = { type: Schema.Types.ObjectId, ref: 'User' };
  }
  if (softDelete) {
    fields.isDeleted = { type: Boolean, default: false, select: false };
    fields.deletedAt = { type: Date, select: false };
    fields.deletedBy = { type: Schema.Types.ObjectId, ref: 'User', select: false };
  }

  const schema = new Schema(fields, { timestamps: true, versionKey: false });
  indexes.forEach(([spec, o]) => schema.index(spec as any, o as any));

  schema.pre(ALL_OPS as any, function (this: any) {
    const filter = this.getFilter();
    const options = this.getOptions();
    if (tenant && !options.skipTenantCheck) {
      const idOnlyRead = READ_OPS.includes(this.op) && filter._id !== undefined;
      if (filter.societyId === undefined && !idOnlyRead) {
        throw new Error(`Tenant isolation violation: societyId filter missing on ${this.model.modelName}.${this.op}`);
      }
    }
    if (softDelete && !options.includeDeleted && filter.isDeleted === undefined) {
      this.where({ isDeleted: { $ne: true } });
    }
  });

  schema.pre('aggregate', function (this: any) {
    const pipeline = this.pipeline();
    const options = this.options ?? {};
    if (tenant && !options.skipTenantCheck) {
      const first = pipeline[0];
      if (!first || !first.$match || first.$match.societyId === undefined) {
        throw new Error('Tenant isolation violation: aggregate pipeline must start with a $match on societyId');
      }
    }
    if (softDelete && !options.includeDeleted) pipeline.unshift({ $match: { isDeleted: { $ne: true } } });
  });

  if (immutable) {
    const block = function () {
      throw new Error('This collection is immutable');
    };
    schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'deleteOne', 'deleteMany', 'replaceOne'] as any, block);
    schema.pre('save', function (this: any) {
      if (!this.isNew) throw new Error('This collection is immutable');
    });
  }
  return schema;
}

export const ref = (name: string, extra: Record<string, unknown> = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });
export const refReq = (name: string, extra: Record<string, unknown> = {}) => ref(name, { required: true, ...extra });

export const defineModel = (name: string, schema: Schema<any>) => mongoose.model(name, schema) as unknown as mongoose.Model<any>;
