import { getConfig as getDistanceConfig, priceFor } from './distancePricing.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export const NO_RIDER_MSG = 'Sorry, we are not currently accepting orders as delivery partners are not available. Please check after some time.';
export const iso = () => new Date().toISOString();
const PLrs = (p) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// ---------- settings ----------
const DEFAULTS = { tax_bps: '0', gps_delivery_fee_paise: '4000', rider_payout_paise: '3000', delivery_otp_mode: 'per_order',
  fixed_delivery_otp: '', minutes_per_km: '4', rider_to_restaurant_min: '8', default_delivery_min: '12', gateway_fee_bps: '200',
  max_active_per_rider: '2', rider_online_ttl_sec: '120', payment_timeout_min: '15', promo_daily_cap: '2', payout_methods: 'upi,bank', offer_expiry_min: '15',
  // Restaurant response timer shown on new orders. Empty = not set (no countdown). Informational only: nothing is auto-rejected.
  restaurant_accept_timeout_min: '',
  // Customer GPS capture. gps_accuracy_warn_m empty = no limit set: accuracy is always shown, never called exact; when set, a
  // reading worse than it needs an explicit "use anyway". Timeout is how long the phone may take; max age is how old a reading may be when saved.
  gps_accuracy_warn_m: '', gps_capture_timeout_sec: '20', gps_fix_max_age_min: '10',
  // Distance-based delivery charges (off by default; ranges live in distance_fee_bands). Empty = not set: no maximum,
  // no minimum, and no fallback (an order whose road distance cannot be worked out is refused rather than guessed).
  distance_pricing_enabled: '0', distance_max_km: '', distance_min_fee_paise: '', distance_fallback_fee_paise: '', route_cache_days: '30' };
