import { Router } from 'express';
import { config } from '../config.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authenticate, requireRole, audit, requireFreshAuth } from '../auth.js';
import { adminView, decide, revealPayout, missing, DOC_LABEL, ID_TYPES } from '../services/riderApplication.js';
import * as Locs from '../services/locations.js';
import * as Pricing from '../services/distancePricing.js';
import * as Routing from '../services/routing.js';
import { perKmRate, allSettings, setSetting, SETTING_KEYS, adminCashout, balances, settleRefund, eligibleRiderCount, getSetting, iso, adminCancel, adminUnassign } from '../services/core.js';
import { send, parse, wrap, wrapA, money } from './util.js';
import { importMenu } from '../services/menuImport.js';
import { newSecret, encrypt, decrypt, verifyTotp, otpauthUri } from '../totp.js';
import { audienceUsers, campaignStats, processCampaigns } from '../services/push.js';
import { saveUpload } from '../services/core.js';
import { USERNAME_RE } from './auth.js';
import { mountMenu, ADDR, saveAddress, putHours, setStatus } from './restaurant.js';
import { restaurantStep } from '../services/core.js';
import * as Hours from '../services/hours.js';
import * as Support from '../services/support.js';
import * as Coupons from '../services/coupons.js';
import * as Refunds from '../services/refunds.js';

const IST = 330 * 60_000;
const dayStart = (offset = 0) => { const t = Date.now() + IST; return new Date(Math.floor(t / 864e5) * 864e5 + offset * 864e5 - IST).toISOString(); };
function range(q) {
  const p = q.preset || 'today';
  if (p === 'today') return [dayStart(), dayStart(1)];
  if (p === 'yesterday') return [dayStart(-1), dayStart()];
  if (p === '7d') return [dayStart(-6), dayStart(1)];
  if (p === '30d') return [dayStart(-29), dayStart(1)];
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (p === 'custom' && ok(q.from) && ok(q.to)) return [new Date(Date.parse(q.from) - IST).toISOString(), new Date(Date.parse(q.to) + 864e5 - IST).toISOString()];
  return [dayStart(), dayStart(1)];
}

