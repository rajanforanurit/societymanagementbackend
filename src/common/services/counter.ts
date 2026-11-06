import { Counter } from '../../modules/complaints/complaint.model';

export async function nextSeq(key: string) {
  const c: any = await Counter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return c.seq as number;
}