export const SETTING_KEYS = Object.keys(DEFAULTS);
export const getSetting = (db, k) => db.prepare('SELECT value FROM app_settings WHERE key = ?').pluck().get(k) ?? DEFAULTS[k];
export const allSettings = (db) => Object.fromEntries(SETTING_KEYS.map(k => [k, getSetting(db, k)]));
export const setSetting = (db, k, v) => db.prepare('INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run(k, String(v), iso());

// ---------- helpers ----------
const hmac = (s) => crypto.createHmac('sha256', config.jwtSecret).update(s).digest('hex');
export const derivedOtp = (label, key) => String(parseInt(hmac(`${label}:${key}`).slice(0, 8), 16) % 10000).padStart(4, '0');
const otpHash = (otp) => hmac(`otp:${otp}`);
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const mapsLink = (lat, lng, text) => lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text || '')}`;
export const logEvent = (db, orderId, type, actor, meta) => db.prepare('INSERT INTO order_events (order_id,event_type,actor_user_id,actor_role,metadata) VALUES (?,?,?,?,?)')
  .run(orderId, type, actor?.id ?? null, actor?.role ?? 'system', meta ? JSON.stringify(meta) : null);
export const notify = (db, userId, category, title, body, deepLink, orderId, key, kind = 'order_status') =>
  db.prepare('INSERT OR IGNORE INTO notifications (event_id,user_id,category,title,body,deep_link,order_id,kind) VALUES (?,?,?,?,?,?,?,?)')
    .run(key, userId, category, title, body, deepLink ?? null, orderId ?? null, kind);
export const notifyAdmins = (db, title, body, orderId, key) => {
  for (const id of db.prepare("SELECT id FROM users WHERE role='admin' AND active=1").pluck().all()) notify(db, id, 'transactional', title, body, null, orderId, `${key}:${id}`);
};

// ---------- uploads (magic-byte validated; client mime is ignored) ----------
const sniff = (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'png' : b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpg'
  : (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') ? 'webp' : b.subarray(0, 4).toString() === '%PDF' ? 'pdf' : null;
export function saveUpload(base64, { scope, allow = ['png', 'jpg', 'webp'], maxBytes = 3_000_000 }) {
  if (typeof base64 !== 'string') throw Object.assign(new Error('No file received.'), { status: 400 });
  const buf = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!buf.length || buf.length > maxBytes) throw Object.assign(new Error(`File must be under ${Math.floor(maxBytes / 1e6)} MB.`), { status: 400 });
  const ext = sniff(buf);
  if (!ext || !allow.includes(ext)) throw Object.assign(new Error(`Allowed file types: ${allow.join(', ')}.`), { status: 400 });
  const dir = path.join(config.uploadDir, scope); fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return name;
}

// ---------- availability ----------
export const eligibleRiderCount = (db) => db.prepare(`SELECT COUNT(*) FROM riders r JOIN users u ON u.id=r.user_id
  WHERE u.active=1 AND r.verification_status='approved' AND r.is_online=1 AND r.last_seen_at > ?`)
  .pluck().get(new Date(Date.now() - Number(getSetting(db, 'rider_online_ttl_sec')) * 1000).toISOString());
export const reopenDue = (db) => db.prepare(`UPDATE restaurant_operating_status SET is_open=1, reopen_mode=NULL, reopen_at=NULL, updated_at=?
  WHERE is_open=0 AND reopen_mode='auto' AND reopen_at IS NOT NULL AND reopen_at <= ?`).run(iso(), iso()).changes;

// ---------- pricing (server is the only authority) ----------
// Where the order goes: the saved address's map point (customer GPS, or the listed place's point when the customer has none).
const okPoint = (la, ln) => Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180 && !(la === 0 && ln === 0);
export function addressPoint(db, a) {
  if (!a) return { error: 'Choose a delivery address before ordering.', status: 400, code: 'ADDRESS_REQUIRED' };
  let loc = null, point = null, coordSource = null;
  if (a.kind === 'listed') {
    loc = db.prepare('SELECT * FROM delivery_locations WHERE id=? AND active=1').get(a.delivery_location_id);
    if (!loc) return { error: 'The place on this address is no longer on Pakka Local’s list. Choose another place or use your GPS location.', status: 409, code: 'LOCATION_UNAVAILABLE' };
    if (okPoint(a.lat, a.lng)) { point = { lat: a.lat, lng: a.lng }; coordSource = 'customer_gps'; } else if (okPoint(loc.lat, loc.lng)) { point = { lat: loc.lat, lng: loc.lng }; coordSource = 'location'; }
    if (!point) return { error: 'This place has no map point yet. Edit the address and capture your GPS location so the delivery partner can find you.', status: 400, code: 'NO_MAP_POINT' };
  } else {
    if (!okPoint(a.lat, a.lng)) return { error: 'Add a delivery address with your GPS location before ordering.', status: 400, code: 'ADDRESS_REQUIRED' };
    point = { lat: a.lat, lng: a.lng }; coordSource = 'customer_gps';
  }
  return { loc, point, coordSource };
}
export function quote(db, input) {
  reopenDue(db);
  const r = db.prepare('SELECT * FROM restaurants WHERE id=?').get(input.restaurantId);
  if (!r || !r.approved || !r.admin_visible) return { error: 'This restaurant is not available right now.', status: 409 };
  if (!db.prepare('SELECT is_open FROM restaurant_operating_status WHERE restaurant_id=?').pluck().get(r.id)) return { error: 'This restaurant is currently closed.', status: 409 };
  if (eligibleRiderCount(db) === 0) return { error: NO_RIDER_MSG, status: 409, code: 'NO_RIDERS' };
  const want = new Map();
  for (const it of Array.isArray(input.items) ? input.items : []) {
    const id = Number(it.id), q = Number(it.qty);
    if (!Number.isInteger(id) || !Number.isInteger(q) || q < 1 || q > 20) return { error: 'Invalid cart.', status: 400 };
    want.set(id, (want.get(id) || 0) + q);
  }
  if (!want.size || want.size > 30) return { error: 'Your cart is empty.', status: 400 };
  const lines = []; let base = 0, markup = 0, prep = 0;
  for (const [id, qty] of want) {
    const f = db.prepare('SELECT * FROM food_items WHERE id=? AND restaurant_id=? AND deleted=0').get(id, r.id);
    if (!f || !f.available) return { error: `${f ? f.name : 'An item'} is not available.`, status: 409 };
    lines.push({ food_item_id: id, name: f.name, qty, base: f.base_price_paise, price: f.base_price_paise + r.markup_paise, prep: f.prep_time_min });
    base += f.base_price_paise * qty; markup += r.markup_paise * qty; prep = Math.max(prep, f.prep_time_min);
  }
  // Destination = the customer's saved address: GPS coordinates captured on their phone at the delivery point + written details.
  // Every order needs one. If the address is linked to an admin delivery area, that area's fee and surge rules apply exactly as
  // before; otherwise the GPS delivery fee applies (also unchanged).
  // Two kinds of address (decided by the server from the stored address, never by the browser):
  //   listed -> the chosen PG/hostel/college must still be active; ITS delivery charge applies; map point = the customer's own
  //             GPS if they captured one, otherwise the place's map point.
  //   gps    -> not on the list; the fixed GPS-address charge (setting gps_delivery_fee_paise) applies; map point = customer's GPS.
  const a = input.address, ap = addressPoint(db, a); if (ap.error) return ap;
  const { loc, point, coordSource } = ap;
  const words = [loc ? loc.name : a.place_name, a.building, a.block && `Block ${a.block}`, a.floor && `Floor ${a.floor}`, a.room && `Room ${a.room}`].filter(Boolean).join(', ') || 'Saved location';
  const dest = { text: words.slice(0, 200), lat: point.lat, lng: point.lng, link: mapsLink(point.lat, point.lng), kind: loc ? 'listed' : 'gps', locationName: loc?.name ?? null, coordSource };
  if (r.min_order_paise && base + markup < r.min_order_paise) return { error: `Minimum order for this restaurant is ${PLrs(r.min_order_paise)}.`, status: 400, code: 'MIN_ORDER' };
  // Charge: distance-based when the admin has switched it on (for every order: listed places and GPS addresses alike),
  // otherwise the listed place's own charge or the fixed GPS-address charge. The road distance was looked up beforehand
  // (async) by the caller and is passed in as input.route; it is never taken from the browser.
  const dcfg = getDistanceConfig(db); let fee, pricing, priced = null;
  if (dcfg.enabled) {
    if (input.route === undefined) return { error: 'Delivery distance was not calculated.', status: 500 };
    priced = priceFor(dcfg, input.route); if (priced.error) return priced;
    fee = priced.fee; pricing = priced.pricing;
  } else { fee = loc ? loc.delivery_fee_paise : Number(getSetting(db, 'gps_delivery_fee_paise')); pricing = loc ? 'listed' : 'gps_fixed'; }
  const delivery = r.free_delivery_above_paise && base + markup >= r.free_delivery_above_paise ? 0 : fee;     // restaurant-specific delivery rule
  const now = iso();
  let surge = 0;
  for (const s of db.prepare(`SELECT * FROM surge_charge_rules WHERE active=1 AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>=?)
      AND (location_id IS NULL OR location_id=?)`).all(now, now, loc?.id ?? -1)) surge += s.kind === 'fixed' ? s.value : Math.round((base + markup) * s.value / 10000);
  const tax = Math.round((base + markup) * Number(getSetting(db, 'tax_bps')) / 10000);
  const commission = Math.round(base * r.commission_bps / 10000);
  const total = base + markup + delivery + surge + tax;
  const perKm = Number(getSetting(db, 'minutes_per_km'));
  const deliveryMin = loc?.distance_km ? Math.round(loc.distance_km * perKm) + 3 : Number(getSetting(db, 'default_delivery_min'));
  return { restaurant: r, lines, dest, locationId: loc?.id ?? null, feeSource: loc ? 'listed' : 'gps', baseDeliveryFee: fee, pricing,
    distanceM: priced?.distance_m ?? null, band: priced?.band ?? null, routeSource: priced ? (priced.pricing === 'distance' ? priced.source : `none:${priced.reason}`) : null, base, markup, delivery, surge, tax, total, commissionBps: r.commission_bps, commission,
    restaurantPayout: base - commission, riderPayout: Number(getSetting(db, 'rider_payout_paise')), prepMin: prep + r.packing_buffer_min, deliveryMin };
}
const etaFrom = (db, prepMin, deliveryMin, stage) => {
  const rider = Number(getSetting(db, 'rider_to_restaurant_min'));
  const mins = stage === 'PICKED_UP' ? deliveryMin : stage === 'READY' ? rider + deliveryMin : prepMin + rider + deliveryMin;
  return new Date(Date.now() + mins * 60_000).toISOString();
};
const orderMins = (db, o) => {
  const prep = db.prepare('SELECT MAX(prep_time_min) FROM order_items WHERE order_id=?').pluck().get(o.id) || 15;
  const buf = db.prepare('SELECT packing_buffer_min FROM restaurants WHERE id=?').pluck().get(o.restaurant_id);
  const km = o.delivery_location_id ? db.prepare('SELECT distance_km FROM delivery_locations WHERE id=?').pluck().get(o.delivery_location_id) : null;
  return { prep: prep + buf, del: km ? Math.round(km * Number(getSetting(db, 'minutes_per_km'))) + 3 : Number(getSetting(db, 'default_delivery_min')) };
};
const refreshEta = (db, o, stage) => { const m = orderMins(db, o); db.prepare('UPDATE orders SET eta_at=? WHERE id=?').run(etaFrom(db, m.prep, m.del, stage), o.id); };

// ---------- order creation / payment ----------
export function createOrder(db, customer, input) {
  const q = quote(db, input);
  if (q.error) return q;
  const a = input.address;
  const instructions = [a.instructions, input.instructions].map((x) => (x ? String(x).trim() : '')).filter(Boolean).join(' · ').slice(0, 300) || null;
  return db.transaction(() => {
    let code, tries = 0;
    do { code = `PL${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase()}`; }
    while (db.prepare('SELECT 1 FROM orders WHERE order_code=?').get(code) && ++tries < 5);
    // immutable destination snapshot: a copy of the address as confirmed now (trigger trg_order_destination_frozen locks it after payment starts)
    const id = db.prepare(`INSERT INTO orders (order_code,customer_id,restaurant_id,status,delivery_location_id,dest_text,dest_lat,dest_lng,dest_maps_link,instructions,
      customer_name,customer_phone,items_base_paise,markup_paise,delivery_paise,surge_paise,tax_paise,total_paise,commission_bps,commission_paise,restaurant_payout_paise,rider_payout_paise,
      dest_address_id,dest_label,dest_place_name,dest_building,dest_block,dest_floor,dest_room,dest_entrance,dest_landmark,dest_accuracy_m,dest_captured_at,dest_confirmed_at,
      dest_kind,dest_location_name,dest_coord_source,delivery_pricing,delivery_distance_m,delivery_band,delivery_route_source)
      VALUES (?,?,?,'PAYMENT_PENDING',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, customer.id, q.restaurant.id, q.locationId, q.dest.text, q.dest.lat, q.dest.lng, q.dest.link,
      instructions, customer.name, customer.phone, q.base, q.markup, q.delivery, q.surge, q.tax, q.total, q.commissionBps, q.commission, q.restaurantPayout, q.riderPayout,
      a.id, a.label, q.dest.locationName || a.place_name, a.building, a.block, a.floor, a.room, a.entrance, a.landmark,
      q.dest.coordSource === 'customer_gps' ? a.accuracy_m : null, q.dest.coordSource === 'customer_gps' ? a.captured_at : null, iso(),
      q.dest.kind, q.dest.locationName, q.dest.coordSource, q.pricing, q.distanceM, q.band, q.routeSource).lastInsertRowid;
    for (const l of q.lines) db.prepare('INSERT INTO order_items (order_id,food_item_id,name,qty,base_price_paise,customer_price_paise,prep_time_min) VALUES (?,?,?,?,?,?,?)').run(id, l.food_item_id, l.name, l.qty, l.base, l.price, l.prep);
    db.prepare('INSERT INTO payments (order_id,provider,merchant_order_id,amount_paise) VALUES (?,?,?,?)').run(id, config.paymentProvider, code, q.total);
    const mode = getSetting(db, 'delivery_otp_mode') === 'fixed' && getSetting(db, 'fixed_delivery_otp') ? 'fixed' : 'per_order';
    db.prepare('INSERT INTO delivery_verifications (order_id,mode) VALUES (?,?)').run(id, mode);
    logEvent(db, id, 'ORDER_CREATED', { id: customer.id, role: 'customer' }, { total_paise: q.total });
    return { order: db.prepare('SELECT * FROM orders WHERE id=?').get(id) };
  })();
}

