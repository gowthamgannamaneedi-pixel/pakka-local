import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { config } from '../config.js';
import { perKmRate, straightM, quote, createOrder, settlePayment, eligibleRiderCount, reopenDue, getSetting, deliveryCodeFor, NO_RIDER_MSG } from '../services/core.js';
import { send, parse, wrap, wrapA } from './util.js';
import * as Pricing from '../services/distancePricing.js';
import { addressPoint } from '../services/core.js';
import { iso } from '../services/core.js';
import * as Addr from '../services/addresses.js';
import { customerRefund, submitUpi } from '../services/refunds.js';
import * as Coupons from '../services/coupons.js';
import * as Chat from '../services/chat.js';
import { loginChannel } from '../otpProviders.js';
import { providerName } from '../services/routing.js';
import { availability } from '../services/hours.js';
import * as Support from '../services/support.js';
import { freshness } from '../services/tracking.js';

// An order always goes to one of the customer's own saved GPS addresses, and the customer confirms that delivery point.
const cartSchema = z.object({ restaurant_id: z.number().int(), items: z.array(z.object({ id: z.number().int(), qty: z.number().int() })).max(30),
  address_id: z.number({ required_error: 'Choose a delivery address.', invalid_type_error: 'Choose a delivery address.' }).int().positive(),
  confirm_destination: z.boolean().optional(), instructions: z.string().max(300).optional(), coupon: z.string().max(30).optional() });   // unknown fields (e.g. a client-sent total) are ignored; prices come from the server
const qIn = (d, address, route) => ({ restaurantId: d.restaurant_id, items: d.items, address, instructions: d.instructions, route, coupon: d.coupon || null });
const breakdown = (q) => ({ delivery_type: q.feeSource, delivery_location: q.dest.locationName, delivery_fee_before_offers_paise: q.baseDeliveryFee,
  delivery_pricing: q.pricing, delivery_distance_km: q.distanceM == null ? null : Math.round(q.distanceM / 10) / 100, delivery_band: q.band, delivery_fallback: q.pricing === 'distance_fallback', items_base_paise: q.base, markup_paise: q.markup, delivery_paise: q.delivery, surge_paise: q.surge, tax_paise: q.tax, discount_paise: q.discount, coupon_code: q.coupon?.code ?? null, coupon_error: q.couponError, total_paise: q.total, prep_min: q.prepMin, delivery_min: q.deliveryMin, trip_km: q.trip?.km ?? null, trip_by_road: q.trip?.byRoad ?? null,
  lines: q.lines.map(l => ({ name: l.name, qty: l.qty, price_paise: l.price })) });

