// Admin-managed list of PGs, hostels, colleges and other delivery places, each with its own delivery charge.
// No place is ever created by the code itself: only by an admin (form or CSV import of the owner's sheet).
import { z } from 'zod';
import { iso } from './core.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();       // for duplicate detection
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
const txt = (min, max) => z.string().transform(clean).pipe(z.string().min(min).max(max));
const optTxt = (max) => z.string().transform(clean).pipe(z.string().max(max)).optional().nullable();
export const MAX_FEE_PAISE = 100_000;                                                         // ₹1,000 sanity ceiling
export const locationSchema = z.object({
  name: txt(2, 80), kind: optTxt(30), address: txt(3, 200), area: optTxt(60), contact: optTxt(40),
  delivery_fee_paise: z.number({ invalid_type_error: 'Enter the delivery charge.', required_error: 'Enter the delivery charge.' }).int('Use whole paise.').min(0, 'The delivery charge cannot be negative.').max(MAX_FEE_PAISE, 'The delivery charge looks too high (max ₹1,000).'),
  distance_km: z.number().min(0).max(50).nullish(),
  maps_link: z.string().url().max(300).refine((u) => u.startsWith('https://'), 'Use an https:// link.').optional().nullable().or(z.literal('').transform(() => null)),
  lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish(),
  active: z.boolean().optional(), external_ref: optTxt(40)
}).strict().refine((d) => (d.lat == null) === (d.lng == null), 'Enter both latitude and longitude, or neither.').refine((d) => !(d.lat === 0 && d.lng === 0), 'That map point is not valid.');
const fail = (error, status = 400) => ({ error, status });
const COLS = ['name', 'kind', 'address', 'area', 'contact', 'delivery_fee_paise', 'distance_km', 'maps_link', 'lat', 'lng', 'active', 'external_ref'];
const dupe = (db, name, ref, exceptId = 0) => {
  const n = norm(name); const same = db.prepare('SELECT id, name FROM delivery_locations WHERE id<>?').all(exceptId).find((x) => norm(x.name) === n);
  if (same) return `A place called “${same.name}” already exists.`;
  if (ref && db.prepare('SELECT 1 FROM delivery_locations WHERE external_ref=? AND id<>?').get(ref, exceptId)) return `Reference ${ref} is already used.`;
  return null;
};

export function list(db, { q, status } = {}) {
  const rows = db.prepare(`SELECT l.*, (SELECT COUNT(*) FROM customer_addresses a WHERE a.delivery_location_id=l.id AND a.active=1) AS saved_addresses,
      (SELECT COUNT(*) FROM orders o WHERE o.delivery_location_id=l.id) AS orders FROM delivery_locations l ORDER BY l.active DESC, l.name`).all();
  const n = norm(q);
  return rows.filter((l) => (status === 'active' ? l.active : status === 'inactive' ? !l.active : true) && (!n || norm([l.name, l.area, l.address, l.kind, l.external_ref].join(' ')).includes(n)));
}

export function create(db, body) {
  const p = locationSchema.safeParse(body ?? {}); if (!p.success) return fail(p.error.issues[0].message);
  const d = p.data, dup = dupe(db, d.name, d.external_ref); if (dup) return fail(dup, 409);
  const v = { kind: null, area: null, contact: null, distance_km: null, maps_link: null, lat: null, lng: null, external_ref: null, ...d, active: d.active === false ? 0 : 1, t: iso() };
  const id = db.prepare(`INSERT INTO delivery_locations (name,kind,address,area,contact,delivery_fee_paise,distance_km,maps_link,lat,lng,active,external_ref,updated_at)
    VALUES (@name,@kind,@address,@area,@contact,@delivery_fee_paise,@distance_km,@maps_link,@lat,@lng,@active,@external_ref,@t)`).run(v).lastInsertRowid;
  return { ok: true, id, after: pick(db, id) };
}
const pick = (db, id) => { const r = db.prepare('SELECT * FROM delivery_locations WHERE id=?').get(id); return r && Object.fromEntries(COLS.map((k) => [k, r[k]])); };