export function settlePayment(db, merchantOrderId, outcome, providerTxn, raw) {
  return db.transaction(() => {
    const p = db.prepare('SELECT * FROM payments WHERE merchant_order_id=?').get(merchantOrderId);
    if (!p) return { error: 'Payment not found.', status: 404 };
    if (p.status !== 'PENDING') return { ok: true, duplicate: true };                       // idempotent
    const next = outcome === 'SUCCESS' ? 'SUCCESS' : outcome === 'EXPIRED' ? 'EXPIRED' : 'FAILED';
    db.prepare('UPDATE payments SET status=?, provider_txn_id=?, raw_response=?, updated_at=? WHERE id=? AND status=\'PENDING\'').run(next, providerTxn ?? null, raw ? JSON.stringify(raw).slice(0, 2000) : null, iso(), p.id);
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(p.order_id);
    if (next === 'SUCCESS') {
      if (o.status === 'PAYMENT_PENDING') {
        db.prepare("UPDATE orders SET status='PLACED', updated_at=? WHERE id=?").run(iso(), o.id);
        refreshEta(db, o, 'PLACED');
        logEvent(db, o.id, 'PAYMENT_SUCCESS', null, { provider_txn: providerTxn });
        notify(db, o.customer_id, 'transactional', 'Order placed', `Order ${o.order_code} is confirmed.`, `/user/orders/${o.order_code}`, o.id, `st:${o.id}:PLACED`);
        for (const u of db.prepare('SELECT user_id FROM restaurant_users WHERE restaurant_id=?').pluck().all(o.restaurant_id))
          notify(db, u, 'transactional', 'New order', `New order ${o.order_code}`, `/restaurant/#/order/${o.id}`, o.id, `new:${o.id}:${u}`, 'restaurant_new');
      } else startRefund(db, o, 'Late payment on an expired order');
    } else if (o.status === 'PAYMENT_PENDING') {
      db.prepare('UPDATE orders SET status=?, updated_at=? WHERE id=?').run(next === 'EXPIRED' ? 'EXPIRED' : 'PAYMENT_FAILED', iso(), o.id);
      logEvent(db, o.id, next === 'EXPIRED' ? 'PAYMENT_EXPIRED' : 'PAYMENT_FAILED');
    }
    return { ok: true };
  })();
}