// maintenance mode (admin setting): customers cannot quote or place new orders; tracking, support and the other portals keep working
export const MAINT_DEFAULT = 'We are making Pakka Local better. Ordering will be back shortly. Orders already placed will still be delivered.';
export const maintenance = (db) => (getSetting(db, 'maintenance_mode') === '1' ? { message: (getSetting(db, 'maintenance_message') || '').trim() || MAINT_DEFAULT } : null);
export function publicRoutes(db) {
  const r = Router();
  r.get('/config', (req, res) => res.json({ maintenance: maintenance(db), loginChannel: loginChannel(), emailLogin: !!config.emailOtp.enabled, testPayments: config.sandboxPayments, paymentsAvailable: config.sandboxPayments, ridersAvailable: eligibleRiderCount(db) > 0, noRiderMessage: NO_RIDER_MSG }));
  // places on the list (no map points are sent). With ?restaurant_id= each place gets the estimated distance and charge from that
  // restaurant (straight line x the per-km rate, rounded to the rupee); the bill always shows the exact charge.
  r.get('/locations', (req, res) => { const rate = perKmRate(db), rid = Number(req.query.restaurant_id) || 0;
    const rp = rid ? db.prepare('SELECT pickup_lat AS lat, pickup_lng AS lng FROM restaurants WHERE id=? AND approved=1 AND admin_visible=1').get(rid) : null;
    const fixed = getSetting(db, 'fixed_place_fees') === '1';      // older fixed prices only if switched back on
    res.json({ per_km_paise: rate, locations: db.prepare('SELECT id,name,kind,address,area,distance_km,delivery_fee_paise,lat,lng FROM delivery_locations WHERE active=1 ORDER BY name').all().map(({ lat, lng, delivery_fee_paise, ...l }) => {
      if (fixed) l.delivery_fee_paise = delivery_fee_paise;
      if (!rp || rp.lat == null || lat == null) return l; const m = straightM(rp, { lat, lng });
      return { ...l, est_km: Math.round(m / 100) / 10, est_fee_paise: Math.max(Number(getSetting(db, 'gps_min_fee_paise')) || rate, Math.round(m * rate / 1000 / 100) * 100) }; }) }); });
  // what customers see: open only when the switch is on, it is within today's hours and the location is confirmed
  const openInfo = (id) => { const a = availability(db, id); return { is_open: a.open ? 1 : 0, closed_reason: a.open ? null : a.reason, today_hours: a.today ?? null, next_open_at: a.next_open_at ?? null }; };
  r.get('/restaurants', (req, res) => { reopenDue(db);
    res.json({ restaurants: db.prepare(`SELECT r.id,r.name,r.description,r.cuisine,r.logo_path,r.image_path,r.rating,r.packing_buffer_min, COALESCE(s.is_open,0) AS is_open, s.reopen_at, s.reopen_mode,
      (SELECT MIN(prep_time_min) FROM food_items f WHERE f.restaurant_id=r.id AND f.deleted=0) AS min_prep, (SELECT CAST(AVG(prep_time_min) AS INTEGER) FROM food_items f WHERE f.restaurant_id=r.id AND f.deleted=0 AND f.available=1) AS avg_prep, r.rating_count, r.operating_info, r.opens_at, r.closes_at, r.min_order_paise, ROUND(r.pickup_lat, 4) AS lat, ROUND(r.pickup_lng, 4) AS lng, r.free_delivery_above_paise,
      (SELECT substr(group_concat(f.name, ' | '), 1, 600) FROM food_items f WHERE f.restaurant_id=r.id AND f.deleted=0 AND f.available=1) AS dish_names,
      (SELECT COUNT(*) > 0 AND SUM(f.diet = 'veg') = COUNT(*) FROM food_items f WHERE f.restaurant_id=r.id AND f.deleted=0 AND f.available=1) AS veg_only FROM restaurants r LEFT JOIN restaurant_operating_status s ON s.restaurant_id=r.id
      WHERE r.approved=1 AND r.admin_visible=1 ORDER BY r.name`).all().map((x) => ({ ...x, ...openInfo(x.id), eta_min: x.avg_prep ? x.avg_prep + x.packing_buffer_min + Number(getSetting(db, 'rider_to_restaurant_min')) + Number(getSetting(db, 'default_delivery_min')) : null })).sort((a, b) => b.is_open - a.is_open) }); });
  r.get('/restaurants/:id/menu', (req, res) => {
    const rest = db.prepare('SELECT r.id,r.name,r.description,r.cuisine,r.logo_path,r.image_path,r.markup_paise,r.operating_info,r.opens_at,r.closes_at,r.min_order_paise,r.free_delivery_above_paise,r.rating,r.rating_count,COALESCE(s.is_open,0) AS is_open FROM restaurants r LEFT JOIN restaurant_operating_status s ON s.restaurant_id=r.id WHERE r.id=? AND r.approved=1 AND r.admin_visible=1').get(req.params.id);
    if (!rest) return res.status(404).json({ error: 'Restaurant not found.' });
    Object.assign(rest, openInfo(rest.id));
    const items = db.prepare('SELECT id,name,description,image_path,base_price_paise,prep_time_min,available,category_id,diet FROM food_items WHERE restaurant_id=? AND deleted=0 AND NOT (available=0 AND image_path IS NULL) ORDER BY name').all(rest.id)
      .map(i => ({ ...i, restaurant_price_paise: i.base_price_paise, price_paise: i.base_price_paise + rest.markup_paise, base_price_paise: undefined }));
    const categories = db.prepare('SELECT id,name FROM food_categories WHERE restaurant_id=? ORDER BY sort_order, name').all(rest.id);
    res.json({ restaurant: { ...rest, markup_paise: undefined }, items, categories });
  });
  return r;
}

