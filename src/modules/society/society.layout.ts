import { ClientSession } from 'mongoose';
import { SocietyType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { Society, Tower, Floor, Flat } from './society.model';

export type PropertyTypeKey = 'MULTIFAMILY' | 'SINGLE_FAMILY';

export interface TowerLayout { name: string; flats?: string[]; code?: string; floors?: { number: number; units: number }[] }

export const societyTypeFor = (t: PropertyTypeKey) => (t === 'MULTIFAMILY' ? 'APARTMENT' : 'VILLA_COMMUNITY') as (typeof SocietyType)[keyof typeof SocietyType];

const STOP = new Set(['of', 'the', 'and', '&', 'at', 'in', 'for']);

export function societyInitials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const sig = words.filter((w) => !STOP.has(w.toLowerCase()));
  const use = sig.length ? sig : words;
  if (!use.length) return 'SOC';
  if (use.length === 1) return use[0].slice(0, 3).toUpperCase();
  return use.map((w) => w[0]).join('').toUpperCase().slice(0, 6);
}

export function baseSocietyCode(name: string, at = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('day')}${get('month')}${societyInitials(name)}${get('year')}`;
}

export async function generateSocietyCode(name: string, session?: ClientSession | null, at = new Date()): Promise<string> {
  const base = baseSocietyCode(name, at);
  for (let n = 1; n <= 500; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await Society.exists({ code: candidate }).setOptions({ includeDeleted: true }).session(session ?? null))) return candidate;
  }
  throw ApiError.conflict('Could not generate a unique society code', 'CODE_EXISTS');
}

export const unitLabel = (towerCode: string, floor: number, index: number) => `${towerCode}-${floor}${String(index).padStart(2, '0')}`;

export const houseLabel = (prefix: string, n: number) => `${prefix}${n}`;

export function houseNames(sf: any): string[] {
  if (!sf) return [];
  if (sf.houses?.length) return sf.houses as string[];
  return Array.from({ length: sf.totalHouses ?? 0 }, (_, i) => houseLabel(sf.labelPrefix ?? 'H-', (sf.startNumber ?? 1) + i));
}

export function expandTower(t: TowerLayout): { floor?: number; unitNumber: string; label: string }[] {
  if (t.flats?.length) return t.flats.map((f) => ({ unitNumber: f, label: f }));
  return (t.floors ?? []).flatMap((f) => Array.from({ length: f.units }, (_, i) => ({ floor: f.number, unitNumber: `${f.number}${String(i + 1).padStart(2, '0')}`, label: unitLabel(t.code ?? '', f.number, i + 1) })));
}

export function summarize(details: any, type: PropertyTypeKey) {
  if (type === 'MULTIFAMILY') {
    const towers: TowerLayout[] = details.towers ?? [];
    return { totalTowers: towers.length, totalFloors: towers.reduce((m, t) => Math.max(m, t.flats?.length ? 0 : (t.floors?.length ?? 0)), 0), totalUnits: towers.reduce((s, t) => s + expandTower(t).length, 0) };
  }
  return { totalTowers: 0, totalFloors: 0, totalUnits: houseNames(details.singleFamily).length };
}

export async function applyLayout(societyId: string, type: PropertyTypeKey, details: any, actorId: string, session?: ClientSession | null) {
  const opt = { session: session ?? undefined };
  const base = { societyId, createdBy: actorId, updatedBy: actorId };
  let towers = 0;
  let flats = 0;
  if (type === 'MULTIFAMILY') {
    for (const t of details.towers as TowerLayout[]) {
      const legacyFloors = t.flats?.length ? [] : (t.floors ?? []);
      let tower: any = await Tower.findOne({ societyId, name: t.name }).session(session ?? null);
      if (!tower) {
        [tower] = await Tower.create([{ ...base, name: t.name, ...(legacyFloors.length ? { totalFloors: legacyFloors.length } : {}) }], opt);
        towers++;
      } else if (legacyFloors.length && tower.totalFloors !== legacyFloors.length) {
        tower.totalFloors = legacyFloors.length;
        await tower.save(opt);
      }
      for (const f of legacyFloors) {
        if (!(await Floor.exists({ societyId, towerId: tower._id, number: f.number }).session(session ?? null))) await Floor.create([{ ...base, towerId: tower._id, number: f.number, label: `Floor ${f.number}` }], opt);
      }
      const existing = new Set((await Flat.find({ societyId, towerId: tower._id }).select('label').session(session ?? null)).map((x: any) => x.label));
      const docs = expandTower(t).filter((u) => !existing.has(u.label)).map((u) => ({ ...base, towerId: tower._id, ...(u.floor !== undefined ? { floorNumber: u.floor } : {}), unitNumber: u.unitNumber, label: u.label }));
      if (docs.length) await Flat.insertMany(docs, opt);
      flats += docs.length;
    }
  } else {
    const existing = new Set((await Flat.find({ societyId }).select('label').session(session ?? null)).map((x: any) => x.label));
    const docs: any[] = houseNames(details.singleFamily)
      .filter((label) => !existing.has(label))
      .map((label) => ({ ...base, unitNumber: label, label }));
    if (docs.length) await Flat.insertMany(docs, opt);
    flats += docs.length;
  }
  return { towers, flats };
}

export async function assertLayoutNotShrinking(societyId: string, type: PropertyTypeKey, details: any) {
  const wanted = new Set(type === 'MULTIFAMILY' ? (details.towers as TowerLayout[]).flatMap((t) => expandTower(t).map((u) => u.label)) : houseNames(details.singleFamily));
  const flats: any[] = await Flat.find({ societyId }).select('label');
  const missing = flats.filter((f) => !wanted.has(f.label));
  if (missing.length) throw ApiError.conflict(`The new layout would remove or rename ${missing.length} existing unit(s), e.g. ${missing.slice(0, 3).map((f) => f.label).join(', ')}. Layouts can be extended but not reduced.`, 'LAYOUT_SHRINK');
}