export function startRefund(db, o, reason) {
  const p = db.prepare("SELECT * FROM payments WHERE order_id=? AND status='SUCCESS'").get(o.id);
  if (!p || db.prepare('SELECT 1 FROM refunds WHERE payment_id=?').get(p.id)) return;
  db.prepare('INSERT INTO refunds (order_id,payment_id,merchant_refund_id,amount_paise,reason) VALUES (?,?,?,?,?)').run(o.id, p.id, `${o.order_code}-R1`, p.amount_paise, reason);
  logEvent(db, o.id, 'REFUND_REQUESTED', null, { reason });
  notify(db, o.customer_id, 'transactional', 'Refund initiated', `Refund for ${o.order_code} is being processed.`, `/user/orders/${o.order_code}`, o.id, `st:${o.id}:REFUND_INITIATED`);
}
export function settleRefund(db, refundId, ok) {
  return db.transaction(() => {
    const r = db.prepare('SELECT * FROM refunds WHERE id=?').get(refundId);
    if (!r) return { error: 'Refund not found.', status: 404 };
    if (r.status !== 'REFUND_INITIATED') return { ok: true, duplicate: true };
    db.prepare('UPDATE refunds SET status=?, updated_at=? WHERE id=?').run(ok ? 'REFUND_COMPLETED' : 'REFUND_FAILED', iso(), r.id);
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(r.order_id);
    logEvent(db, o.id, ok ? 'REFUND_COMPLETED' : 'REFUND_FAILED');
    if (ok) notify(db, o.customer_id, 'transactional', 'Refund completed', `Refund for ${o.order_code} is complete.`, `/user/orders/${o.order_code}`, o.id, `st:${o.id}:REFUND_COMPLETED`);
    return { ok: true };
  })();
}
export function expireStalePayments(db) {
  const cutoff = new Date(Date.now() - Number(getSetting(db, 'payment_timeout_min')) * 60_000).toISOString();
  const rows = db.prepare("SELECT p.merchant_order_id FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.status='PENDING' AND o.status='PAYMENT_PENDING' AND p.created_at < ?").pluck().all(cutoff);
  // With a live gateway, query its Order Status API here first; sandbox payments simply time out.
  for (const m of rows) settlePayment(db, m, 'EXPIRED');
  return rows.length;
}

