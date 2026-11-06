import { Response } from 'express';

export interface PageResult {
  items: unknown[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export const ok = (res: Response, data: unknown, message = 'Success') => res.status(200).json({ success: true, message, data });
export const created = (res: Response, data: unknown, message = 'Created') => res.status(201).json({ success: true, message, data });
export const paged = (res: Response, r: PageResult, message = 'Success') =>
  res.status(200).json({ success: true, message, data: r.items, meta: r.meta });
