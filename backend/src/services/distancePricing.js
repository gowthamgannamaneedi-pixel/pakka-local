// Distance-based delivery charges. Admin-configured ranges [from_km, to_km) -> charge. No price is built into the code.
import { getSetting, setSetting } from './core.js';
import { roadDistance } from './routing.js';

export const MAX_FEE_PAISE = 100_000;
const round2 = (v) => Math.round(Number(v) * 100) / 100;
const num = (v) => (v === '' || v == null ? null : Number(v));
const fail = (error, status = 400, code) => ({ error, status, code });

export function getConfig(db) {
  return { enabled: getSetting(db, 'distance_pricing_enabled') === '1', max_km: num(getSetting(db, 'distance_max_km')), min_fee_paise: num(getSetting(db, 'distance_min_fee_paise')),
    fallback_fee_paise: num(getSetting(db, 'distance_fallback_fee_paise')), cache_days: Number(getSetting(db, 'route_cache_days')) || 30,
    bands: db.prepare('SELECT from_km, to_km, fee_paise FROM distance_fee_bands ORDER BY from_km').all() };
}
export const bandLabel = (b) => `${b.from_km}–${b.to_km == null ? '' : b.to_km} km`.replace('– km', '+ km');

// Ranges must start at 0, follow each other with no gap or overlap; only the last may be open-ended (no upper limit).
export function validateBands(input) {
  if (!Array.isArray(input) || !input.length) return fail('Add at least one distance range.');
  if (input.length > 30) return fail('Too many ranges (max 30).');
  const bands = [];
  for (const [i, b] of input.entries()) {
    const from = num(b?.from_km), to = num(b?.to_km), fee = b?.fee_paise;
    if (!Number.isFinite(from) || from < 0 || from > 100) return fail(`Range ${i + 1}: the start must be 0–100 km.`);
    if (to != null && (!Number.isFinite(to) || to <= from || to > 100)) return fail(`Range ${i + 1}: the end must be more than the start (max 100 km).`);
    if (!Number.isInteger(fee) || fee < 0 || fee > MAX_FEE_PAISE) return fail(`Range ${i + 1}: the charge must be ₹0–₹1,000.`);
    bands.push({ from_km: round2(from), to_km: to == null ? null : round2(to), fee_paise: fee });
  }
  bands.sort((p, q) => p.from_km - q.from_km);
  if (bands[0].from_km !== 0) return fail('The first range must start at 0 km.');
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i], next = bands[i + 1];
    if (b.to_km == null && next) return fail(`Only the last range can be open-ended (range starting at ${b.from_km} km).`);
    if (next && next.from_km !== b.to_km) return fail(next.from_km < b.to_km ? `Ranges overlap at ${next.from_km} km.` : `There is a gap between ${b.to_km} km and ${next.from_km} km.`);
  }
  return { bands };
}

// Saves the whole configuration. Returns exact old -> new values for the audit log.
export function saveConfig(db, body) {
  const before = getConfig(db), next = { ...before };
  if ('bands' in body) { const v = validateBands(body.bands); if (v.error) return v; next.bands = v.bands; }
  for (const k of ['max_km', 'min_fee_paise', 'fallback_fee_paise']) if (k in body) {
    const v = body[k]; if (v === null || v === '') { next[k] = null; continue; }
    if (k === 'max_km' ? !(Number.isFinite(v) && v > 0 && v <= 100) : !(Number.isInteger(v) && v >= 0 && v <= MAX_FEE_PAISE))
      return fail(k === 'max_km' ? 'Maximum distance must be more than 0 and at most 100 km.' : 'Charges must be ₹0–₹1,000 in whole paise.');
    next[k] = k === 'max_km' ? round2(v) : v; }
  if ('cache_days' in body) { if (!(Number.isInteger(body.cache_days) && body.cache_days >= 1 && body.cache_days <= 365)) return fail('Keep distances 1–365 days.'); next.cache_days = body.cache_days; }
  if ('enabled' in body) next.enabled = !!body.enabled;
  if (next.enabled && !next.bands.length) return fail('Add distance ranges before switching distance pricing on.');
  if (next.enabled && next.max_km != null) { const last = next.bands.at(-1); if (last.to_km != null && last.to_km < next.max_km) return fail(`The ranges stop at ${last.to_km} km but the maximum distance is ${next.max_km} km. Add a range up to ${next.max_km} km or an open-ended last range.`); }
  db.transaction(() => {
    if (JSON.stringify(before.bands) !== JSON.stringify(next.bands)) { db.prepare('DELETE FROM distance_fee_bands').run(); for (const b of next.bands) db.prepare('INSERT INTO distance_fee_bands (from_km,to_km,fee_paise) VALUES (?,?,?)').run(b.from_km, b.to_km, b.fee_paise); }
    setSetting(db, 'distance_pricing_enabled', next.enabled ? '1' : '0'); setSetting(db, 'distance_max_km', next.max_km ?? ''); setSetting(db, 'distance_min_fee_paise', next.min_fee_paise ?? '');
    setSetting(db, 'distance_fallback_fee_paise', next.fallback_fee_paise ?? ''); setSetting(db, 'route_cache_days', String(next.cache_days));
  })();
  const changed = Object.fromEntries(['enabled', 'max_km', 'min_fee_paise', 'fallback_fee_paise', 'cache_days', 'bands'].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k])).map((k) => [k, { from: before[k], to: next[k] }]));
  return { ok: true, config: getConfig(db), changed };
}

// The charge for a road distance (or for a failed lookup). Pure: no I/O.
//  -> { fee, pricing: 'distance' | 'distance_fallback', distance_m, band } or { error, status, code }
export function priceFor(cfg, route) {
  if (route?.distance_m == null) {
    if (cfg.fallback_fee_paise == null) return fail('We can’t work out the delivery distance right now, so this order can’t be placed. Please try again in a few minutes.', 503, 'DISTANCE_UNAVAILABLE');
    return { fee: cfg.fallback_fee_paise, pricing: 'distance_fallback', distance_m: null, band: 'Standard charge (distance not available)', reason: route?.reason || 'unknown' };
  }
  const km = route.distance_m / 1000;
  if (cfg.max_km != null && km > cfg.max_km) return fail(`This address is ${km.toFixed(1)} km by road from the restaurant. Pakka Local delivers up to ${cfg.max_km} km.`, 409, 'OUT_OF_RANGE');
  const b = cfg.bands.find((x) => km >= x.from_km && (x.to_km == null || km < x.to_km));
  if (!b) return fail(`This address is ${km.toFixed(1)} km by road from the restaurant, beyond Pakka Local’s delivery ranges.`, 409, 'OUT_OF_RANGE');
  const fee = Math.max(b.fee_paise, cfg.min_fee_paise ?? 0);
  return { fee, pricing: 'distance', distance_m: Math.round(route.distance_m), band: `${bandLabel(b)}: ₹${(b.fee_paise / 100).toFixed(b.fee_paise % 100 ? 2 : 0)}${fee > b.fee_paise ? ` (minimum ₹${fee / 100})` : ''}`, source: route.source };
}

// Async step before pricing an order: look up the road distance from the restaurant's pickup point to the delivery point.
export async function routeFor(db, restaurantId, point) {
  const r = db.prepare('SELECT pickup_lat AS lat, pickup_lng AS lng FROM restaurants WHERE id=?').get(restaurantId);
  return roadDistance(db, r && r.lat != null ? { lat: r.lat, lng: r.lng } : null, point);
}
