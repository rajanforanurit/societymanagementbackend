import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { ResidentStatus, ResidentType, UserType } from '../../common/constants/enums';
import { ModuleRouter } from '../../common/openapi/router';
import { ok } from '../../common/responses/respond';
import { ApiError } from '../../common/utils/apiError';
import { objectId } from '../../common/validators/common';
import { Resident } from '../resident/resident.model';
import { Flat, Society, Tower } from './society.model';

/**
 * Property directory for the resident's "Add property" flow:
 * Country → City → Society (searchable) → Tower (if any) → Flat → Owner / Tenant → request.
 *
 * Any signed-in resident can browse it — including one with no approved property yet — but it only
 * exposes ACTIVE societies and structural data (names, labels). It never reveals who lives where:
 * a flat only says whether it already has a registered owner, so an owner request can be refused
 * up front instead of after submission.
 */
export const societyDirectoryRouter = new ModuleRouter('/api/v1/auth/societies/directory', {
  tag: 'Resident - Property directory',
  tagDescription: 'Browse countries, cities, societies, towers and flats to request access to a property',
  roles: [UserType.RESIDENT],
});

const DEFAULT_COUNTRY = 'India';
const clean = (v?: string | null) => (v ?? '').trim().replace(/\s+/g, ' ');
const key = (v?: string | null) => clean(v).toLowerCase();
const countryOf = (s: any) => clean(s.address?.country) || DEFAULT_COUNTRY;
const cityOf = (s: any) => clean(s.address?.city) || 'Other';
const escape = (q: string) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function activeSocieties() {
  return Society.find({ status: 'ACTIVE' }).select('name code address propertyType propertyDetails.totalTowers propertyDetails.totalUnits').lean();
}

const countryItem = z.object({ name: z.string(), societies: z.number().int() });
const cityItem = z.object({ name: z.string(), state: z.string().optional(), country: z.string(), societies: z.number().int() });
const societyItem = z.object({ id: objectId, name: z.string(), code: z.string(), city: z.string(), state: z.string().optional(), country: z.string(), addressLine: z.string().optional(), propertyType: z.string().optional(), totalTowers: z.number().int().optional(), totalUnits: z.number().int().optional() });
const towerItem = z.object({ id: objectId, name: z.string(), flats: z.number().int() });
const flatItem = z.object({ id: objectId, label: z.string(), unitNumber: z.string().optional(), floorNumber: z.number().optional(), towerId: objectId.optional(), towerName: z.string().optional(), ownerRegistered: z.boolean() });

const societyParam = z.object({ id: objectId });

/** The society must be ACTIVE; never reveal the structure of any other society. */
async function activeSocietyOr404(id: string) {
  const soc: any = await Society.findOne({ _id: id, status: 'ACTIVE' }).select('name propertyType').lean();
  if (!soc) throw ApiError.notFound('Society not found');
  return soc;
}