// ---------- restaurant actions ----------
let offerHook = () => {}; export const setOfferHook = (fn) => { offerHook = fn; };
const RS = (db, restId, id) => db.prepare('SELECT * FROM orders WHERE id=? AND restaurant_id=?').get(id, restId);
function move(db, id, from, to, extra = '', params = []) {
  return db.prepare(`UPDATE orders SET status=?, updated_at=?${extra} WHERE id=? AND status IN (${from.map(() => '?').join(',')})`).run(to, iso(), ...params, id, ...from).changes === 1;
}
const statusNote = (db, o, key, title, body) => notify(db, o.customer_id, 'transactional', title, body, `/user/orders/${o.order_code}`, o.id, `st:${o.id}:${key}`);
export function restaurantStep(db, actor, restId, id, step, body = {}) {
  return db.transaction(() => {
    const o = RS(db, restId, id);
    if (!o) return { error: 'Order not found.', status: 404 };
    const bad = { error: 'This order can no longer be changed that way.', status: 409 };
    if (step === 'accept') {
      if (!move(db, id, ['PLACED'], 'ACCEPTED')) return bad;
      refreshEta(db, o, 'ACCEPTED'); logEvent(db, id, 'RESTAURANT_ACCEPTED', actor); offerHook(db, id); statusNote(db, o, 'ACCEPTED', 'Restaurant accepted', `${o.order_code} was accepted.`);
    } else if (step === 'preparing') {
      if (!move(db, id, ['ACCEPTED'], 'PREPARING')) return bad;
      logEvent(db, id, 'PREPARING_STARTED', actor); statusNote(db, o, 'PREPARING', 'Preparing your food', `${o.order_code} is being prepared.`);
    } else if (step === 'ready') {
      if (!move(db, id, ['ACCEPTED', 'PREPARING'], 'READY')) return bad;
      db.prepare('INSERT OR IGNORE INTO pickup_otps (order_id, otp_hash) VALUES (?,?)').run(id, otpHash(derivedOtp('pickup', o.order_code)));
      refreshEta(db, o, 'READY'); logEvent(db, id, 'FOOD_READY', actor); statusNote(db, o, 'READY', 'Ready for pickup', `${o.order_code} is ready for pickup.`);
    } else if (step === 'reject') {
      const reasons = ['Items unavailable', 'Restaurant too busy', 'Restaurant temporarily closed', 'Technical issue', 'Other'];
      if (!reasons.includes(body.reason)) return { error: 'Please choose a rejection reason.', status: 400 };
      if (!move(db, id, ['PLACED'], 'REJECTED', ', rejection_reason=?, rejection_note=?', [body.reason, body.note ? String(body.note).slice(0, 300) : null])) return bad;
      logEvent(db, id, 'RESTAURANT_REJECTED', actor, { reason: body.reason, note: body.note });
      startRefund(db, o, `Rejected: ${body.reason}`);
      statusNote(db, o, 'REJECTED', 'Order rejected', `${o.order_code} was rejected: ${body.reason}. Your refund has been initiated.`);
      notifyAdmins(db, 'Order rejected', `${o.order_code} rejected by restaurant: ${body.reason}`, o.id, `rej:${o.id}`);
    }
    return { ok: true };
  })();
}

