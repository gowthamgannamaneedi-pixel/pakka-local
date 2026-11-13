import { z } from 'zod';
export const send = (res, r, okStatus = 200) => r.error ? res.status(r.status || 400).json({ error: r.error, code: r.code }) : res.status(okStatus).json(r);
export const parse = (schema, req, res) => { const p = schema.safeParse(req.body ?? {}); if (!p.success) { res.status(400).json({ error: p.error.issues[0].message }); return null; } return p.data; };
export const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) {
  if (e.status) return res.status(e.status).json({ error: e.message });
  if (/UNIQUE|constraint/i.test(e.message)) return res.status(409).json({ error: 'That conflicts with existing data.' });
  console.error('route error:', e.message); res.status(500).json({ error: 'Something went wrong. Please try again.' }); } };
export const pid = z.coerce.number().int().positive();
export const money = z.number().int().min(0).max(10_000_000);
export const img = z.string().max(5_000_000).optional();