societyDirectoryRouter
  .add({
    method: 'get',
    path: '/countries',
    summary: 'Countries with active societies',
    response: z.array(countryItem),
    handler: async (_req: Request, res: Response) => {
      const counts = new Map<string, { name: string; societies: number }>();
      for (const s of await activeSocieties()) {
        const name = countryOf(s);
        const e = counts.get(key(name)) ?? { name, societies: 0 };
        e.societies++;
        counts.set(key(name), e);
      }
      ok(res, [...counts.values()].sort((a, b) => a.name.localeCompare(b.name)));
    },
  })
  .add({
    method: 'get',
    path: '/cities',
    summary: 'Cities of a country with active societies',
    query: z.object({ country: z.string().trim().min(2).max(60) }),
    response: z.array(cityItem),
    handler: async (req: Request, res: Response) => {
      const want = key(req.valid.query.country);
      const counts = new Map<string, { name: string; state?: string; country: string; societies: number }>();
      for (const s of await activeSocieties()) {
        if (key(countryOf(s)) !== want) continue;
        const name = cityOf(s);
        const e = counts.get(key(name)) ?? { name, state: clean((s as any).address?.state) || undefined, country: countryOf(s), societies: 0 };
        e.societies++;
        counts.set(key(name), e);
      }
      ok(res, [...counts.values()].sort((a, b) => (a.name === 'Other' ? 1 : b.name === 'Other' ? -1 : a.name.localeCompare(b.name))));
    },
  })
  .add({
    method: 'get',
    path: '/societies',
    summary: 'Societies / properties in a city (searchable)',
    description: 'Pass country and city from the previous steps; q searches the society name, code and address within them. Without a city, q searches every active society of the country.',
    query: z.object({ country: z.string().trim().min(2).max(60), city: z.string().trim().min(1).max(80).optional(), q: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }),
    response: z.array(societyItem),
    handler: async (req: Request, res: Response) => {
      const { country, city, q, limit } = req.valid.query;
      const rx = q ? new RegExp(escape(q), 'i') : null;
      const out = (await activeSocieties())
        .filter((s: any) => key(countryOf(s)) === key(country) && (!city || key(cityOf(s)) === key(city)))
        .filter((s: any) => !rx || rx.test(s.name) || rx.test(s.code) || rx.test(s.address?.line1 ?? '') || rx.test(s.address?.line2 ?? '') || rx.test(s.address?.pincode ?? ''))
        .sort((a: any, b: any) => a.name.localeCompare(b.name))
        .slice(0, limit)
        .map((s: any) => ({
          id: String(s._id),
          name: s.name,
          code: s.code,
          city: cityOf(s),
          state: clean(s.address?.state) || undefined,
          country: countryOf(s),
          addressLine: [s.address?.line1, s.address?.line2, s.address?.pincode].map(clean).filter(Boolean).join(', ') || undefined,
          propertyType: s.propertyType,
          totalTowers: s.propertyDetails?.totalTowers,
          totalUnits: s.propertyDetails?.totalUnits,
        }));
      ok(res, out);
    },
  })
  .add({
    method: 'get',
    path: '/societies/:id/towers',
    summary: 'Towers of a society (empty for single-family / no-tower properties)',
    params: societyParam,
    response: z.array(towerItem),
    handler: async (req: Request, res: Response) => {
      const societyId = req.valid.params.id;
      await activeSocietyOr404(societyId);
      const towers: any[] = await Tower.find({ societyId, status: { $ne: 'INACTIVE' } }).select('name').sort({ name: 1 }).lean();
      const counts: any[] = towers.length ? await Flat.aggregate([{ $match: { societyId: new Types.ObjectId(societyId), isDeleted: { $ne: true }, towerId: { $in: towers.map((t) => t._id) } } }, { $group: { _id: '$towerId', n: { $sum: 1 } } }]) : [];
      const n = new Map(counts.map((c) => [String(c._id), c.n]));
      ok(res, towers.map((t) => ({ id: String(t._id), name: t.name, flats: n.get(String(t._id)) ?? 0 })).filter((t) => t.flats > 0));
    },
  })
  .add({
    method: 'get',
    path: '/societies/:id/flats',
    summary: 'Flats / units of a society, optionally of one tower',
    description: 'towerId narrows to one tower. ownerRegistered tells the app a flat already has an approved owner (an owner request for it would be refused); residents’ identities are never returned.',
    params: societyParam,
    query: z.object({ towerId: objectId.optional(), q: z.string().trim().max(40).optional() }),
    response: z.array(flatItem),
    handler: async (req: Request, res: Response) => {
      const societyId = req.valid.params.id;
      await activeSocietyOr404(societyId);
      const filter: Record<string, unknown> = { societyId, isDeleted: { $ne: true } };
      if (req.valid.query.towerId) filter.towerId = req.valid.query.towerId;
      if (req.valid.query.q) filter.label = new RegExp(escape(req.valid.query.q), 'i');
      const flats: any[] = await Flat.find(filter).select('label unitNumber floorNumber towerId').populate({ path: 'towerId', select: 'name' }).limit(5000).lean();
      const owners = new Set((await Resident.find({ societyId, residentType: ResidentType.OWNER, status: ResidentStatus.APPROVED, flatId: { $in: flats.map((f) => f._id) } }).select('flatId').lean()).map((r: any) => String(r.flatId)));
      const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      ok(
        res,
        flats
          .map((f) => ({ id: String(f._id), label: f.label, unitNumber: f.unitNumber, floorNumber: f.floorNumber, towerId: f.towerId ? String(f.towerId._id ?? f.towerId) : undefined, towerName: f.towerId?.name, ownerRegistered: owners.has(String(f._id)) }))
          .sort((a, b) => natural(a.label, b.label)),
      );
    },
  });