// ---------- rider actions ----------
const riderRow = (db, id) => db.prepare('SELECT r.*, u.active FROM riders r JOIN users u ON u.id=r.user_id WHERE r.user_id=?').get(id);
export function claimOrder(db, riderId, orderId) {
  return db.transaction(() => {
    const r = riderRow(db, riderId);
    if (!r || !r.active || r.verification_status !== 'approved' || !r.is_online) return { error: 'You must be online and approved to accept deliveries.', status: 403 };
    const active = db.prepare("SELECT COUNT(*) FROM orders WHERE rider_id=? AND status IN ('ACCEPTED','PREPARING','READY','PICKED_UP')").pluck().get(riderId);
    if (active >= Number(getSetting(db, 'max_active_per_rider'))) return { error: 'Finish your current deliveries first.', status: 409 };
    const gone = { error: 'This order is no longer available.', status: 409 };
    const c = db.prepare("UPDATE orders SET rider_id=?, updated_at=? WHERE id=? AND rider_id IS NULL AND status IN ('ACCEPTED','PREPARING','READY')").run(riderId, iso(), orderId);
    if (c.changes !== 1) return gone;
    try { db.prepare("INSERT INTO rider_assignments (order_id,rider_id,status,responded_at) VALUES (?,?,'ACCEPTED',?) ON CONFLICT(order_id,rider_id) DO UPDATE SET status='ACCEPTED', responded_at=excluded.responded_at").run(orderId, riderId, iso()); }
    catch { throw Object.assign(new Error('race'), { rollback: true }); }
    logEvent(db, orderId, 'RIDER_ACCEPTED', { id: riderId, role: 'rider' });
    return { ok: true };
  })();
}
export function dismissOffer(db, riderId, orderId) {
  db.prepare("INSERT INTO rider_assignments (order_id,rider_id,status,responded_at) VALUES (?,?,'DISMISSED',?) ON CONFLICT(order_id,rider_id) DO NOTHING").run(orderId, riderId, iso());
  return { ok: true };
}
export function verifyPickup(db, riderId, orderId, otp) {
  return db.transaction(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id=? AND rider_id=?').get(orderId, riderId);
    if (!o) return { error: 'Order not found.', status: 404 };
    if (o.status !== 'READY') return { error: o.status === 'PICKED_UP' ? 'Already picked up.' : 'The restaurant has not marked this order ready yet.', status: 409 };
    const p = db.prepare('SELECT * FROM pickup_otps WHERE order_id=?').get(orderId);
    if (!p || p.attempts >= 5) return { error: 'Too many wrong attempts. Contact support.', status: 429 };
    if (!/^\d{4}$/.test(String(otp)) || !same(p.otp_hash, otpHash(String(otp)))) {
      db.prepare('UPDATE pickup_otps SET attempts=attempts+1 WHERE order_id=?').run(orderId);
      return { error: 'Incorrect pickup code.', status: 400, commit: true };
    }
    db.prepare('UPDATE pickup_otps SET verified_at=? WHERE order_id=?').run(iso(), orderId);
    if (!move(db, orderId, ['READY'], 'PICKED_UP')) return { error: 'Order state changed.', status: 409 };
    refreshEta(db, o, 'PICKED_UP');
    logEvent(db, orderId, 'PICKUP_OTP_VERIFIED', { id: riderId, role: 'rider' }); logEvent(db, orderId, 'PICKED_UP', { id: riderId, role: 'rider' });
    statusNote(db, o, 'PICKED_UP', 'Order picked up', `${o.order_code} is on its way.`);
    return { ok: true };
  })();
}
export const deliveryCodeFor = (db, o) => {
  const dv = db.prepare('SELECT mode FROM delivery_verifications WHERE order_id=?').get(o.id);
  return dv?.mode === 'fixed' ? getSetting(db, 'fixed_delivery_otp') : derivedOtp('delivery', o.order_code);
};
export function verifyDelivery(db, riderId, orderId, otp) {
  return db.transaction(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id=? AND rider_id=?').get(orderId, riderId);
    if (!o) return { error: 'Order not found.', status: 404 };
    if (o.status !== 'PICKED_UP') return { error: o.status === 'DELIVERED' ? 'Already delivered.' : 'Pick up the order first.', status: 409 };
    const dv = db.prepare('SELECT * FROM delivery_verifications WHERE order_id=?').get(orderId);
    if (dv.attempts >= 5) return { error: 'Too many wrong attempts. Contact support.', status: 429 };
    const expected = deliveryCodeFor(db, o);
    if (!expected || !/^\d{4,8}$/.test(String(otp)) || !same(otpHash(expected), otpHash(String(otp)))) {
      db.prepare('UPDATE delivery_verifications SET attempts=attempts+1 WHERE order_id=?').run(orderId);
      return { error: 'Incorrect delivery code.', status: 400, commit: true };
    }
    if (!move(db, orderId, ['PICKED_UP'], 'DELIVERED')) return { error: 'Order state changed.', status: 409 };
    db.prepare('UPDATE delivery_verifications SET verified_at=? WHERE order_id=?').run(iso(), orderId);
    const L = (type, id, kind, amt) => amt && db.prepare('INSERT INTO platform_transactions (account_type,account_id,kind,amount_paise,order_id) VALUES (?,?,?,?,?)').run(type, id, kind, amt, orderId);
    L('restaurant', o.restaurant_id, 'restaurant_payout', o.restaurant_payout_paise);
    L('rider', riderId, 'rider_earning', o.rider_payout_paise);
    L('platform', 0, 'markup', o.markup_paise); L('platform', 0, 'commission', o.commission_paise);
    L('platform', 0, 'delivery_margin', o.delivery_paise - o.rider_payout_paise); L('platform', 0, 'surge', o.surge_paise); L('platform', 0, 'tax_liability', o.tax_paise);
    db.prepare('INSERT INTO rider_earnings (rider_id,order_id,amount_paise) VALUES (?,?,?)').run(riderId, orderId, o.rider_payout_paise);
    db.prepare('INSERT INTO restaurant_commissions (order_id,restaurant_id,base_paise,commission_bps,commission_paise,payout_paise) VALUES (?,?,?,?,?,?)').run(orderId, o.restaurant_id, o.items_base_paise, o.commission_bps, o.commission_paise, o.restaurant_payout_paise);
    logEvent(db, orderId, 'DELIVERY_OTP_VERIFIED', { id: riderId, role: 'rider' }); logEvent(db, orderId, 'DELIVERED', { id: riderId, role: 'rider' });
    statusNote(db, o, 'DELIVERED', 'Delivered', `${o.order_code} was delivered. Enjoy!`);
    return { ok: true };
  })();
}