// Partial update. Returns the exact old and new values of every changed field (for the audit log).
// Orders keep the charge they were placed with: nothing here touches orders.
export function update(db, id, body) {
  const before = pick(db, id); if (!before) return fail('Place not found.', 404);
  const p = locationSchema.safeParse({ ...before, active: !!before.active, ...body }); if (!p.success) return fail(p.error.issues[0].message);
  const d = p.data, dup = dupe(db, d.name, d.external_ref, id); if (dup) return fail(dup, 409);
  const next = { ...before, ...d, active: d.active === false ? 0 : 1 };
  const changed = COLS.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(next[k] ?? null));
  if (!changed.length) return { ok: true, changed: {} };
  db.prepare(`UPDATE delivery_locations SET ${changed.map((k) => `${k}=@${k}`).join(',')}, updated_at=@t WHERE id=@id`).run({ ...Object.fromEntries(changed.map((k) => [k, next[k] ?? null])), t: iso(), id });
  return { ok: true, changed: Object.fromEntries(changed.map((k) => [k, { from: before[k] ?? null, to: next[k] ?? null }])) };
}

// ---------- CSV import (the owner's sheet: Location_ID, Place_Name, Category, Area_Locality, Full_Address, Latitude, Longitude, ...fee columns..., Google_Maps_Link) ----------
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c; }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.replace(/^﻿/, '').trim());
  return { head, rows: rows.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}
const money = (s) => { const m = String(s || '').replace(/[₹,\s]|INR|Rs\.?/gi, ''); if (!/^\d+(\.\d{1,2})?$/.test(m)) return null; return Math.round(Number(m) * 100); };
// feeColumn: the sheet column holding the charge in rupees (the admin chooses it). updateFees: also change charges of places already imported.
export function importCsv(db, text, { feeColumn, updateFees = false, activate = true, dryRun = true } = {}) {
  const { head, rows } = parseCsv(String(text || ''));
  for (const h of ['Location_ID', 'Place_Name', 'Full_Address']) if (!head.includes(h)) return fail(`The file needs a “${h}” column.`);
  if (!feeColumn || !head.includes(feeColumn)) return fail('Choose which column holds the delivery charge.');
  if (rows.length > 2000) return fail('Too many rows (max 2000).');
  const report = { created: 0, updated: 0, fee_changes: 0, unchanged: 0, errors: [], fee_columns: head.filter((h) => /fee/i.test(h)) }, changes = [];
  const run = () => { for (const [i, r] of rows.entries()) {
    const line = i + 2, ref = clean(r.Location_ID), fee = money(r[feeColumn]);
    if (fee == null) { report.errors.push(`Row ${line} (${ref}): the charge “${r[feeColumn]}” is not a number.`); continue; }
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const body = { external_ref: ref, name: r.Place_Name, kind: r.Category || null, address: r.Full_Address, area: r.Area_Locality || null, lat: num(r.Latitude), lng: num(r.Longitude),
      distance_km: num(r.Est_Road_Dist_km ?? r.Straight_Dist_km), maps_link: r.Google_Maps_Link || null, delivery_fee_paise: fee };
    if ([body.lat, body.lng, body.distance_km].some((v) => v !== null && !Number.isFinite(v))) { report.errors.push(`Row ${line} (${ref}): latitude, longitude or distance is not a number.`); continue; }
    const cur = db.prepare('SELECT id, delivery_fee_paise FROM delivery_locations WHERE external_ref=?').get(ref);
    if (cur) { const { delivery_fee_paise, ...rest } = body; const out = update(db, cur.id, updateFees ? body : rest);
      if (out.error) { report.errors.push(`Row ${line} (${ref}): ${out.error}`); continue; }
      const n = Object.keys(out.changed).length; if (!n) report.unchanged++; else { report.updated++; if (out.changed.delivery_fee_paise) report.fee_changes++; changes.push({ id: cur.id, ref, changed: out.changed }); } }
    else { const out = create(db, { ...body, active: !!activate }); if (out.error) { report.errors.push(`Row ${line} (${ref}): ${out.error}`); continue; } report.created++; changes.push({ id: out.id, ref, created: true }); }
  } };
  if (dryRun) { try { db.transaction(() => { run(); throw Object.assign(new Error('dry run'), { dry: true }); })(); } catch (e) { if (!e.dry) throw e; } }   // preview: roll everything back
  else db.transaction(run)();
  return { ok: true, dry_run: !!dryRun, rows: rows.length, ...report, changes: dryRun ? undefined : changes };
}