export function customerRoutes(db) {
  const r = Router(), auth = authenticate(db);
  r.use(auth, requireRole('customer'));
  // staging: allow-listed testers, or every customer while admin has test ordering open to everyone (never on production: no test payments there)
  const sandboxTester = (req) => config.appEnv !== 'staging' || getSetting(db, 'test_orders_everyone') === '1' || config.sandboxPhones.includes(req.user.phone);
  r.get('/me', (req, res) => res.json({ user: { id: req.user.id, name: req.user.name, phone: req.user.phone } }));
  // ---------- saved delivery addresses (own addresses only; every query is scoped to the signed-in customer) ----------
  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store, private'); next(); };
  // ---------- help & support: assistant + tickets with the Pakka Local team ----------
  r.post('/support/assistant', noStore, wrap((req, res) => res.json(Support.assistant(db, req.user, req.body?.q))));
  r.post('/support/assistant/unresolved', noStore, wrap((req, res) => res.json(Support.unresolved(db, req.user))));
  r.get('/support/topics', noStore, (req, res) => res.json({ topics: Support.TOPICS }));
  r.get('/support/tickets', noStore, (req, res) => res.json(Support.listMine(db, req.user)));
  r.post('/support/tickets', noStore, wrap((req, res) => send(res, Support.create(db, req.user, req.body || {}), 201)));
  r.get('/support/tickets/:ref', noStore, (req, res) => send(res, Support.getMine(db, req.user, req.params.ref)));
  r.post('/support/tickets/:ref/messages', noStore, wrap((req, res) => send(res, Support.customerSend(db, req.user, req.params.ref, req.body?.body), 201)));
  r.get('/addresses', noStore, (req, res) => res.json({ addresses: Addr.list(db, req.user.id), policy: Addr.gpsPolicy(db), max: Addr.MAX_ADDRESSES,
    gps_fee_paise: Number(getSetting(db, 'gps_delivery_fee_paise')), gps_per_km_paise: perKmRate(db), gps_min_fee_paise: Number(getSetting(db, 'gps_min_fee_paise')) || null }));      // fixed charge for places not on the list (shown before choosing)
  r.post('/addresses', noStore, wrap((req, res) => send(res, Addr.create(db, req.user.id, req.body), 201)));
  r.put('/addresses/:id(\\d+)', noStore, wrap((req, res) => send(res, Addr.update(db, req.user.id, Number(req.params.id), req.body))));
  r.delete('/addresses/:id(\\d+)', noStore, wrap((req, res) => send(res, Addr.remove(db, req.user.id, Number(req.params.id)))));
  const withAddress = (d, req, res) => { const a = Addr.forOrder(db, req.user.id, d.address_id); if (!a) { res.status(404).json({ error: 'That address was not found. Choose or add a delivery address.', code: 'ADDRESS_REQUIRED' }); return null; } return a; };
  // Road distance (only when distance pricing is on): restaurant pickup point -> the address's map point, looked up here on the server.
  // road distance: for distance pricing, and also for the delivery-time estimate whenever a routing service exists
  const routeFor = async (d, a) => { if (!Pricing.getConfig(db).enabled && providerName() === 'none') return undefined; const ap = addressPoint(db, a); if (ap.error) return { distance_m: null, reason: 'invalid_delivery_point' }; return Pricing.routeFor(db, d.restaurant_id, ap.point); };
  r.get('/coupons', wrap((req, res) => res.json({ coupons: Coupons.visibleCoupons(db, req.user.id, req.query.restaurant_id ? Number(req.query.restaurant_id) : null) })));
  const inMaint = (res) => { const m = maintenance(db); if (m) res.status(503).json({ error: m.message, code: 'MAINTENANCE' }); return !!m; };
  r.post('/quote', wrapA(async (req, res) => { if (inMaint(res)) return; const d = parse(cartSchema, req, res); if (!d) return; const a = withAddress(d, req, res); if (!a) return; const q = quote(db, { ...qIn(d, a, await routeFor(d, a)), customerId: req.user.id }); q.error ? send(res, q) : res.json(breakdown(q)); }));
  r.post('/orders', wrapA(async (req, res) => {
    if (inMaint(res)) return;
    // No real payment gateway is integrated yet. Unless this is an explicitly configured test environment, no order is created at all.
    if (!config.sandboxPayments) return res.status(503).json({ error: 'Online ordering is not open yet. Please check back soon.', code: 'ORDERING_CLOSED' });
    if (!sandboxTester(req)) return res.status(403).json({ error: 'This test environment only accepts orders from approved tester numbers.', code: 'NOT_A_TESTER' });
    const d = parse(cartSchema, req, res); if (!d) return;
    if (d.confirm_destination !== true) return res.status(400).json({ error: 'Confirm the delivery point before paying.', code: 'CONFIRM_DESTINATION' });
    const a = withAddress(d, req, res); if (!a) return;
    const c = createOrder(db, { id: req.user.id, name: req.user.name, phone: req.user.phone }, qIn(d, a, await routeFor(d, a)));      // distance re-checked here, never taken from the browser
    if (c.error) return send(res, c);
    res.status(201).json({ order_code: c.order.order_code, total_paise: c.order.total_paise, payment: { provider: 'sandbox', status: 'PENDING' } });
  }));
  // SANDBOX ONLY: stands in for the PhonePe checkout page + signed webhook while testing.
  r.post('/payments/sandbox/:code/complete', wrap((req, res) => {
    if (!config.sandboxPayments || !sandboxTester(req)) return res.status(404).json({ error: 'Not found.' });
    const o = db.prepare('SELECT order_code FROM orders WHERE order_code=? AND customer_id=?').get(req.params.code, req.user.id);
    if (!o) return res.status(404).json({ error: 'Order not found.' });
    const ok = req.body?.outcome === 'success';
    send(res, settlePayment(db, o.order_code, ok ? 'SUCCESS' : 'FAILED', `SBX-${Date.now()}`, { sandbox: true }));
  }));
  r.get('/orders', (req, res) => res.json({ orders: db.prepare(`SELECT o.order_code,o.status,o.total_paise,o.created_at,o.eta_at,o.restaurant_id,r.name AS restaurant,r.logo_path,r.image_path AS restaurant_image,
      (SELECT group_concat(qty || ' × ' || name, ', ') FROM order_items i WHERE i.order_id=o.id) AS summary FROM orders o JOIN restaurants r ON r.id=o.restaurant_id
    WHERE o.customer_id=? ORDER BY o.id DESC LIMIT 50`).all(req.user.id) }));
  // the customer adds (or corrects) the UPI ID for a refund the system already started; it never starts one
  r.post('/orders/:code/refund-upi', wrap((req, res) => send(res, submitUpi(db, req.user.id, req.params.code, req.body || {}))));
  // order chat with the assigned delivery partner (this customer's own order only)
  r.get('/orders/:code/messages', (req, res) => send(res, Chat.list(db, req.user, req.params.code, { after: req.query.after })));
  r.post('/orders/:code/messages', wrap((req, res) => send(res, Chat.send(db, req.user, req.params.code, req.body?.body), 201)));
  r.get('/orders/:code', (req, res) => {
    const o = db.prepare('SELECT o.*, r.name AS restaurant_name, r.image_path AS restaurant_image FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.order_code=? AND o.customer_id=?').get(req.params.code, req.user.id);
    if (!o) return res.status(404).json({ error: 'Order not found.' });
    const out = { order_code: o.order_code, status: o.status, restaurant: o.restaurant_name, restaurant_image: o.restaurant_image, dest_text: o.dest_text, instructions: o.instructions, eta_at: o.eta_at, created_at: o.created_at,
      destination: { kind: o.dest_kind, location_name: o.dest_location_name, coord_source: o.dest_coord_source, label: o.dest_label, place_name: o.dest_place_name, building: o.dest_building, block: o.dest_block, floor: o.dest_floor, room: o.dest_room, entrance: o.dest_entrance, landmark: o.dest_landmark,
        lat: o.dest_lat, lng: o.dest_lng, accuracy_m: o.dest_accuracy_m, captured_at: o.dest_captured_at },          // the customer's own order only
      items_base_paise: o.items_base_paise, markup_paise: o.markup_paise, delivery_paise: o.delivery_paise, surge_paise: o.surge_paise, tax_paise: o.tax_paise, discount_paise: o.discount_paise, coupon_code: o.coupon_code, total_paise: o.total_paise, rejection_reason: o.rejection_reason };
    out.items = db.prepare('SELECT name,qty,customer_price_paise AS price_paise FROM order_items WHERE order_id=?').all(o.id);
    out.events = db.prepare("SELECT event_type,created_at FROM order_events WHERE order_id=? AND event_type IN ('PAYMENT_SUCCESS','RESTAURANT_ACCEPTED','PREPARING_STARTED','FOOD_READY','PICKED_UP','DELIVERED','RESTAURANT_REJECTED','RIDER_ACCEPTED') ORDER BY id").all(o.id);
    out.payment = db.prepare('SELECT status FROM payments WHERE order_id=?').pluck().get(o.id);
    out.refund = db.prepare('SELECT status FROM refunds WHERE order_id=?').pluck().get(o.id) || null;
    out.refund_detail = customerRefund(db, o.id);
    // true while the arrival time is being recalculated from the delivery partner's live position
    out.eta_live = o.status === 'PICKED_UP' && !!o.rider_id && ['live', 'stale'].includes(freshness(db.prepare('SELECT received_at FROM rider_locations WHERE rider_id=?').get(o.rider_id)).state);
    out.chat = { open: !!o.rider_id && ['ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP'].includes(o.status), unread: Chat.unreadFor(db, 'customer', o.id), any: !!db.prepare('SELECT 1 FROM order_messages WHERE order_id=?').get(o.id) };
    out.rating = db.prepare('SELECT stars FROM order_ratings WHERE order_id=?').pluck().get(o.id) || null;
    if (['PICKED_UP', 'DELIVERED'].includes(o.status) && o.rider_id) {          // rider identity only after pickup
      out.rider = db.prepare(`SELECT u.name,u.phone,r.vehicle_category,r.vehicle_make,r.vehicle_model,r.vehicle_reg_no,(r.photo_path IS NOT NULL) AS has_photo FROM riders r JOIN users u ON u.id=r.user_id WHERE r.user_id=?`).get(o.rider_id);
    }
    if (o.status === 'PICKED_UP') out.delivery_otp = deliveryCodeFor(db, o);
    res.json(out);
  });
  r.post('/orders/:code/rating', wrap((req, res) => {
    const d = parse(z.object({ stars: z.number().int().min(1).max(5), comment: z.string().trim().max(300).optional() }), req, res); if (!d) return;
    const o = db.prepare("SELECT id, restaurant_id FROM orders WHERE order_code=? AND customer_id=? AND status='DELIVERED'").get(req.params.code, req.user.id);
    if (!o) return res.status(404).json({ error: 'You can rate an order after it is delivered.' });
    db.transaction(() => {
      if (!db.prepare('INSERT OR IGNORE INTO order_ratings (order_id,restaurant_id,customer_id,stars,comment) VALUES (?,?,?,?,?)').run(o.id, o.restaurant_id, req.user.id, d.stars, d.comment ?? null).changes) throw Object.assign(new Error('You have already rated this order.'), { status: 409 });
      const a = db.prepare('SELECT AVG(stars) AS avg, COUNT(*) AS n FROM order_ratings WHERE restaurant_id=?').get(o.restaurant_id);
      db.prepare('UPDATE restaurants SET rating=?, rating_count=? WHERE id=?').run(Math.round(a.avg * 10) / 10, a.n, o.restaurant_id);
    })();
    res.status(201).json({ ok: true });
  }));
  r.get('/preferences', (req, res) => res.json({ promo_opt_in: !!db.prepare('SELECT promo_opt_in FROM customers WHERE user_id=?').pluck().get(req.user.id), devices: db.prepare('SELECT COUNT(*) FROM push_subscriptions WHERE user_id=?').pluck().get(req.user.id) }));
  r.put('/preferences', (req, res) => { db.prepare('UPDATE customers SET promo_opt_in=? WHERE user_id=?').run(req.body?.promo_opt_in ? 1 : 0, req.user.id); res.json({ ok: true }); });    // promotions only; order updates are unaffected
  r.get('/notifications', (req, res) => res.json({ notifications: db.prepare('SELECT id,title,body,deep_link,created_at,read_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id),
    unread: db.prepare('SELECT COUNT(*) FROM notifications WHERE user_id=? AND read_at IS NULL').pluck().get(req.user.id) }));
  r.post('/notifications/read', (req, res) => { db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(new Date().toISOString(), req.user.id); res.json({ ok: true }); });
  return r;
}