// ---------- ledger / cashouts ----------
export function balances(db, type, id) {
  const sum = (sql, ...a) => db.prepare(sql).pluck().get(...a) || 0;
  const ledger = sum('SELECT SUM(amount_paise) FROM platform_transactions WHERE account_type=? AND account_id=?', type, id);
  const open = sum("SELECT SUM(amount_paise) FROM cashout_requests WHERE account_type=? AND account_id=? AND status IN ('PENDING','APPROVED')", type, id);
  const paid = sum("SELECT SUM(amount_paise) FROM cashout_requests WHERE account_type=? AND account_id=? AND status='PAID'", type, id);
  const earned = sum("SELECT SUM(amount_paise) FROM platform_transactions WHERE account_type=? AND account_id=? AND amount_paise>0", type, id);
  return { earned, available: ledger - open, pending: open, paid };
}
export function requestCashout(db, type, accountId, userId, b) {
  const amount = Number(b.amount_paise);
  if (!Number.isInteger(amount) || amount < 100) return { error: 'Enter a valid amount (minimum ₹1).', status: 400 };
  const method = String(b.payout_method || '').slice(0, 20), ben = String(b.beneficiary || '').trim().slice(0, 120);
  if (!getSetting(db, 'payout_methods').split(',').includes(method) || ben.length < 5) return { error: 'Choose a payout method and enter beneficiary details.', status: 400 };
  return db.transaction(() => {
    if (balances(db, type, accountId).available < amount) return { error: 'Amount exceeds your available balance.', status: 400 };
    try { const id = db.prepare('INSERT INTO cashout_requests (account_type,account_id,requested_by,amount_paise,payout_method,beneficiary) VALUES (?,?,?,?,?,?)').run(type, accountId, userId, amount, method, ben).lastInsertRowid; return { ok: true, id }; }
    catch { return { error: 'You already have an open cashout request.', status: 409 }; }
  })();
}
export function adminCashout(db, admin, id, action, b = {}) {
  return db.transaction(() => {
    const c = db.prepare('SELECT * FROM cashout_requests WHERE id=?').get(id);
    if (!c) return { error: 'Request not found.', status: 404 };
    const upd = (from, to, extra = '', p = []) => db.prepare(`UPDATE cashout_requests SET status=?, decided_by=?, decided_at=?${extra} WHERE id=? AND status IN (${from.map(() => '?').join(',')})`).run(to, admin.id, iso(), ...p, id, ...from).changes === 1;
    if (action === 'approve') return upd(['PENDING'], 'APPROVED') ? { ok: true } : { error: 'Request is not pending.', status: 409 };
    if (action === 'reject') { if (!b.reason) return { error: 'Enter a rejection reason.', status: 400 }; return upd(['PENDING', 'APPROVED'], 'REJECTED', ', reject_reason=?', [String(b.reason).slice(0, 200)]) ? { ok: true } : { error: 'Request already closed.', status: 409 }; }
    if (action === 'pay') {
      const ref = String(b.txn_reference || '').trim();
      if (ref.length < 4) return { error: 'Enter the transaction reference.', status: 400 };
      if (!b.proof) return { error: 'Upload the payment screenshot.', status: 400 };
      const amount = c.amount_paise;
      if (!upd(['PENDING', 'APPROVED'], 'PAID')) return { error: 'Request already closed.', status: 409 };
      const file = saveUpload(b.proof, { scope: 'private', allow: ['png', 'jpg', 'webp', 'pdf'] });
      db.prepare('INSERT INTO cashout_proofs (cashout_id,txn_reference,proof_path,amount_paise,paid_at,uploaded_by) VALUES (?,?,?,?,?,?)').run(id, ref, file, amount, iso(), admin.id);
      db.prepare('INSERT INTO platform_transactions (account_type,account_id,kind,amount_paise,ref_id,note) VALUES (?,?,?,?,?,?)').run(c.account_type, c.account_id, 'cashout_paid', -amount, id, ref);
      db.prepare(c.account_type === 'restaurant' ? 'INSERT INTO restaurant_payouts (restaurant_id,cashout_id,amount_paise,paid_at) VALUES (?,?,?,?)' : 'INSERT INTO rider_payouts (rider_id,cashout_id,amount_paise,paid_at) VALUES (?,?,?,?)').run(c.account_id, id, amount, iso());
      return { ok: true };
    }
    return { error: 'Unknown action.', status: 400 };
  })();
}

