// Priority 2: live rider location. Latest fix only, accepted only from the assigned rider during an active delivery.
const ACTIVE = "('ACCEPTED','PREPARING','READY','PICKED_UP')";
export const LIVE_SEC = 30, STALE_SEC = 180, MIN_INTERVAL_MS = 3000, SEND_EVERY_MS = 7000;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fail = (error, status, code) => ({ error, status, code });

// freshness is judged on SERVER receive time, so a wrong phone clock cannot make an old position look live
export const freshness = (row, now = Date.now()) => { if (!row) return { state: 'unavailable', age_sec: null };
  const age = Math.max(0, Math.round((now - Date.parse(row.received_at)) / 1000)); return { state: age <= LIVE_SEC ? 'live' : age <= STALE_SEC ? 'stale' : 'offline', age_sec: age }; };
// Backstop for the database trigger (migration p2_002): also forgets riders who were deactivated or lost approval. Run by a background job.
export const purgeLocations = (db) => db.prepare(`DELETE FROM rider_locations WHERE rider_id NOT IN (SELECT rider_id FROM orders WHERE rider_id IS NOT NULL AND status IN ${ACTIVE})
  OR rider_id NOT IN (SELECT r.user_id FROM riders r JOIN users u ON u.id=r.user_id WHERE u.active=1 AND r.verification_status='approved')`).run().changes;
const purge = purgeLocations;
// The rider's own "stop sharing". The rider id always comes from the session, so one rider can never remove another's position.
export function stopSharing(db, riderId) {
  const removed = db.prepare('DELETE FROM rider_locations WHERE rider_id=?').run(riderId).changes;
  return { ok: true, removed, active_deliveries: db.prepare(`SELECT COUNT(*) FROM orders WHERE rider_id=? AND status IN ${ACTIVE}`).pluck().get(riderId) };
}

export function recordLocation(db, riderId, b = {}, now = Date.now()) {
  const r = db.prepare('SELECT r.verification_status, u.active FROM riders r JOIN users u ON u.id=r.user_id WHERE r.user_id=?').get(riderId);
  // Any verification state may share location for a delivery it already holds (e.g. an agent placed under re-verification
  // mid-delivery must still be trackable); the assignment check below is the real gate. Suspended/rejected cannot.
  if (!r || !r.active || ['suspended', 'rejected'].includes(r.verification_status)) return fail('Your account cannot share location.', 403, 'NOT_ALLOWED');
  const mine = db.prepare(`SELECT id, status FROM orders WHERE rider_id=? AND status IN ${ACTIVE} ORDER BY (status='PICKED_UP') DESC, id`).all(riderId);
  if (!mine.length) { db.prepare('DELETE FROM rider_locations WHERE rider_id=?').run(riderId);            // delivery finished or reassigned: stop and forget
    return fail('No active delivery. Location sharing is off.', 409, 'NOT_TRACKING'); }
  const lat = num(b.lat), lng = num(b.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return fail('Invalid coordinates.', 400, 'BAD_COORDS');
  const acc = num(b.accuracy), heading = num(b.heading), speed = num(b.speed);
  if ((acc !== null && (acc < 0 || acc > 100000)) || (heading !== null && (heading < 0 || heading > 360)) || (speed !== null && (speed < 0 || speed > 100))) return fail('Invalid location details.', 400, 'BAD_FIX');
  let t = b.recorded_at == null ? now : typeof b.recorded_at === 'number' ? b.recorded_at : Date.parse(String(b.recorded_at));
  if (!Number.isFinite(t)) return fail('Invalid timestamp.', 400, 'BAD_TIME');
  if (t > now + 30_000) return fail('Location time is in the future. Check the date and time on your phone.', 400, 'BAD_TIME');
  if (t < now - 120_000) return fail('That location is too old to use.', 422, 'OLD_FIX');
  let orderId = mine[0].id;
  if (b.order_id != null) { if (!mine.some((o) => o.id === Number(b.order_id))) return fail('That delivery is not assigned to you.', 403, 'NOT_YOUR_ORDER'); orderId = Number(b.order_id); }
  const prev = db.prepare('SELECT recorded_at, received_at FROM rider_locations WHERE rider_id=?').get(riderId);
  if (prev && now - Date.parse(prev.received_at) < MIN_INTERVAL_MS) return { ...fail('Too many location updates.', 429, 'TOO_FREQUENT'), retry_ms: MIN_INTERVAL_MS };
  if (prev && t <= Date.parse(prev.recorded_at)) return { ok: true, tracking: true, ignored: true, next_ms: SEND_EVERY_MS };            // out-of-order fix: keep the newer one
  db.prepare(`INSERT INTO rider_locations (rider_id,order_id,lat,lng,accuracy_m,heading,speed_mps,recorded_at,received_at) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(rider_id) DO UPDATE SET order_id=excluded.order_id, lat=excluded.lat, lng=excluded.lng, accuracy_m=excluded.accuracy_m, heading=excluded.heading, speed_mps=excluded.speed_mps, recorded_at=excluded.recorded_at, received_at=excluded.received_at`)
    .run(riderId, orderId, +lat.toFixed(6), +lng.toFixed(6), acc, heading, speed, new Date(t).toISOString(), new Date(now).toISOString());
  return { ok: true, tracking: true, next_ms: SEND_EVERY_MS };
}
const pos = (row, f) => (row ? { lat: row.lat, lng: row.lng, accuracy_m: row.accuracy_m, heading: row.heading, updated_at: row.received_at, ...f } : null);

// The customer of THIS order only, and only between pickup and delivery (the same window in which the rider's identity is shown).
export function customerView(db, customerId, code, now = Date.now()) {
  const o = db.prepare('SELECT id,status,rider_id,dest_lat,dest_lng,dest_text FROM orders WHERE order_code=? AND customer_id=?').get(String(code), customerId);
  if (!o) return fail('Order not found.', 404);
  if (o.status !== 'PICKED_UP' || !o.rider_id) return { tracking: false, status: o.status };
  const row = db.prepare('SELECT * FROM rider_locations WHERE rider_id=?').get(o.rider_id), f = freshness(row, now);
  return { tracking: true, status: o.status, ...f, rider: pos(row), destination: o.dest_lat != null && o.dest_lng != null ? { lat: o.dest_lat, lng: o.dest_lng, text: o.dest_text } : null };
}
export function adminActive(db, now = Date.now()) {
  purge(db);
  return db.prepare(`SELECT o.id,o.order_code,o.status,o.dest_lat,o.dest_lng,o.dest_text,o.eta_at,r.name AS restaurant,u.id AS rider_id,u.name AS rider_name,u.phone AS rider_phone,
      l.lat,l.lng,l.accuracy_m,l.heading,l.received_at FROM orders o JOIN restaurants r ON r.id=o.restaurant_id JOIN users u ON u.id=o.rider_id LEFT JOIN rider_locations l ON l.rider_id=o.rider_id
    WHERE o.rider_id IS NOT NULL AND o.status IN ${ACTIVE} ORDER BY o.id`).all().map((x) => ({ id: x.id, order_code: x.order_code, status: x.status, restaurant: x.restaurant, eta_at: x.eta_at,
      rider: { id: x.rider_id, name: x.rider_name, phone: x.rider_phone }, ...freshness(x.received_at ? x : null, now), location: x.received_at ? pos(x) : null,
      destination: x.dest_lat != null && x.dest_lng != null ? { lat: x.dest_lat, lng: x.dest_lng, text: x.dest_text } : { text: x.dest_text } }));
}
