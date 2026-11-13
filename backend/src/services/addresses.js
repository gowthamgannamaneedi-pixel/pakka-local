// Customer delivery addresses (GPS-first). Coordinates come from the customer's own phone (browser Geolocation API) while
// standing at the delivery point; nothing here looks places up, geocodes or calls any map service.
import { z } from 'zod';
import { getSetting, iso } from './core.js';

export const LABELS = ['home', 'hostel', 'pg', 'college', 'other'];
export const MAX_ADDRESSES = 10;
const clean = (s) => s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();       // no control characters or angle brackets
const text = (max) => z.string().max(max * 2).transform(clean).pipe(z.string().max(max)).optional().or(z.literal('').transform(() => undefined)).nullable();
const finite = (min, max, msg) => z.number({ invalid_type_error: msg, required_error: msg }).refine(Number.isFinite, msg).refine((v) => v >= min && v <= max, msg);

const base = z.object({
  label: z.enum(LABELS, { errorMap: () => ({ message: 'Choose what kind of place this is.' }) }),
  place_name: text(80), building: text(80), block: text(30), floor: text(20), room: text(30), entrance: text(120), landmark: text(120), instructions: text(300),
  delivery_location_id: z.number().int().positive().nullable().optional()
});
const gps = z.object({
  lat: finite(-90, 90, 'The location is not valid. Capture it again.'),
  lng: finite(-180, 180, 'The location is not valid. Capture it again.'),
  accuracy_m: finite(0, 100_000, 'The location accuracy is missing. Capture it again.'),
  captured_at: z.union([z.string(), z.number()]),
  accuracy_acknowledged: z.boolean().optional()
});
export const addressSchema = base.merge(gps).extend({ kind: z.literal('gps').optional(), confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm that you are standing at the delivery location.' }) }), make_default: z.boolean().optional() }).strict();
// a place chosen from Pakka Local's list: the customer's own GPS point is optional (sent only together with a confirmation)
export const listedSchema = base.extend({ kind: z.literal('listed'), delivery_location_id: z.number({ required_error: 'Choose your PG, hostel or college from the list.', invalid_type_error: 'Choose your PG, hostel or college from the list.' }).int().positive() })
  .merge(gps.partial()).extend({ confirm: z.boolean().optional(), make_default: z.boolean().optional() }).strict();
export const addressEditSchema = base.partial().merge(gps.partial()).extend({ kind: z.enum(['gps', 'listed']).optional(), confirm: z.boolean().optional(), make_default: z.boolean().optional() }).strict();

const fail = (error, status = 400, code) => ({ error, status, code });
export const gpsPolicy = (db) => ({ warn_m: Number(getSetting(db, 'gps_accuracy_warn_m')) || null, timeout_sec: Number(getSetting(db, 'gps_capture_timeout_sec')) || 20,
  max_age_min: Number(getSetting(db, 'gps_fix_max_age_min')) || 10 });

// coordinates + freshness + accuracy policy. Returns an error object or the normalised GPS fields.
function checkGps(db, d) {
  if (d.lat === 0 && d.lng === 0) return fail('The location is not valid. Capture it again.');
  const t = typeof d.captured_at === 'number' ? d.captured_at : Date.parse(String(d.captured_at));
  if (!Number.isFinite(t)) return fail('The location time is missing. Capture it again.');
  const p = gpsPolicy(db), now = Date.now();
  if (t > now + 2 * 60_000) return fail('Your phone’s clock looks wrong. Check the date and time, then capture the location again.', 400, 'BAD_TIME');
  if (now - t > p.max_age_min * 60_000) return fail('This location reading is too old. Capture it again where you are now.', 400, 'STALE_FIX');
  if (p.warn_m && d.accuracy_m > p.warn_m && !d.accuracy_acknowledged)
    return fail(`Your location is only accurate to about ${Math.round(d.accuracy_m)} m. Try again outdoors or near a window, or confirm that you accept this accuracy.`, 400, 'ACCURACY_CONFIRM');
  return { lat: +d.lat.toFixed(7), lng: +d.lng.toFixed(7), accuracy_m: Math.round(d.accuracy_m * 10) / 10, captured_at: new Date(t).toISOString(), accuracy_acknowledged: d.accuracy_acknowledged ? 1 : 0 };
}
// enough written detail for a delivery partner to find the door
function checkDetails(d) {
  if (!(d.place_name || d.building)) return fail('Enter the PG, hostel, college or building name.');
  if (!(d.room || d.entrance || d.landmark)) return fail('Add a room number, the gate/entrance or a nearby landmark.');
  return null;
}
const own = (db, customerId, id) => db.prepare('SELECT * FROM customer_addresses WHERE id=? AND customer_id=? AND active=1').get(id, customerId);
const listedPlace = (db, id) => db.prepare('SELECT * FROM delivery_locations WHERE id=? AND active=1').get(id);
const gpsKeys = ['lat', 'lng', 'accuracy_m', 'captured_at'];
export const publicAddress = (a) => a && ({ id: a.id, kind: a.kind, label: a.label, place_name: a.place_name, building: a.building, block: a.block, floor: a.floor, room: a.room, entrance: a.entrance,
  landmark: a.landmark, instructions: a.instructions, delivery_location_id: a.delivery_location_id, lat: a.lat, lng: a.lng, accuracy_m: a.accuracy_m, captured_at: a.captured_at,
  is_default: !!a.is_default, created_at: a.created_at, updated_at: a.updated_at });
export const list = (db, customerId) => db.prepare('SELECT * FROM customer_addresses WHERE customer_id=? AND active=1 ORDER BY is_default DESC, updated_at DESC').all(customerId).map(publicAddress);

export function create(db, customerId, body) {
  const listed = body?.kind === 'listed';
  if (!listed && body?.delivery_location_id != null) return fail('A GPS address cannot be linked to a listed place. Choose “Select from list” instead.', 400, 'USE_LIST');
  const p = (listed ? listedSchema : addressSchema).safeParse(body ?? {}); if (!p.success) return fail(p.error.issues[0].message);
  const d = { ...p.data, kind: listed ? 'listed' : 'gps' };
  let g = { lat: null, lng: null, accuracy_m: null, captured_at: null, accuracy_acknowledged: 0 };
  if (listed) {
    const place = listedPlace(db, d.delivery_location_id); if (!place) return fail('That place is not on the list any more. Choose another or use your GPS location.', 400, 'LOCATION_UNAVAILABLE');
    d.place_name = place.name;                                           // the list name, not free text
    const sent = gpsKeys.filter((k) => d[k] != null);
    if (sent.length) { if (sent.length !== 4) return fail('Send the full GPS reading (latitude, longitude, accuracy and time).'); if (d.confirm !== true) return fail('Confirm that you are standing at the delivery location.'); g = checkGps(db, d); if (g.error) return g; }
    if (!(d.room || d.entrance || d.landmark)) return fail('Add your room number, the gate or a nearby landmark.');
  } else { g = checkGps(db, d); if (g.error) return g; const bad = checkDetails(d); if (bad) return bad; d.delivery_location_id = null; }
  if (db.prepare('SELECT COUNT(*) FROM customer_addresses WHERE customer_id=? AND active=1').pluck().get(customerId) >= MAX_ADDRESSES) return fail(`You can save up to ${MAX_ADDRESSES} addresses. Remove one first.`, 409);
  const id = db.transaction(() => {
    const first = !db.prepare('SELECT 1 FROM customer_addresses WHERE customer_id=? AND active=1').get(customerId);
    if (d.make_default || first) db.prepare('UPDATE customer_addresses SET is_default=0 WHERE customer_id=?').run(customerId);
    return db.prepare(`INSERT INTO customer_addresses (customer_id,kind,label,place_name,building,block,floor,room,entrance,landmark,instructions,delivery_location_id,lat,lng,accuracy_m,captured_at,accuracy_acknowledged,is_default)
      VALUES (@c,@kind,@label,@place_name,@building,@block,@floor,@room,@entrance,@landmark,@instructions,@delivery_location_id,@lat,@lng,@accuracy_m,@captured_at,@accuracy_acknowledged,@def)`)
      .run({ c: customerId, place_name: null, building: null, block: null, floor: null, room: null, entrance: null, landmark: null, instructions: null, delivery_location_id: null, ...d, ...g, def: d.make_default || first ? 1 : 0 }).lastInsertRowid;
  })();
  return { ok: true, address: publicAddress(own(db, customerId, id)) };
}

// Editing never touches existing orders (they hold their own snapshot). New coordinates need a fresh confirmation.
export function update(db, customerId, id, body) {
  const cur = own(db, customerId, id); if (!cur) return fail('Address not found.', 404);
  const p = addressEditSchema.safeParse(body ?? {}); if (!p.success) return fail(p.error.issues[0].message);
  const d = p.data, next = { ...cur }, gpsSent = gpsKeys.filter((k) => k in d);
  if (d.kind && d.kind !== cur.kind) return fail('An address cannot switch between “from the list” and “GPS”. Add a new address instead.');
  if (cur.kind === 'gps' && d.delivery_location_id != null) return fail('A GPS address cannot be linked to a listed place. Add it with “Select from list” instead.', 400, 'USE_LIST');
  if (cur.kind === 'listed' && 'delivery_location_id' in d && d.delivery_location_id == null) return fail('Choose a place from the list, or add a GPS address instead.');
  for (const k of ['label', 'place_name', 'building', 'block', 'floor', 'room', 'entrance', 'landmark', 'instructions', 'delivery_location_id']) if (k in d) next[k] = d[k] ?? null;
  if (cur.kind === 'listed') { const place = listedPlace(db, next.delivery_location_id); if (!place) return fail('That place is not on the list any more. Choose another.', 400, 'LOCATION_UNAVAILABLE'); next.place_name = place.name; }
  if (gpsSent.length) {
    if (gpsSent.length !== 4) return fail('Send the full new location (latitude, longitude, accuracy and time).');
    if (d.confirm !== true) return fail('Confirm that you are standing at the delivery location.');
    const g = checkGps(db, d); if (g.error) return g; Object.assign(next, g);
  }
  const bad = cur.kind === 'listed' ? (next.room || next.entrance || next.landmark ? null : fail('Add your room number, the gate or a nearby landmark.')) : checkDetails(next); if (bad) return bad;
  db.transaction(() => {
    if (d.make_default) db.prepare('UPDATE customer_addresses SET is_default=0 WHERE customer_id=?').run(customerId);
    db.prepare(`UPDATE customer_addresses SET label=@label,place_name=@place_name,building=@building,block=@block,floor=@floor,room=@room,entrance=@entrance,landmark=@landmark,instructions=@instructions,
      delivery_location_id=@delivery_location_id,lat=@lat,lng=@lng,accuracy_m=@accuracy_m,captured_at=@captured_at,accuracy_acknowledged=@accuracy_acknowledged,is_default=@is_default,updated_at=@t WHERE id=@id AND customer_id=@c`)
      .run({ ...next, is_default: d.make_default ? 1 : next.is_default, t: iso(), id, c: customerId });
  })();
  return { ok: true, address: publicAddress(own(db, customerId, id)) };
}
// "Delete" deactivates: the row stays for the records, is hidden from the customer and cannot be used for new orders.
export function remove(db, customerId, id) {
  const cur = own(db, customerId, id); if (!cur) return fail('Address not found.', 404);
  db.transaction(() => {
    db.prepare('UPDATE customer_addresses SET active=0, is_default=0, updated_at=? WHERE id=?').run(iso(), id);
    if (cur.is_default) { const nx = db.prepare('SELECT id FROM customer_addresses WHERE customer_id=? AND active=1 ORDER BY updated_at DESC LIMIT 1').pluck().get(customerId); if (nx) db.prepare('UPDATE customer_addresses SET is_default=1 WHERE id=?').run(nx); }
  })();
  return { ok: true };
}
// For order creation: the caller's own, active address (or null)
export const forOrder = (db, customerId, id) => own(db, customerId, Number(id));
// One-line summary used in order lists and notifications (no coordinates)
export const summary = (a) => [a.place_name, a.building, a.block && `Block ${a.block}`, a.floor && `Floor ${a.floor}`, a.room && `Room ${a.room}`].filter(Boolean).join(', ') || 'Saved location';
