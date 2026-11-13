import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { config } from '../config.js';
import { quote, createOrder, settlePayment, eligibleRiderCount, reopenDue, getSetting, deliveryCodeFor, NO_RIDER_MSG } from '../services/core.js';
import { send, parse, wrap } from './util.js';
import { iso } from '../services/core.js';

const cartSchema = z.object({ restaurant_id: z.number().int(), items: z.array(z.object({ id: z.number().int(), qty: z.number().int() })).max(30),
  location_id: z.number().int().nullish(), lat: z.number().nullish(), lng: z.number().nullish(), dest_text: z.string().max(200).optional(), instructions: z.string().max(300).optional() });
const qIn = (d) => ({ restaurantId: d.restaurant_id, items: d.items, locationId: d.location_id, lat: d.lat, lng: d.lng, destText: d.dest_text, instructions: d.instructions });
const breakdown = (q) => ({ items_base_paise: q.base, markup_paise: q.markup, delivery_paise: q.delivery, surge_paise: q.surge, tax_paise: q.tax, total_paise: q.total, prep_min: q.prepMin, delivery_min: q.deliveryMin,
  lines: q.lines.map(l => ({ name: l.name, qty: l.qty, price_paise: l.price })) });

export function publicRoutes(db) {
  const r = Router();
  r.get('/config', (req, res) => res.json({ testPayments: config.sandboxPayments, paymentsAvailable: config.sandboxPayments, ridersAvailable: eligibleRiderCount(db) > 0, noRiderMessage: NO_RIDER_MSG }));
  r.get('/locations', (req, res) => res.json({ locations: db.prepare('SELECT id,name,kind,address,area,delivery_fee_paise,distance_km FROM delivery_locations WHERE active=1 ORDER BY name').all() }));
  r.get('/restaurants', (req, res) => { reopenDue(db);
    res.json({ restaurants: db.prepare(`SELECT r.id,r.name,r.description,r.cuisine,r.logo_path,r.image_path,r.rating,r.packing_buffer_min, COALESCE(s.is_open,0) AS is_open, s.reopen_at, s.reopen_mode,
      (SELECT MIN(prep_time_min) FROM food_items f WHERE f.restaurant_id=r.id AND f.deleted=0) AS min_prep, (SELECT CAST(AVG(prep_time_min) AS INTEGER) FROM food_items f WHERE f.restaurant_id=r.id AND f.deleted=0 AND f.available=1) AS avg_prep, r.rating_count, r.operating_info, r.min_order_paise, r.free_delivery_above_paise FROM restaurants r LEFT JOIN restaurant_operating_status s ON s.restaurant_id=r.id
      WHERE r.approved=1 AND r.admin_visible=1 ORDER BY is_open DESC, r.name`).all().map((x) => ({ ...x, eta_min: x.avg_prep ? x.avg_prep + x.packing_buffer_min + Number(getSetting(db, 'rider_to_restaurant_min')) + Number(getSetting(db, 'default_delivery_min')) : null })) }); });
  r.get('/restaurants/:id/menu', (req, res) => {
    const rest = db.prepare('SELECT r.id,r.name,r.description,r.cuisine,r.logo_path,r.image_path,r.markup_paise,r.operating_info,r.min_order_paise,r.free_delivery_above_paise,r.rating,r.rating_count,COALESCE(s.is_open,0) AS is_open FROM restaurants r LEFT JOIN restaurant_operating_status s ON s.restaurant_id=r.id WHERE r.id=? AND r.approved=1 AND r.admin_visible=1').get(req.params.id);
    if (!rest) return res.status(404).json({ error: 'Restaurant not found.' });
    const items = db.prepare('SELECT id,name,description,image_path,base_price_paise,prep_time_min,available,category_id FROM food_items WHERE restaurant_id=? AND deleted=0 ORDER BY name').all(rest.id)
      .map(i => ({ ...i, restaurant_price_paise: i.base_price_paise, price_paise: i.base_price_paise + rest.markup_paise, base_price_paise: undefined }));
    const categories = db.prepare('SELECT id,name FROM food_categories WHERE restaurant_id=? ORDER BY sort_order, name').all(rest.id);
    res.json({ restaurant: { ...rest, markup_paise: undefined }, items, categories });
  });
  return r;
}

export function customerRoutes(db) {
  const r = Router(), auth = authenticate(db);
  r.use(auth, requireRole('customer'));
  const sandboxTester = (req) => config.appEnv !== 'staging' || config.sandboxPhones.includes(req.user.phone);      // staging: allow-listed testers only
  r.get('/me', (req, res) => res.json({ user: { id: req.user.id, name: req.user.name, phone: req.user.phone } }));
  r.post('/quote', wrap((req, res) => { const d = parse(cartSchema, req, res); if (!d) return; const q = quote(db, qIn(d)); q.error ? send(res, q) : res.json(breakdown(q)); }));
  r.post('/orders', wrap(async (req, res) => {
    // No real payment gateway is integrated yet. Unless this is an explicitly configured test environment, no order is created at all.
    if (!config.sandboxPayments) return res.status(503).json({ error: 'Online ordering is not open yet. Please check back soon.', code: 'ORDERING_CLOSED' });
    if (!sandboxTester(req)) return res.status(403).json({ error: 'This test environment only accepts orders from approved tester numbers.', code: 'NOT_A_TESTER' });
    const d = parse(cartSchema, req, res); if (!d) return;
    const c = createOrder(db, { id: req.user.id, name: req.user.name, phone: req.user.phone }, qIn(d));
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
  r.get('/orders', (req, res) => res.json({ orders: db.prepare(`SELECT o.order_code,o.status,o.total_paise,o.created_at,r.name AS restaurant FROM orders o JOIN restaurants r ON r.id=o.restaurant_id
    WHERE o.customer_id=? ORDER BY o.id DESC LIMIT 50`).all(req.user.id) }));
  r.get('/orders/:code', (req, res) => {
    const o = db.prepare('SELECT o.*, r.name AS restaurant_name FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.order_code=? AND o.customer_id=?').get(req.params.code, req.user.id);
    if (!o) return res.status(404).json({ error: 'Order not found.' });
    const out = { order_code: o.order_code, status: o.status, restaurant: o.restaurant_name, dest_text: o.dest_text, instructions: o.instructions, eta_at: o.eta_at, created_at: o.created_at,
      items_base_paise: o.items_base_paise, markup_paise: o.markup_paise, delivery_paise: o.delivery_paise, surge_paise: o.surge_paise, tax_paise: o.tax_paise, total_paise: o.total_paise, rejection_reason: o.rejection_reason };
    out.items = db.prepare('SELECT name,qty,customer_price_paise AS price_paise FROM order_items WHERE order_id=?').all(o.id);
    out.events = db.prepare("SELECT event_type,created_at FROM order_events WHERE order_id=? AND event_type IN ('PAYMENT_SUCCESS','RESTAURANT_ACCEPTED','PREPARING_STARTED','FOOD_READY','PICKED_UP','DELIVERED','RESTAURANT_REJECTED') ORDER BY id").all(o.id);
    out.payment = db.prepare('SELECT status FROM payments WHERE order_id=?').pluck().get(o.id);
    out.refund = db.prepare('SELECT status FROM refunds WHERE order_id=?').pluck().get(o.id) || null;
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