export function adminRoutes(db) {
  const r = Router();
  r.use(authenticate(db), requireRole('admin'));
  const fresh = requireFreshAuth(db);
  r.get('/ping', (req, res) => res.json({ ok: true }));
  const one = (sql, ...a) => db.prepare(sql).pluck().get(...a) || 0;

  r.post('/users', wrap((req, res) => {
    const d = parse(z.object({ role: z.enum(['restaurant', 'rider', 'admin']), name: z.string().trim().min(1).max(80), phone: z.string().trim().regex(/^\+[1-9]\d{9,14}$/, 'Use international format, e.g. +919876543210'),
      password: z.string().min(10).max(128), restaurant_id: z.number().int().positive().optional(), approve_now: z.any().optional() }), req, res); if (!d) return;
    if (d.role === 'restaurant' && !db.prepare('SELECT 1 FROM restaurants WHERE id = ?').get(d.restaurant_id)) return res.status(400).json({ error: 'A valid restaurant_id is required for restaurant accounts.' });
    if (db.prepare('SELECT 1 FROM users WHERE phone = ? AND role = ?').get(d.phone, d.role)) return res.status(409).json({ error: `That mobile number already has a ${{ restaurant: 'restaurant login', rider: 'delivery-agent account', admin: 'admin account' }[d.role]}.` });      // the same number may also be a customer or another kind of account
    const id = db.transaction(() => {
      const uid = db.prepare('INSERT INTO users (role, phone, name, password_hash) VALUES (?,?,?,?)').run(d.role, d.phone, d.name, bcrypt.hashSync(d.password, 12)).lastInsertRowid;
      if (d.role === 'restaurant') db.prepare('INSERT INTO restaurant_users VALUES (?,?)').run(uid, d.restaurant_id);
      if (d.role === 'rider') db.prepare("INSERT INTO riders (user_id, verification_status) VALUES (?, 'draft')").run(uid);   // every agent completes and submits the application; there is no shortcut to approved
      audit(db, req, 'user.create', 'user', uid, { role: d.role }); return uid;
    })();
    res.status(201).json({ id });
  }));

  // overview
  r.get('/overview', (req, res) => {
    const [from, to] = range(req.query), live = (s) => one('SELECT COUNT(*) FROM orders WHERE status=?', s);
    const plat = (kinds) => one(`SELECT SUM(amount_paise) FROM platform_transactions WHERE account_type='platform' AND kind IN (${kinds.map(() => '?').join(',')}) AND created_at>=? AND created_at<?`, ...kinds, from, to);
    const collected = one("SELECT SUM(total_paise) FROM orders WHERE status='DELIVERED' AND updated_at>=? AND updated_at<?", from, to);
    const revenue = plat(['markup', 'commission', 'delivery_margin', 'surge', 'coupon']);
    const gateway = Math.round(collected * Number(getSetting(db, 'gateway_fee_bps')) / 10000);
    const refunds = one("SELECT SUM(amount_paise) FROM refunds WHERE created_at>=? AND created_at<?", from, to);
    const liab = (t) => one("SELECT SUM(amount_paise) FROM platform_transactions WHERE account_type=?", t);
    const dayRev = (a, b) => one("SELECT SUM(amount_paise) FROM platform_transactions WHERE account_type='platform' AND kind IN ('markup','commission','delivery_margin','surge','coupon') AND created_at>=? AND created_at<?", a, b);
    const expenses = one('SELECT SUM(amount_paise) FROM operating_expenses WHERE spent_on>=? AND spent_on<=?', new Date(Date.parse(from) + IST).toISOString().slice(0, 10), new Date(Date.parse(to) + IST - 1).toISOString().slice(0, 10));
    const day = (col) => `substr(datetime(${col}, '+330 minutes'), 1, 10)`;
    const rev = Object.fromEntries(db.prepare(`SELECT ${day('created_at')} AS d, SUM(amount_paise) AS v FROM platform_transactions WHERE account_type='platform' AND kind IN ('markup','commission','delivery_margin','surge','coupon') AND created_at>=? AND created_at<? GROUP BY d`).all(from, to).map((x) => [x.d, x.v]));
    const col = Object.fromEntries(db.prepare(`SELECT ${day('updated_at')} AS d, SUM(total_paise) AS v, COUNT(*) AS n FROM orders WHERE status='DELIVERED' AND updated_at>=? AND updated_at<? GROUP BY d`).all(from, to).map((x) => [x.d, x]));
    const daily = []; for (let t = Date.parse(from), i = 0; t < Date.parse(to) && i < 62; t += 864e5, i++) { const d = new Date(t + IST).toISOString().slice(0, 10); daily.push({ date: d, revenue_paise: rev[d] || 0, collected_paise: col[d]?.v || 0, orders: col[d]?.n || 0 }); }
    res.json({ daily, range: { from, to }, current: { pending_acceptance: live('PLACED'), preparing: live('ACCEPTED') + live('PREPARING'), ready: live('READY'), active_deliveries: live('PICKED_UP'), delivered: one("SELECT COUNT(*) FROM orders WHERE status='DELIVERED' AND updated_at>=? AND updated_at<?", from, to), rejected: one("SELECT COUNT(*) FROM orders WHERE status='REJECTED' AND updated_at>=? AND updated_at<?", from, to) },
      money: { collected_paise: collected, platform_revenue_paise: revenue, markup_paise: plat(['markup']), commission_paise: plat(['commission']), delivery_margin_paise: plat(['delivery_margin']), surge_paise: plat(['surge']), coupon_discount_paise: -plat(['coupon']), tax_liability_paise: plat(['tax_liability']),
        gateway_fee_estimate_paise: gateway, expenses_paise: expenses, refunds_paise: refunds, estimated_net_profit_paise: revenue - gateway - expenses,
        restaurant_payable_paise: liab('restaurant') - one("SELECT SUM(amount_paise) FROM cashout_requests WHERE account_type='restaurant' AND status IN ('PENDING','APPROVED')") * 0,
        rider_payable_paise: liab('rider'), today_revenue_paise: dayRev(dayStart(), dayStart(1)), yesterday_revenue_paise: dayRev(dayStart(-1), dayStart()), all_time_revenue_paise: dayRev('0', '9'),
        delivery_collected_paise: one("SELECT SUM(delivery_paise) FROM orders WHERE status='DELIVERED' AND updated_at>=? AND updated_at<?", from, to) },
      riders_available: eligibleRiderCount(db), pending_cashouts: one("SELECT COUNT(*) FROM cashout_requests WHERE status='PENDING'"), pending_riders: one("SELECT COUNT(*) FROM riders WHERE verification_status='pending'"),
      pending_refunds: one("SELECT COUNT(*) FROM refunds WHERE status='REFUND_INITIATED'") });
  });
  // "Needs attention": live counts computed from the data itself (no stored flags), each with the screen that resolves it.
  r.get('/attention', (req, res) => {
    const t = getSetting(db, 'restaurant_accept_timeout_min'), today = new Date(Date.now() + IST).toISOString().slice(0, 10);
    const placedOver = t ? one(`SELECT COUNT(*) FROM orders o WHERE o.status='PLACED' AND COALESCE((SELECT created_at FROM order_events e WHERE e.order_id=o.id AND e.event_type='PAYMENT_SUCCESS' ORDER BY id LIMIT 1), o.created_at) < ?`, new Date(Date.now() - Number(t) * 60_000).toISOString()) : 0;
    const items = [
      { key: 'verify', level: 'warn', n: one("SELECT COUNT(*) FROM riders WHERE verification_status='pending'"), text: 'delivery-agent application(s) waiting for review', path: '/riders', set: 'pending' },
      { key: 'reverify', level: 'info', n: one("SELECT COUNT(*) FROM riders WHERE verification_status='reverification_required'"), text: 'agent(s) need re-verification before new deliveries', path: '/riders', set: 'reverification_required' },
      { key: 'no_riders', level: 'bad', n: eligibleRiderCount(db) ? 0 : 1, text: 'No approved delivery agent is online, so customers cannot order', path: '/riders', set: 'approved', flag: true },
      { key: 'placed_over', level: 'bad', n: placedOver, text: `order(s) waiting for the restaurant longer than ${t} min`, path: '/orders', flag: false },
      { key: 'placed', level: 'warn', n: t ? 0 : one("SELECT COUNT(*) FROM orders WHERE status='PLACED'"), text: 'order(s) waiting for a restaurant to accept', path: '/orders' },
      { key: 'unassigned', level: 'warn', n: one("SELECT COUNT(*) FROM orders WHERE rider_id IS NULL AND status IN ('ACCEPTED','PREPARING','READY')"), text: 'accepted order(s) without a delivery agent yet', path: '/orders' },
      { key: 'cashouts', level: 'warn', n: one("SELECT COUNT(*) FROM cashout_requests WHERE status IN ('PENDING','APPROVED')"), text: 'payout request(s) to process', path: '/cashouts' },
      { key: 'refunds', level: 'warn', n: one("SELECT COUNT(*) FROM refunds WHERE stage IN ('requested','approved')"), text: 'refund(s) with UPI details waiting for review or payment', path: '/refunds' },
      { key: 'support', level: 'warn', n: one("SELECT COUNT(*) FROM support_tickets WHERE status='open'"), text: 'customer support ticket(s) waiting for a reply', path: '/support' },
      { key: 'pay_failed', level: 'info', n: one("SELECT COUNT(*) FROM payments WHERE status IN ('FAILED','EXPIRED') AND substr(datetime(created_at,'+330 minutes'),1,10)=?", today), text: 'payment(s) failed or expired today', path: '/orders' },
      { key: 'closed', level: 'info', n: one('SELECT COUNT(*) FROM restaurants r LEFT JOIN restaurant_operating_status s ON s.restaurant_id=r.id WHERE r.admin_visible=1 AND r.approved=1 AND COALESCE(s.is_open,0)=0'), text: 'visible restaurant(s) are closed right now', path: '/restaurants' },
      { key: 'routing_off', level: 'bad', n: Pricing.getConfig(db).enabled && Routing.providerName() === 'none' ? 1 : 0, text: 'Distance pricing is on but no routing engine is set up (OSRM_URL), so every order uses the fallback charge or is refused', path: '/distance', flag: true },
      { key: 'no_pickup', level: 'warn', n: Pricing.getConfig(db).enabled ? one('SELECT COUNT(*) FROM restaurants WHERE admin_visible=1 AND approved=1 AND pickup_lat IS NULL') : 0, text: 'visible restaurant(s) have no pickup point, so distance cannot be calculated for them', path: '/distance' },
      { key: 'no_photo', level: 'info', n: one('SELECT COUNT(*) FROM food_items WHERE deleted=0 AND available=1 AND image_path IS NULL'), text: 'dish(es) shown without a photo (added before photos were required)', path: '/restaurants' }
    ].filter((x) => x.n > 0);
    res.json({ items, total: items.filter((x) => x.level !== 'info').reduce((s, x) => s + (x.flag ? 1 : x.n), 0) });
  });
  r.get('/notifications', (req, res) => { const n = db.prepare('SELECT id,title,body,created_at,read_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30').all(req.user.id); res.json({ notifications: n }); });

  // orders
  r.get('/orders', (req, res) => res.json({ orders: db.prepare(`SELECT o.order_code,o.status,o.total_paise,o.created_at,r.name AS restaurant,o.customer_name FROM orders o JOIN restaurants r ON r.id=o.restaurant_id
    ${req.query.status ? 'WHERE o.status=?' : 'WHERE o.status NOT IN (\'PAYMENT_PENDING\')'} ORDER BY o.id DESC LIMIT 100`).all(...(req.query.status ? [String(req.query.status)] : [])) }));
  // Read-only customer directory for the admin portal (no actions; order totals count delivered orders only).
  r.get('/customers', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    res.json({ total: db.prepare("SELECT COUNT(*) FROM users WHERE role='customer'").pluck().get(),
      customers: db.prepare(`SELECT u.id,u.name,u.phone,u.active,u.created_at,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id=u.id AND o.status NOT IN ('PAYMENT_PENDING','PAYMENT_FAILED','EXPIRED')) AS orders,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id=u.id AND o.status='DELIVERED') AS delivered,
        (SELECT COALESCE(SUM(o.total_paise),0) FROM orders o WHERE o.customer_id=u.id AND o.status='DELIVERED') AS spent_paise,
        (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id=u.id) AS last_order_at
        FROM users u WHERE u.role='customer' ${q ? 'AND (u.name LIKE ? OR u.phone LIKE ?)' : ''} ORDER BY u.id DESC LIMIT 200`).all(...(q ? [`%${q}%`, `%${q}%`] : [])) });
  });
  r.get('/orders/search/:code', (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE order_code=?').get(String(req.params.code).trim().toUpperCase());
    if (!o) return res.status(404).json({ error: 'No order found with that ID.' });
    res.json({ order: o, restaurant: db.prepare('SELECT id,name,address,phone FROM restaurants WHERE id=?').get(o.restaurant_id),
      rider: o.rider_id ? db.prepare('SELECT u.name,u.phone,r.vehicle_reg_no FROM users u JOIN riders r ON r.user_id=u.id WHERE u.id=?').get(o.rider_id) : null,
      items: db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id), payment: db.prepare('SELECT provider,merchant_order_id,provider_txn_id,status,amount_paise FROM payments WHERE order_id=?').get(o.id),
      refund: db.prepare('SELECT id,status,amount_paise,reason FROM refunds WHERE order_id=?').get(o.id) || null,
      events: db.prepare('SELECT e.event_type,e.actor_role,e.actor_user_id,e.metadata,e.created_at,u.name AS actor_name FROM order_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE order_id=? ORDER BY e.id').all(o.id),
      platform_revenue_paise: o.markup_paise + o.commission_paise + (o.delivery_paise - o.rider_payout_paise) + o.surge_paise - (o.discount_paise || 0) });
  });
  // manual UPI refunds: list (full UPI IDs, admins only), approve / reject / paid (fresh password) / failed
  // Restaurant menus (Super Admin): add, edit, hide or delete dishes and categories for any restaurant.
  // Same rules as the restaurant portal (mountMenu); every change is written to the audit log.
  const am = Router({ mergeParams: true });
  am.use((req, res, next) => {
    if (!/^\/(menu|categories|category-presets)(\/|$)/.test(req.path)) return next('router');      // other /restaurants/:id routes are handled below as before
    const rid = Number(req.params.rid); if (!db.prepare('SELECT 1 FROM restaurants WHERE id=?').get(rid)) return res.status(404).json({ error: 'Restaurant not found.' });
    req.restaurantId = rid;
    if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 300) audit(db, req, `menu.${req.method.toLowerCase()}`, 'restaurant', rid, { path: req.path, name: req.body?.name }); });
    next(); });
  mountMenu(am, db);
  r.use('/restaurants/:rid(\\d+)', am);
  // Import menu: many dishes at once from a pasted list (Category, Dish, Price, Diet, Prep_min). check=true only counts.
  r.post('/restaurants/:rid(\\d+)/menu-import', wrap((req, res) => {
    const d = parse(z.object({ csv: z.string().max(200_000), check: z.boolean().optional() }), req, res); if (!d) return;
    const rid = Number(req.params.rid); if (!db.prepare('SELECT 1 FROM restaurants WHERE id=?').get(rid)) return res.status(404).json({ error: 'Restaurant not found.' });
    const out = importMenu(db, rid, d.csv, { dryRun: !!d.check });
    if (!out.ok) return res.status(out.status).json({ error: out.error, errors: out.errors });
    if (!d.check) audit(db, req, 'menu.import', 'restaurant', rid, { added: out.added, skipped: out.skipped, new_categories: out.new_categories.length });
    res.json(out); }));
  // Coupons (Super Admin). Discount is paid by Pakka Local; payouts unaffected.
  r.get('/coupons', (req, res) => res.json({ coupons: Coupons.adminList(db), restaurants: db.prepare('SELECT id,name FROM restaurants ORDER BY name').all() }));
  r.post('/coupons', wrap((req, res) => { const out = Coupons.save(db, req.user, req.body || {}); if (out.ok) audit(db, req, 'coupon.create', 'coupon', out.id, { code: req.body?.code }); send(res, out, 201); }));
  r.put('/coupons/:id(\\d+)', wrap((req, res) => { const out = Coupons.save(db, req.user, req.body || {}, Number(req.params.id)); if (out.ok) audit(db, req, 'coupon.update', 'coupon', req.params.id, { code: req.body?.code, active: req.body?.active }); send(res, out); }));
  r.delete('/coupons/:id(\\d+)', wrap((req, res) => { const out = Coupons.remove(db, Number(req.params.id)); if (out.ok) audit(db, req, 'coupon.delete', 'coupon', req.params.id); send(res, out); }));
  r.get('/refunds', (req, res) => res.json({ refunds: Refunds.adminList(db, ['awaiting_details', 'requested', 'approved', 'completed', 'rejected', 'failed'].includes(req.query.stage) ? req.query.stage : null) }));
  r.post('/refunds/:id(\\d+)/paid', requireFreshAuth(db), wrap((req, res) => { const out = Refunds.adminAct(db, req.user, Number(req.params.id), 'paid', req.body || {});
    if (out.ok) audit(db, req, 'refund.paid', 'refund', req.params.id, { utr: req.body?.utr }); send(res, out); }));
  r.post('/refunds/:id(\\d+)/:action(approve|reject|failed)', wrap((req, res) => { const out = Refunds.adminAct(db, req.user, Number(req.params.id), req.params.action, req.body || {});
    if (out.ok) audit(db, req, 'refund.' + req.params.action, 'refund', req.params.id, { note: req.body?.note }); send(res, out); }));
  r.post('/refunds/:id/settle', wrap((req, res) => {          // SANDBOX ONLY stand-in for the PhonePe refund status/webhook
    if (!config.sandboxPayments) return res.status(404).json({ error: 'Not found.' });      // a refund is only ever marked complete by hand in a test environment
    audit(db, req, 'refund.sandbox_settle', 'refund', req.params.id, { ok: !!req.body?.ok }); send(res, settleRefund(db, Number(req.params.id), !!req.body?.ok)); }));
  r.get('/refunds', (req, res) => res.json({ refunds: db.prepare('SELECT f.id,f.status,f.amount_paise,f.reason,o.order_code FROM refunds f JOIN orders o ON o.id=f.order_id ORDER BY f.id DESC LIMIT 50').all() }));


  // operating expenses (feed the net-profit estimate)
  r.get('/expenses', (req, res) => res.json({ expenses: db.prepare('SELECT id,spent_on,category,amount_paise,note,created_at FROM operating_expenses ORDER BY spent_on DESC, id DESC LIMIT 100').all() }));
  r.post('/expenses', wrap((req, res) => { const d = parse(z.object({ spent_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), category: z.string().trim().min(1).max(40), amount_paise: z.number().int().min(100).max(100_000_000), note: z.string().max(200).optional() }), req, res); if (!d) return;
    const id = db.prepare('INSERT INTO operating_expenses (spent_on,category,amount_paise,note,created_by) VALUES (?,?,?,?,?)').run(d.spent_on, d.category, d.amount_paise, d.note ?? null, req.user.id).lastInsertRowid; audit(db, req, 'expense.create', 'expense', id, d); res.status(201).json({ id }); }));
  r.delete('/expenses/:id', (req, res) => { const c = db.prepare('DELETE FROM operating_expenses WHERE id=?').run(req.params.id).changes; if (c) audit(db, req, 'expense.delete', 'expense', req.params.id); c ? res.json({ ok: true }) : res.status(404).json({ error: 'Expense not found.' }); });

  // admin intervention on orders
  r.post('/orders/:id/cancel', fresh, wrap((req, res) => { const out = adminCancel(db, req.user, Number(req.params.id), req.body?.reason); if (!out.error) audit(db, req, 'order.cancel', 'order', req.params.id, { reason: req.body?.reason }); send(res, out); }));
  r.post('/orders/:id/unassign-rider', fresh, wrap((req, res) => { const out = adminUnassign(db, req.user, Number(req.params.id), req.body?.note); if (!out.error) audit(db, req, 'order.unassign_rider', 'order', req.params.id); send(res, out); }));
  r.get('/restaurants/:id/orders', (req, res) => res.json({ orders: db.prepare('SELECT order_code,status,total_paise,items_base_paise,commission_paise,restaurant_payout_paise,created_at FROM orders WHERE restaurant_id=? AND status NOT IN (\'PAYMENT_PENDING\') ORDER BY id DESC LIMIT 100').all(req.params.id) }));
  r.get('/restaurants/:id/users', (req, res) => res.json({ users: db.prepare('SELECT u.id,u.name,u.phone,u.active FROM restaurant_users ru JOIN users u ON u.id=ru.user_id WHERE ru.restaurant_id=?').all(req.params.id) }));
  r.get('/cashouts/:id/records', (req, res) => { const c = db.prepare('SELECT * FROM cashout_requests WHERE id=?').get(req.params.id); if (!c) return res.status(404).json({ error: 'Request not found.' });
    res.json({ records: db.prepare("SELECT t.kind,t.amount_paise,t.created_at,o.order_code FROM platform_transactions t LEFT JOIN orders o ON o.id=t.order_id WHERE t.account_type=? AND t.account_id=? ORDER BY t.id DESC LIMIT 30").all(c.account_type, c.account_id), balance: balances(db, c.account_type, c.account_id) }); });

  // restaurants
  r.get('/restaurants', (req, res) => res.json({ restaurants: db.prepare(`SELECT r.*, COALESCE(s.is_open,0) AS is_open, (SELECT u.phone FROM restaurant_users ru JOIN users u ON u.id=ru.user_id WHERE ru.restaurant_id=r.id LIMIT 1) AS owner_phone FROM restaurants r LEFT JOIN restaurant_operating_status s ON s.restaurant_id=r.id ORDER BY r.id`).all().map((x) => ({ ...x, location_status: x.pickup_lat == null ? 'missing' : x.location_confirmed_at ? 'confirmed' : 'unconfirmed', availability: Hours.availability(db, x.id), hours: Hours.weekOut(Hours.getHours(db, x.id)) }))
    .map(x => ({ ...x, balance: balances(db, 'restaurant', x.id) })) }));
  const rest = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(300).optional(), address: z.string().max(200).optional(), phone: z.string().max(20).optional(), cuisine: z.string().max(60).optional(),
    commission_bps: z.number().int().min(0).max(5000), markup_paise: money.max(100000), packing_buffer_min: z.number().int().min(0).max(60).optional(), min_order_paise: money.optional(), free_delivery_above_paise: money.nullish(), admin_visible: z.boolean().optional(), approved: z.boolean().optional() });
  r.post('/restaurants', wrap((req, res) => { const d = parse(rest, req, res); if (!d) return;
    const id = db.prepare('INSERT INTO restaurants (name,description,address,phone,cuisine,commission_bps,markup_paise,packing_buffer_min,min_order_paise,free_delivery_above_paise,admin_visible,approved) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(d.name, d.description ?? null, d.address ?? null, d.phone ?? null, d.cuisine ?? null, d.commission_bps, d.markup_paise, d.packing_buffer_min ?? 5, d.min_order_paise ?? 0, d.free_delivery_above_paise || null, d.admin_visible ? 1 : 0, d.approved ? 1 : 0).lastInsertRowid;
    audit(db, req, 'restaurant.create', 'restaurant', id); res.status(201).json({ id }); }));
  r.put('/restaurants/:id', wrap((req, res) => { const d = parse(rest.partial().extend({ name: z.string().trim().min(1).max(80) }), req, res); if (!d) return;
    const c = db.prepare('SELECT * FROM restaurants WHERE id=?').get(req.params.id); if (!c) return res.status(404).json({ error: 'Restaurant not found.' });
    const m = { ...c, ...d, free_delivery_above_paise: d.free_delivery_above_paise === undefined ? c.free_delivery_above_paise : (d.free_delivery_above_paise || null), admin_visible: d.admin_visible === undefined ? c.admin_visible : d.admin_visible ? 1 : 0, approved: d.approved === undefined ? c.approved : d.approved ? 1 : 0 };
    db.prepare('UPDATE restaurants SET name=?,description=?,address=?,phone=?,cuisine=?,commission_bps=?,markup_paise=?,packing_buffer_min=?,min_order_paise=?,free_delivery_above_paise=?,admin_visible=?,approved=? WHERE id=?')
      .run(m.name, m.description, m.address, m.phone, m.cuisine, m.commission_bps, m.markup_paise, m.packing_buffer_min, m.min_order_paise ?? 0, m.free_delivery_above_paise, m.admin_visible, m.approved, c.id);
    audit(db, req, 'restaurant.update', 'restaurant', c.id, d); res.json({ ok: true }); }));
  // restaurant pickup point (start of the road-distance calculation). Entered by an admin; audited with old/new values.
  r.put('/restaurants/:id(\\d+)/pickup', wrap((req, res) => { const d = parse(z.object({ lat: z.number().min(-90).max(90).nullable(), lng: z.number().min(-180).max(180).nullable(), address: ADDR.optional() }).strict()
      .refine((x) => (x.lat == null) === (x.lng == null), 'Enter both latitude and longitude, or neither.').refine((x) => !(x.lat === 0 && x.lng === 0), 'That map point is not valid.'), req, res); if (!d) return;
    const c = db.prepare('SELECT id, pickup_lat, pickup_lng FROM restaurants WHERE id=?').get(req.params.id); if (!c) return res.status(404).json({ error: 'Restaurant not found.' });
    if (d.lat != null && (d.lat < 6 || d.lat > 37.5 || d.lng < 68 || d.lng > 97.5)) return res.status(400).json({ error: 'That point is outside India. Check that latitude and longitude are not swapped.', code: 'BAD_LOCATION' });
    const lat = d.lat == null ? null : Math.round(d.lat * 1e6) / 1e6, lng = d.lng == null ? null : Math.round(d.lng * 1e6) / 1e6;
    // an admin entering or correcting the point confirms it; clearing it removes the confirmation (the restaurant stops taking new orders)
    db.prepare('UPDATE restaurants SET pickup_lat=?, pickup_lng=?, pickup_updated_at=?, location_source=?, location_confirmed_at=?, location_confirmed_by=? WHERE id=?')
      .run(lat, lng, iso(), lat == null ? null : 'admin', lat == null ? null : iso(), lat == null ? null : req.user.id, c.id);
    if (d.address) saveAddress(db, c.id, d.address);
    audit(db, req, 'restaurant.pickup_point', 'restaurant', c.id, { changed: { pickup: { from: c.pickup_lat == null ? null : [c.pickup_lat, c.pickup_lng], to: lat == null ? null : [lat, lng] }, address: d.address ?? undefined } });
    res.json({ ok: true }); }));
  // ---------- distance-based delivery pricing ----------
  r.get('/distance-pricing', (req, res) => res.json({ config: Pricing.getConfig(db), provider: Routing.providerName(), osrm_configured: !!config.routing.osrmUrl,
    restaurants: db.prepare('SELECT id, name, pickup_lat, pickup_lng, admin_visible FROM restaurants ORDER BY name').all(),
    recent: db.prepare("SELECT o.order_code, o.created_at, o.delivery_paise, o.delivery_pricing, o.delivery_distance_m, o.delivery_band, o.delivery_route_source, r.name AS restaurant, COALESCE(o.dest_location_name, o.dest_place_name) AS place FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.delivery_pricing LIKE 'distance%' ORDER BY o.id DESC LIMIT 20").all() }));
  r.put('/distance-pricing', wrap((req, res) => { const out = Pricing.saveConfig(db, req.body || {}); if (out.error) return send(res, out);
    if (Object.keys(out.changed).length) audit(db, req, 'distance_pricing.update', 'settings', null, { changed: out.changed }); res.json(out); }));
  // after refreshing the map data (same engine address), clear saved distances so new orders use the new roads
  r.delete('/distance-pricing/cache', wrap((req, res) => { const n = Routing.clearRouteCache(db); audit(db, req, 'distance_pricing.cache_cleared', 'settings', null, { removed: n }); res.json({ ok: true, removed: n }); }));
  // Order radius lookup: for one delivery point, which restaurants can deliver there under the current distance settings?
  // Straight-line distance always; road distance and the charge from the same engine and bands used for real orders.
  r.post('/distance-pricing/radius', wrapA(async (req, res) => { const d = parse(z.object({ location_id: z.number().int().positive().optional(), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() }).strict(), req, res); if (!d) return;
    let point = null, place = null;
    if (d.location_id) { const l = db.prepare('SELECT name, lat, lng FROM delivery_locations WHERE id=?').get(d.location_id); if (!l) return res.status(404).json({ error: 'Place not found.' }); place = l.name; point = l.lat == null ? null : { lat: l.lat, lng: l.lng }; }
    else if (d.lat != null && d.lng != null) point = { lat: d.lat, lng: d.lng };
    if (!point) return res.status(400).json({ error: 'Choose a place with a map point, or enter latitude and longitude.' });
    const cfg = Pricing.getConfig(db), R = 6371, rad = (x) => x * Math.PI / 180;
    const crow = (a) => { const h = Math.sin(rad(a.lat - point.lat) / 2) ** 2 + Math.cos(rad(point.lat)) * Math.cos(rad(a.lat)) * Math.sin(rad(a.lng - point.lng) / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 100) / 100; };
    const out = [];
    for (const x of db.prepare('SELECT id, name, pickup_lat, pickup_lng, admin_visible, approved FROM restaurants WHERE approved=1 ORDER BY name').all()) {
      if (x.pickup_lat == null) { out.push({ id: x.id, name: x.name, visible: !!x.admin_visible, straight_km: null, road_km: null, within: null, note: 'No pickup point set' }); continue; }
      const straight = crow({ lat: x.pickup_lat, lng: x.pickup_lng });
      const route = await Pricing.routeFor(db, x.id, point), price = Pricing.priceFor(cfg, route);
      const road = route?.distance_m == null ? null : Math.round(route.distance_m / 10) / 100, km = road ?? straight;
      out.push({ id: x.id, name: x.name, visible: !!x.admin_visible, straight_km: straight, road_km: road, within: cfg.max_km == null ? true : km <= cfg.max_km,
        fee_paise: price.error ? null : price.fee, band: price.error ? null : price.band, note: price.error || (road == null ? 'Road distance not available; straight-line distance used' : null) });
    }
    out.sort((a, b) => (a.straight_km ?? 1e9) - (b.straight_km ?? 1e9));
    res.json({ point, place, max_km: cfg.max_km, enabled: cfg.enabled, restaurants: out }); }));
  // try a restaurant -> place / point before going live: shows the road distance and the charge the current setup gives
  r.post('/distance-pricing/check', wrapA(async (req, res) => { const d = parse(z.object({ restaurant_id: z.number().int().positive(), location_id: z.number().int().positive().optional(), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() }).strict(), req, res); if (!d) return;
    let point = null; if (d.location_id) { const l = db.prepare('SELECT lat, lng FROM delivery_locations WHERE id=?').get(d.location_id); if (!l) return res.status(404).json({ error: 'Place not found.' }); point = l.lat == null ? null : { lat: l.lat, lng: l.lng }; }
    else if (d.lat != null && d.lng != null) point = { lat: d.lat, lng: d.lng };
    if (!point) return res.status(400).json({ error: 'Choose a place with a map point, or enter latitude and longitude.' });
    const route = await Pricing.routeFor(db, d.restaurant_id, point), cfg = Pricing.getConfig(db), price = Pricing.priceFor(cfg, route);
    res.json({ distance_km: route.distance_m == null ? null : Math.round(route.distance_m / 10) / 100, source: route.source || null, reason: route.reason || null, price: price.error ? null : { fee_paise: price.fee, band: price.band, pricing: price.pricing }, error: price.error || null, enabled: cfg.enabled }); }));

  // ---------- delivery locations (PGs, hostels, colleges...) with their own delivery charges ----------
  // Every change is audited with the exact old and new values. Orders keep the charge they were placed with.
  r.get('/locations', (req, res) => res.json({ locations: Locs.list(db, { q: req.query.q, status: req.query.status }), gps_fee_paise: Number(getSetting(db, 'gps_delivery_fee_paise')), gps_per_km_paise: perKmRate(db), gps_per_km_set: !!Number(getSetting(db, 'gps_per_km_paise')), gps_min_fee_paise: Number(getSetting(db, 'gps_min_fee_paise')) || null, gps_max_km: Number(getSetting(db, 'gps_max_km')) || null, max_fee_paise: Locs.MAX_FEE_PAISE }));
  r.post('/locations', wrap((req, res) => { const out = Locs.create(db, req.body); if (out.error) return send(res, out);
    audit(db, req, 'location.create', 'location', out.id, { after: out.after }); res.status(201).json({ id: out.id }); }));
  r.put('/locations/:id(\\d+)', wrap((req, res) => { const out = Locs.update(db, Number(req.params.id), req.body); if (out.error) return send(res, out);
    if (Object.keys(out.changed).length) audit(db, req, out.changed.delivery_fee_paise ? 'location.fee_change' : 'location.update', 'location', req.params.id, { changed: out.changed });
    res.json({ ok: true, changed: out.changed }); }));
  r.get('/locations/:id(\\d+)/history', (req, res) => res.json({ history: db.prepare("SELECT a.action, a.metadata, a.created_at, u.name AS admin FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.target_type='location' AND a.target_id=? ORDER BY a.id DESC LIMIT 50").all(String(req.params.id)).map((x) => ({ ...x, metadata: x.metadata ? JSON.parse(x.metadata) : null })) }));
  // CSV import of the owner's sheet. dry_run (default) only previews; the admin chooses the charge column.
  r.post('/locations/import', wrap((req, res) => { const d = parse(z.object({ csv: z.string().min(10).max(2_000_000), fee_column: z.string().max(60), update_fees: z.boolean().optional(), activate: z.boolean().optional(), dry_run: z.boolean().optional() }), req, res); if (!d) return;
    const out = Locs.importCsv(db, d.csv, { feeColumn: d.fee_column, updateFees: !!d.update_fees, activate: d.activate !== false, dryRun: d.dry_run !== false }); if (out.error) return send(res, out);
    if (!out.dry_run) { audit(db, req, 'location.import', 'location', null, { fee_column: d.fee_column, created: out.created, updated: out.updated, fee_changes: out.fee_changes, errors: out.errors.length });
      for (const c of out.changes) audit(db, req, c.created ? 'location.create' : c.changed.delivery_fee_paise ? 'location.fee_change' : 'location.update', 'location', c.id, c.created ? { import_ref: c.ref } : { import_ref: c.ref, changed: c.changed }); }
    res.json({ ...out, changes: undefined }); }));

  // ---------- delivery-agent verification queue ----------
  r.get('/riders', (req, res) => {
    const st = typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : null;
    const rows = db.prepare(`SELECT u.id,u.name,u.phone,u.active,u.created_at,r.* FROM riders r JOIN users u ON u.id=r.user_id ${st ? 'WHERE r.verification_status=?' : ''}
      ORDER BY CASE r.verification_status WHEN 'pending' THEN 0 WHEN 'reverification_required' THEN 1 WHEN 'corrections_requested' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END, COALESCE(r.submitted_at, u.created_at) ASC`).all(...(st ? [st] : []));
    res.json({ counts: Object.fromEntries(db.prepare('SELECT verification_status s, COUNT(*) n FROM riders GROUP BY s').all().map((x) => [x.s, x.n])),
      riders: rows.map((x) => ({ id: x.id, name: x.name, legal_name: x.legal_name, phone: x.phone, active: x.active, verification_status: x.verification_status, is_online: x.is_online,
        vehicle_category: x.vehicle_category, vehicle_reg_no: x.vehicle_reg_no, submitted_at: x.submitted_at, decided_at: x.decided_at, missing_count: missing(x).length })) });
  });
  r.get('/riders/:id', (req, res) => { const a = adminView(db, Number(req.params.id)); a ? res.json({ application: a, doc_labels: DOC_LABEL, id_types: ID_TYPES }) : res.status(404).json({ error: 'Delivery agent not found.' }); });
  r.get('/riders/:id/history', (req, res) => res.json({ history: db.prepare('SELECT status,action,note,created_at FROM rider_verification_history WHERE rider_id=? ORDER BY id DESC').all(req.params.id) }));
  // reject / request corrections: reason required. Approve / suspend change who may receive orders: also need fresh authentication.
  const needsFresh = (req, res, next) => (['approve', 'suspend'].includes(req.body?.action) ? fresh(req, res, next) : next());
  r.post('/riders/:id/verify', needsFresh, wrap((req, res) => {
    const out = decide(db, req.user.id, Number(req.params.id), req.body || {});
    if (!out.error) audit(db, req, `rider.${req.body.action}`, 'rider', req.params.id, { note: req.body.note, fields: req.body.fields });
    send(res, out);
  }));
  // full bank account / UPI ID: fresh authentication and an audit entry every time
  r.post('/riders/:id/payout-details', fresh, wrap((req, res) => { const p = revealPayout(db, Number(req.params.id)); if (!p) return res.status(404).json({ error: 'Delivery agent not found.' });
    audit(db, req, 'rider.payout_details_viewed', 'rider', req.params.id); res.json({ payout: p }); }));
  // ---------- full admin control: restaurant hours, open/close, order steps on a restaurant's behalf, user details ----------
  const restOk = (id) => db.prepare('SELECT id FROM restaurants WHERE id=?').get(id);
  r.get('/restaurants/:id(\\d+)/hours', (req, res) => { if (!restOk(req.params.id)) return res.status(404).json({ error: 'Restaurant not found.' });
    const id = Number(req.params.id); res.json({ days: Hours.weekOut(Hours.getHours(db, id)), availability: Hours.availability(db, id), status: db.prepare('SELECT is_open,reopen_mode,reopen_at FROM restaurant_operating_status WHERE restaurant_id=?').get(id) || { is_open: 0 } }); });
  r.put('/restaurants/:id(\\d+)/hours', wrap((req, res) => restOk(req.params.id) ? send(res, putHours(db, req, Number(req.params.id))) : res.status(404).json({ error: 'Restaurant not found.' })));
  r.post('/restaurants/:id(\\d+)/status', wrap((req, res) => restOk(req.params.id) ? send(res, setStatus(db, req, Number(req.params.id))) : res.status(404).json({ error: 'Restaurant not found.' })));
  // accept / start cooking / ready / reject for a restaurant that cannot do it itself; same rules as the restaurant portal, recorded as admin
  r.post('/orders/:id(\\d+)/restaurant/:step(accept|preparing|ready|reject)', wrap((req, res) => {
    const o = db.prepare('SELECT id, restaurant_id, order_code FROM orders WHERE id=?').get(req.params.id); if (!o) return res.status(404).json({ error: 'Order not found.' });
    const out = restaurantStep(db, { id: req.user.id, role: 'admin' }, o.restaurant_id, o.id, req.params.step, req.body || {});
    if (!out.error) audit(db, req, `order.restaurant_${req.params.step}`, 'order', o.id, { order_code: o.order_code, on_behalf_of_restaurant: o.restaurant_id, reason: req.body?.reason });
    send(res, out); }));
  // change a customer's / rider's / restaurant login's name and mobile number (signs them out so the change takes effect)
  r.put('/users/:id(\\d+)', wrap((req, res) => {
    const d = parse(z.object({ name: z.string().trim().min(1).max(80), phone: z.string().trim().regex(/^\+[1-9]\d{9,14}$/, 'Use international format, e.g. +919876543210') }).strict(), req, res); if (!d) return;
    const u = db.prepare('SELECT id, role, name, phone FROM users WHERE id=?').get(req.params.id); if (!u) return res.status(404).json({ error: 'Account not found.' });
    if (u.role === 'admin' && u.id !== req.user.id) return res.status(403).json({ error: 'Other admin accounts can only be changed by that admin.' });
    if (d.phone !== u.phone && db.prepare('SELECT 1 FROM users WHERE phone=? AND role=? AND id<>?').get(d.phone, u.role, u.id)) return res.status(409).json({ error: 'That mobile number is already registered to another account.' });
    db.prepare(`UPDATE users SET name=?, phone=?${d.phone !== u.phone ? ', token_version=token_version+1' : ''} WHERE id=?`).run(d.name, d.phone, u.id);
    audit(db, req, 'user.update', 'user', u.id, { role: u.role, changed: { ...(d.name !== u.name && { name: { from: u.name, to: d.name } }), ...(d.phone !== u.phone && { phone: { from: u.phone, to: d.phone } }) } });
    res.json({ ok: true }); }));
  // ---------- customer support inbox ----------
  r.get('/support', (req, res) => res.json(Support.adminList(db, { status: req.query.status })));
  r.get('/support/:id(\\d+)', (req, res) => send(res, Support.adminGet(db, Number(req.params.id))));
  r.post('/support/:id(\\d+)/reply', wrap((req, res) => { const out = Support.adminReply(db, req.user, Number(req.params.id), req.body?.body, !!req.body?.close);
    if (!out.error) audit(db, req, 'support.reply', 'support_ticket', req.params.id, { closed: !!req.body?.close }); send(res, out); }));
  r.post('/support/:id(\\d+)/status', wrap((req, res) => { const out = Support.adminStatus(db, Number(req.params.id), req.body?.status);
    if (!out.error) audit(db, req, 'support.status', 'support_ticket', req.params.id, { status: req.body?.status }); send(res, out); }));
  r.post('/users/:id/active', wrap((req, res) => { const a = req.body?.active ? 1 : 0; if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    db.prepare('UPDATE users SET active=?, token_version=token_version+1 WHERE id=?').run(a, req.params.id); audit(db, req, 'user.active', 'user', req.params.id, { active: a }); res.json({ ok: true }); }));

  // cashouts
  // cashouts: UPI IDs are shown in full to admins (needed to pay); bank account numbers stay masked
  r.get('/cashouts', (req, res) => res.json({ cashouts: db.prepare(`SELECT c.*, p.txn_reference, p.paid_at,
    CASE c.account_type WHEN 'restaurant' THEN (SELECT name FROM restaurants WHERE id=c.account_id) ELSE (SELECT name FROM users WHERE id=c.account_id) END AS account_name FROM cashout_requests c LEFT JOIN cashout_proofs p ON p.cashout_id=c.id ORDER BY (c.status='PENDING') DESC, c.id DESC LIMIT 100`).all()
    .map(c => ({ ...c, beneficiary: c.payout_method === 'upi' || c.beneficiary.length <= 6 ? c.beneficiary : `${'•'.repeat(c.beneficiary.length - 4)}${c.beneficiary.slice(-4)}`, available_paise: balances(db, c.account_type, c.account_id).available + (['PENDING', 'APPROVED'].includes(c.status) ? c.amount_paise : 0) })) }));
  r.post('/cashouts/:id/:action', wrap((req, res) => { const out = adminCashout(db, req.user, Number(req.params.id), req.params.action, req.body || {});
    if (!out.error) audit(db, req, `cashout.${req.params.action}`, 'cashout', req.params.id, { txn: req.body?.txn_reference }); send(res, out); }));

  // surge
  r.get('/surge', (req, res) => res.json({ rules: db.prepare('SELECT * FROM surge_charge_rules ORDER BY id DESC').all(),
    orders: db.prepare("SELECT order_code,surge_paise,created_at FROM orders WHERE surge_paise>0 AND status NOT IN ('PAYMENT_PENDING','PAYMENT_FAILED','EXPIRED') ORDER BY id DESC LIMIT 50").all(),
    collected_paise: one("SELECT SUM(surge_paise) FROM orders WHERE surge_paise>0 AND status='DELIVERED'") }));
  const rule = z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(['fixed', 'percent']), value: z.number().int().min(0).max(100000), location_id: z.number().int().nullish(), starts_at: z.string().datetime().nullish(), ends_at: z.string().datetime().nullish(), active: z.boolean() });
  r.post('/surge/rules', wrap((req, res) => { const d = parse(rule, req, res); if (!d) return;
    const id = db.prepare('INSERT INTO surge_charge_rules (name,kind,value,location_id,starts_at,ends_at,active,created_by) VALUES (?,?,?,?,?,?,?,?)').run(d.name, d.kind, d.value, d.location_id ?? null, d.starts_at ?? null, d.ends_at ?? null, d.active ? 1 : 0, req.user.id).lastInsertRowid;
    audit(db, req, 'surge.create', 'surge_rule', id, d); res.status(201).json({ id }); }));
  r.put('/surge/rules/:id', wrap((req, res) => { const d = parse(rule, req, res); if (!d) return;
    const c = db.prepare('UPDATE surge_charge_rules SET name=?,kind=?,value=?,location_id=?,starts_at=?,ends_at=?,active=? WHERE id=?').run(d.name, d.kind, d.value, d.location_id ?? null, d.starts_at ?? null, d.ends_at ?? null, d.active ? 1 : 0, req.params.id).changes;
    audit(db, req, 'surge.update', 'surge_rule', req.params.id, d); c ? res.json({ ok: true }) : res.status(404).json({ error: 'Rule not found.' }); }));
  // Restaurant surge *requests* were removed. Past requests stay in the database untouched; surge rules (admin pricing) are unchanged.


  // broadcast campaigns (Web Push only; promotions never go through WhatsApp)
  const aud = z.object({ audience_type: z.enum(['all_customers', 'location', 'ordered_recent', 'inactive', 'riders', 'restaurants', 'user']), audience_param: z.union([z.string().max(40), z.number()]).nullish() });
  r.post('/campaigns/preview', wrap((req, res) => { const d = parse(aud, req, res); if (!d) return; res.json({ audience_size: audienceUsers(db, d.audience_type, d.audience_param).length }); }));
  r.get('/campaigns', (req, res) => res.json({ campaigns: db.prepare('SELECT * FROM campaigns ORDER BY id DESC LIMIT 50').all().map((c) => ({ ...c, stats: campaignStats(db, c.id) })) }));
  r.post('/campaigns', wrap((req, res) => {
    const d = parse(aud.extend({ title: z.string().trim().min(1).max(60), body: z.string().trim().min(1).max(200), deep_link: z.string().max(200).regex(/^\/[\w\-/#?=&.]*$/).nullish(), image: z.string().max(5_000_000).optional(), scheduled_at: z.string().datetime().nullish(), draft: z.boolean().optional() }), req, res); if (!d) return;
    const when = d.scheduled_at || new Date().toISOString(), size = audienceUsers(db, d.audience_type, d.audience_param).length;
    if (!size && !d.draft) return res.status(400).json({ error: 'No one matches that audience.' });
    const img = d.image ? saveUpload(d.image, { scope: 'public' }) : null;
    const id = db.prepare("INSERT INTO campaigns (title,body,deep_link,image_path,audience_type,audience_param,status,scheduled_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)").run(d.title, d.body, d.deep_link ?? null, img, d.audience_type, d.audience_param == null ? null : String(d.audience_param), d.draft ? 'draft' : 'scheduled', d.draft ? null : when, req.user.id).lastInsertRowid;
    audit(db, req, 'campaign.create', 'campaign', id, { audience: d.audience_type, size, scheduled_at: when });
    if (!d.scheduled_at && !d.draft) processCampaigns(db);          // "send now" is picked up immediately
    res.status(201).json({ id, audience_size: size });
  }));
  r.post('/campaigns/:id/send', wrap((req, res) => {          // send (or schedule) a saved draft
    const d = parse(z.object({ scheduled_at: z.string().datetime().nullish() }), req, res); if (!d) return;
    const c = db.prepare("SELECT * FROM campaigns WHERE id=? AND status='draft'").get(req.params.id); if (!c) return res.status(404).json({ error: 'Draft not found.' });
    const size = audienceUsers(db, c.audience_type, c.audience_param).length; if (!size) return res.status(400).json({ error: 'No one matches that audience.' });
    db.prepare("UPDATE campaigns SET status='scheduled', scheduled_at=? WHERE id=? AND status='draft'").run(d.scheduled_at || new Date().toISOString(), c.id);
    audit(db, req, 'campaign.send_draft', 'campaign', c.id, { size }); if (!d.scheduled_at) processCampaigns(db); res.json({ ok: true, audience_size: size }); }));
  r.delete('/campaigns/:id', (req, res) => { const c = db.prepare("DELETE FROM campaigns WHERE id=? AND status='draft'").run(req.params.id).changes; if (c) audit(db, req, 'campaign.delete_draft', 'campaign', req.params.id); c ? res.json({ ok: true }) : res.status(409).json({ error: 'Only drafts can be deleted.' }); });
  r.post('/campaigns/:id/cancel', wrap((req, res) => {
    const c = db.prepare("UPDATE campaigns SET status='cancelled' WHERE id=? AND status IN ('scheduled','draft')").run(req.params.id).changes;
    if (!c) return res.status(409).json({ error: 'Only scheduled campaigns can be cancelled.' });
    audit(db, req, 'campaign.cancel', 'campaign', req.params.id); res.json({ ok: true }); }));


  // optional two-factor (authenticator app) for the admin account
  // Sign-in username (optional; mobile number keeps working). Changing it needs the current password.
  r.get('/username', (req, res) => res.json({ username: db.prepare('SELECT username FROM users WHERE id=?').pluck().get(req.user.id) || null }));
  r.post('/username', fresh, wrap((req, res) => {
    const u = String(req.body?.username || '').trim().toLowerCase();
    if (u && !USERNAME_RE.test(u)) return res.status(400).json({ error: 'Username: 4–32 characters, start with a letter; letters, numbers, dot or underscore.' });
    if (u && db.prepare('SELECT 1 FROM users WHERE username=? AND id<>?').get(u, req.user.id)) return res.status(409).json({ error: 'That username is taken.' });
    db.prepare('UPDATE users SET username=? WHERE id=?').run(u || null, req.user.id); audit(db, req, 'admin.username', 'user', req.user.id, { username: u || null }); res.json({ ok: true, username: u || null }); }));
  r.get('/mfa', (req, res) => res.json({ enabled: !!db.prepare('SELECT mfa_enabled FROM users WHERE id=?').pluck().get(req.user.id) }));
  r.post('/mfa/setup', wrap((req, res) => {
    if (db.prepare('SELECT mfa_enabled FROM users WHERE id=?').pluck().get(req.user.id)) return res.status(409).json({ error: 'Two-factor is already on. Turn it off first to re-enrol.' });
    const secret = newSecret(); db.prepare('UPDATE users SET mfa_secret=? WHERE id=?').run(encrypt(secret), req.user.id);
    res.json({ secret, uri: otpauthUri(secret, req.user.phone) }); }));
  r.post('/mfa/enable', wrap((req, res) => {
    const u = db.prepare('SELECT mfa_secret, mfa_enabled FROM users WHERE id=?').get(req.user.id);
    if (!u.mfa_secret || u.mfa_enabled) return res.status(409).json({ error: 'Start set-up first.' });
    const step = verifyTotp(decrypt(u.mfa_secret), req.body?.code); if (step === null) return res.status(400).json({ error: 'That code is incorrect. Check the time on your phone and try again.' });
    db.prepare('UPDATE users SET mfa_enabled=1, mfa_last_step=? WHERE id=?').run(step, req.user.id); audit(db, req, 'mfa.enable', 'user', req.user.id); res.json({ ok: true }); }));
  r.post('/mfa/disable', wrap((req, res) => {
    const u = db.prepare('SELECT mfa_secret, mfa_enabled, mfa_last_step FROM users WHERE id=?').get(req.user.id); if (!u.mfa_enabled) return res.json({ ok: true });
    const step = verifyTotp(decrypt(u.mfa_secret), req.body?.code); if (step === null || step <= u.mfa_last_step) return res.status(400).json({ error: 'That code is incorrect or already used. Wait for the next code.' });
    db.prepare('UPDATE users SET mfa_enabled=0, mfa_secret=NULL, mfa_last_step=0 WHERE id=?').run(req.user.id); audit(db, req, 'mfa.disable', 'user', req.user.id); res.json({ ok: true }); }));

  // settings & audit
  r.get('/settings', (req, res) => res.json({ settings: allSettings(db) }));
  r.put('/settings', wrap((req, res) => { const s = req.body?.settings || {};
    for (const [k, v] of Object.entries(s)) { if (!SETTING_KEYS.includes(k)) return res.status(400).json({ error: `Unknown setting ${k}.` });
      if (k === 'delivery_otp_mode' && !['fixed', 'per_order'].includes(v)) return res.status(400).json({ error: 'Invalid OTP mode.' });
      if (k === 'fixed_delivery_otp' && v && !/^\d{4}$/.test(v)) return res.status(400).json({ error: 'Fixed delivery code must be 4 digits.' });
      if (k === 'payout_methods' && !/^[a-z]{2,12}(,[a-z]{2,12}){0,5}$/.test(String(v))) return res.status(400).json({ error: 'Payout methods: lowercase names separated by commas, e.g. upi,bank.' });
      if (k === 'restaurant_accept_timeout_min' && v !== '' && !(/^\d{1,3}$/.test(String(v)) && +v >= 1 && +v <= 120)) return res.status(400).json({ error: 'Restaurant response time must be 1 to 120 minutes, or empty for no timer.' });
      if (k === 'gps_accuracy_warn_m' && v !== '' && !(/^\d{1,4}$/.test(String(v)) && +v >= 5 && +v <= 5000)) return res.status(400).json({ error: 'GPS accuracy limit must be 5 to 5000 metres, or empty for no limit.' });
      if (k === 'gps_capture_timeout_sec' && !(/^\d{1,3}$/.test(String(v)) && +v >= 5 && +v <= 120)) return res.status(400).json({ error: 'GPS timeout must be 5 to 120 seconds.' });
      if (['rider_per_km_paise', 'rider_min_payout_paise'].includes(k) && v !== '' && !(/^\d{1,6}$/.test(String(v)) && +v <= 100000)) return res.status(400).json({ error: 'Rider pay must be ₹0 to ₹1,000, or empty.' });
      if (k === 'daily_notify_enabled' && !['0', '1'].includes(String(v))) return res.status(400).json({ error: 'daily_notify_enabled must be 0 or 1.' });
      if (k === 'fixed_place_fees' && !['0', '1'].includes(String(v))) return res.status(400).json({ error: 'fixed_place_fees must be 0 or 1.' });
      if (k === 'batch_radius_km' && !(/^\d{1,2}(\.\d{1,2})?$/.test(String(v)) && +v > 0 && +v <= 20)) return res.status(400).json({ error: 'Nearby distance must be more than 0 and at most 20 km.' });
      if (['gps_per_km_paise', 'gps_min_fee_paise'].includes(k) && v !== '' && !(/^\d{1,6}$/.test(String(v)) && +v >= 0 && +v <= 100000)) return res.status(400).json({ error: 'Charges must be ₹0 to ₹1,000, or empty.' });
      if (k === 'gps_max_km' && v !== '' && !(/^\d{1,3}(\.\d{1,2})?$/.test(String(v)) && +v > 0 && +v <= 100)) return res.status(400).json({ error: 'Maximum distance must be more than 0 and at most 100 km, or empty.' });
      if (k === 'gps_fix_max_age_min' && !(/^\d{1,3}$/.test(String(v)) && +v >= 1 && +v <= 120)) return res.status(400).json({ error: 'GPS reading age must be 1 to 120 minutes.' });
      if (!['delivery_otp_mode', 'fixed_delivery_otp', 'payout_methods', 'restaurant_accept_timeout_min', 'gps_accuracy_warn_m', 'gps_per_km_paise', 'gps_min_fee_paise', 'gps_max_km', 'rider_per_km_paise', 'rider_min_payout_paise', 'batch_radius_km'].includes(k) && !/^\d{1,9}$/.test(String(v))) return res.status(400).json({ error: `${k} must be a whole number.` }); }
    const changed = Object.fromEntries(Object.entries(s).filter(([k, v]) => String(getSetting(db, k)) !== String(v)).map(([k, v]) => [k, { from: getSetting(db, k), to: String(v) }]));
    for (const [k, v] of Object.entries(s)) setSetting(db, k, v);
    if (Object.keys(changed).length) audit(db, req, changed.gps_delivery_fee_paise || changed.gps_per_km_paise || changed.gps_min_fee_paise || changed.gps_max_km ? 'settings.gps_fee_change' : 'settings.update', 'settings', null, { changed });      // exact old -> new values
    res.json({ ok: true, changed }); }));
  r.get('/audit', (req, res) => res.json({ logs: db.prepare('SELECT a.action,a.target_type,a.target_id,a.actor_role,a.created_at,u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.id DESC LIMIT 100').all() }));
  return r;
}