// ---------- admin intervention ----------
export function adminCancel(db, admin, orderId, reason) {
  reason = String(reason || '').trim().slice(0, 300);
  if (reason.length < 3) return { error: 'Enter a reason for cancelling.', status: 400 };
  return db.transaction(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!o) return { error: 'Order not found.', status: 404 };
    if (!move(db, orderId, ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP'], 'CANCELLED', ', rejection_reason=?', [`Cancelled by Pakka Local: ${reason}`])) return { error: 'This order can no longer be cancelled.', status: 409 };
    logEvent(db, orderId, 'ADMIN_CANCELLED', admin, { reason, was: o.status, rider_id: o.rider_id });
    logEvent(db, orderId, 'ADMIN_INTERVENTION', admin, { action: 'cancel', reason });
    startRefund(db, o, `Cancelled by admin: ${reason}`);
    notify(db, o.customer_id, 'transactional', 'Order cancelled', `${o.order_code} was cancelled. Your refund has been initiated.`, `/user/orders/${o.order_code}`, o.id, `st:${o.id}:CANCELLED`);
    for (const u of db.prepare('SELECT user_id FROM restaurant_users WHERE restaurant_id=?').pluck().all(o.restaurant_id)) notify(db, u, 'transactional', 'Order cancelled', `${o.order_code} was cancelled by Pakka Local.`, `/restaurant/#/order/${o.id}`, o.id, `cx:${o.id}:${u}`);
    if (o.rider_id) notify(db, o.rider_id, 'transactional', 'Delivery cancelled', `${o.order_code} was cancelled. No action needed.`, '/rider/#/jobs', o.id, `cx:${o.id}:${o.rider_id}`);
    return { ok: true };
  })();
}
export function adminUnassign(db, admin, orderId, note) {
  note = String(note || '').trim().slice(0, 300);
  if (note.length < 3) return { error: 'Enter a reason for taking this delivery off the rider.', status: 400 };
  return db.transaction(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!o || !o.rider_id) return { error: 'No rider is assigned to this order.', status: 409 };
    if (!['ACCEPTED', 'PREPARING', 'READY'].includes(o.status)) return { error: 'The rider has already picked this up. Cancel the order instead.', status: 409 };
    db.prepare("UPDATE rider_assignments SET status='DISMISSED', responded_at=? WHERE order_id=? AND rider_id=? AND status='ACCEPTED'").run(iso(), orderId, o.rider_id);
    db.prepare('UPDATE orders SET rider_id=NULL, updated_at=? WHERE id=? AND rider_id=?').run(iso(), orderId, o.rider_id);
    logEvent(db, orderId, 'ADMIN_INTERVENTION', admin, { action: 'unassign_rider', rider_id: o.rider_id, note: note || null });
    notify(db, o.rider_id, 'transactional', 'Delivery reassigned', `${o.order_code} was taken off you by Pakka Local.`, '/rider/#/jobs', o.id, `un:${o.id}:${o.rider_id}:${Date.now()}`);
    offerHook(db, orderId, o.rider_id);                          // offer to other riders again (not the one removed)
    return { ok: true };
  })();
}
