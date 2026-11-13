import { Router } from 'express';
import { config } from '../config.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authenticate, requireRole, audit, requireFreshAuth } from '../auth.js';
import { adminView, decide, revealPayout, missing, DOC_LABEL, ID_TYPES } from '../services/riderApplication.js';
import { allSettings, setSetting, SETTING_KEYS, adminCashout, balances, settleRefund, eligibleRiderCount, getSetting, iso, adminCancel, adminUnassign } from '../services/core.js';
import { send, parse, wrap, money } from './util.js';
import { newSecret, encrypt, decrypt, verifyTotp, otpauthUri } from '../totp.js';
import { audienceUsers, campaignStats, processCampaigns } from '../services/push.js';
import { saveUpload } from '../services/core.js';

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
    if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(d.phone)) return res.status(409).json({ error: 'That mobile number is already registered.' });
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
    const revenue = plat(['markup', 'commission', 'delivery_margin', 'surge']);
    const gateway = Math.round(collected * Number(getSetting(db, 'gateway_fee_bps')) / 10000);
    const refunds = one("SELECT SUM(amount_paise) FROM refunds WHERE created_at>=? AND created_at<?", from, to);
    const liab = (t) => one("SELECT SUM(amount_paise) FROM platform_transactions WHERE account_type=?", t);
    const dayRev = (a, b) => one("SELECT SUM(amount_paise) FROM platform_transactions WHERE account_type='platform' AND kind IN ('markup','commission','delivery_margin','surge') AND created_at>=? AND created_at<?", a, b);
    const expenses = one('SELECT SUM(amount_paise) FROM operating_expenses WHERE spent_on>=? AND spent_on<=?', new Date(Date.parse(from) + IST).toISOString().slice(0, 10), new Date(Date.parse(to) + IST - 1).toISOString().slice(0, 10));
    const day = (col) => `substr(datetime(${col}, '+330 minutes'), 1, 10)`;
    const rev = Object.fromEntries(db.prepare(`SELECT ${day('created_at')} AS d, SUM(amount_paise) AS v FROM platform_transactions WHERE account_type='platform' AND kind IN ('markup','commission','delivery_margin','surge') AND created_at>=? AND created_at<? GROUP BY d`).all(from, to).map((x) => [x.d, x.v]));
    const col = Object.fromEntries(db.prepare(`SELECT ${day('updated_at')} AS d, SUM(total_paise) AS v, COUNT(*) AS n FROM orders WHERE status='DELIVERED' AND updated_at>=? AND updated_at<? GROUP BY d`).all(from, to).map((x) => [x.d, x]));
    const daily = []; for (let t = Date.parse(from), i = 0; t < Date.parse(to) && i < 62; t += 864e5, i++) { const d = new Date(t + IST).toISOString().slice(0, 10); daily.push({ date: d, revenue_paise: rev[d] || 0, collected_paise: col[d]?.v || 0, orders: col[d]?.n || 0 }); }
    res.json({ daily, range: { from, to }, current: { pending_acceptance: live('PLACED'), preparing: live('ACCEPTED') + live('PREPARING'), ready: live('READY'), active_deliveries: live('PICKED_UP'), delivered: one("SELECT COUNT(*) FROM orders WHERE status='DELIVERED' AND updated_at>=? AND updated_at<?", from, to), rejected: one("SELECT COUNT(*) FROM orders WHERE status='REJECTED' AND updated_at>=? AND updated_at<?", from, to) },
      money: { collected_paise: collected, platform_revenue_paise: revenue, markup_paise: plat(['markup']), commission_paise: plat(['commission']), delivery_margin_paise: plat(['delivery_margin']), surge_paise: plat(['surge']), tax_liability_paise: plat(['tax_liability']),
        gateway_fee_estimate_paise: gateway, expenses_paise: expenses, refunds_paise: refunds, estimated_net_profit_paise: revenue - gateway - expenses,
        restaurant_payable_paise: liab('restaurant') - one("SELECT SUM(amount_paise) FROM cashout_requests WHERE account_type='restaurant' AND status IN ('PENDING','APPROVED')") * 0,
        rider_payable_paise: liab('rider'), today_revenue_paise: dayRev(dayStart(), dayStart(1)), yesterday_revenue_paise: dayRev(dayStart(-1), dayStart()), all_time_revenue_paise: dayRev('0', '9'),
        delivery_collected_paise: one("SELECT SUM(delivery_paise) FROM orders WHERE status='DELIVERED' AND updated_at>=? AND updated_at<?", from, to) },
      riders_available: eligibleRiderCount(db), pending_cashouts: one("SELECT COUNT(*) FROM cashout_requests WHERE status='PENDING'"), pending_riders: one("SELECT COUNT(*) FROM riders WHERE verification_status='pending'"),
      pending_refunds: one("SELECT COUNT(*) FROM refunds WHERE status='REFUND_INITIATED'") });
  });
  r.get('/notifications', (req, res) => { const n = db.prepare('SELECT id,title,body,created_at,read_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30').all(req.user.id); res.json({ notifications: n }); });

  // orders
  r.get('/orders', (req, res) => res.json({ orders: db.prepare(`SELECT o.order_code,o.status,o.total_paise,o.created_at,r.name AS restaurant,o.customer_name FROM orders o JOIN restaurants r ON r.id=o.restaurant_id
    ${req.query.status ? 'WHERE o.status=?' : 'WHERE o.status NOT IN (\'PAYMENT_PENDING\')'} ORDER BY o.id DESC LIMIT 100`).all(...(req.query.status ? [String(req.query.status)] : [])) }));
  r.get('/orders/search/:code', (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE order_code=?').get(String(req.params.code).trim().toUpperCase());
    if (!o) return res.status(404).json({ error: 'No order found with that ID.' });
    res.json({ order: o, restaurant: db.prepare('SELECT id,name,address,phone FROM restaurants WHERE id=?').get(o.restaurant_id),
      rider: o.rider_id ? db.prepare('SELECT u.name,u.phone,r.vehicle_reg_no FROM users u JOIN riders r ON r.user_id=u.id WHERE u.id=?').get(o.rider_id) : null,
      items: db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id), payment: db.prepare('SELECT provider,merchant_order_id,provider_txn_id,status,amount_paise FROM payments WHERE order_id=?').get(o.id),
      refund: db.prepare('SELECT id,status,amount_paise,reason FROM refunds WHERE order_id=?').get(o.id) || null,
      events: db.prepare('SELECT e.event_type,e.actor_role,e.actor_user_id,e.metadata,e.created_at,u.name AS actor_name FROM order_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE order_id=? ORDER BY e.id').all(o.id),
      platform_revenue_paise: o.markup_paise + o.commission_paise + (o.delivery_paise - o.rider_payout_paise) + o.surge_paise });
  });
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
  r.get('/restaurants', (req, res) => res.json({ restaurants: db.prepare(`SELECT r.*, COALESCE(s.is_open,0) AS is_open, (SELECT u.phone FROM restaurant_users ru JOIN users u ON u.id=ru.user_id WHERE ru.restaurant_id=r.id LIMIT 1) AS owner_phone FROM restaurants r LEFT JOIN restaurant_operating_status s ON s.restaurant_id=r.id ORDER BY r.id`).all()
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
  r.get('/restaurants/:id/menu', (req, res) => res.json({ items: db.prepare('SELECT id,name,base_price_paise,prep_time_min,available FROM food_items WHERE restaurant_id=? AND deleted=0').all(req.params.id) }));

  // delivery locations
  const loc = z.object({ name: z.string().trim().min(1).max(80), kind: z.string().max(30).optional(), address: z.string().trim().min(3).max(200), area: z.string().max(60).optional(), contact: z.string().max(40).optional(),
    delivery_fee_paise: money.max(100000), distance_km: z.number().min(0).max(50).nullish(), maps_link: z.string().url().max(300).optional().or(z.literal('')), lat: z.number().nullish(), lng: z.number().nullish(), active: z.boolean().optional() });
  r.get('/locations', (req, res) => res.json({ locations: db.prepare('SELECT * FROM delivery_locations ORDER BY name').all() }));
  r.post('/locations', wrap((req, res) => { const d = parse(loc, req, res); if (!d) return;
    const id = db.prepare('INSERT INTO delivery_locations (name,kind,address,area,contact,delivery_fee_paise,distance_km,maps_link,lat,lng,active) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(d.name, d.kind ?? null, d.address, d.area ?? null, d.contact ?? null, d.delivery_fee_paise, d.distance_km ?? null, d.maps_link || null, d.lat ?? null, d.lng ?? null, d.active === false ? 0 : 1).lastInsertRowid;
    audit(db, req, 'location.create', 'location', id); res.status(201).json({ id }); }));
  r.put('/locations/:id', wrap((req, res) => { const d = parse(loc, req, res); if (!d) return;
    const c = db.prepare('UPDATE delivery_locations SET name=?,kind=?,address=?,area=?,contact=?,delivery_fee_paise=?,distance_km=?,maps_link=?,lat=?,lng=?,active=? WHERE id=?').run(d.name, d.kind ?? null, d.address, d.area ?? null, d.contact ?? null, d.delivery_fee_paise, d.distance_km ?? null, d.maps_link || null, d.lat ?? null, d.lng ?? null, d.active === false ? 0 : 1, req.params.id).changes;
    c ? res.json({ ok: true }) : res.status(404).json({ error: 'Location not found.' }); }));

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
  r.post('/users/:id/active', wrap((req, res) => { const a = req.body?.active ? 1 : 0; if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    db.prepare('UPDATE users SET active=?, token_version=token_version+1 WHERE id=?').run(a, req.params.id); audit(db, req, 'user.active', 'user', req.params.id, { active: a }); res.json({ ok: true }); }));

  // cashouts
  r.get('/cashouts', (req, res) => res.json({ cashouts: db.prepare(`SELECT c.*, p.txn_reference, p.paid_at,
    CASE c.account_type WHEN 'restaurant' THEN (SELECT name FROM restaurants WHERE id=c.account_id) ELSE (SELECT name FROM users WHERE id=c.account_id) END AS account_name FROM cashout_requests c LEFT JOIN cashout_proofs p ON p.cashout_id=c.id ORDER BY (c.status='PENDING') DESC, c.id DESC LIMIT 100`).all()
    .map(c => ({ ...c, beneficiary: c.beneficiary.length > 6 ? `${'•'.repeat(c.beneficiary.length - 4)}${c.beneficiary.slice(-4)}` : c.beneficiary, available_paise: balances(db, c.account_type, c.account_id).available + (['PENDING', 'APPROVED'].includes(c.status) ? c.amount_paise : 0) })) }));
  r.post('/cashouts/:id/:action', wrap((req, res) => { const out = adminCashout(db, req.user, Number(req.params.id), req.params.action, req.body || {});
    if (!out.error) audit(db, req, `cashout.${req.params.action}`, 'cashout', req.params.id, { txn: req.body?.txn_reference }); send(res, out); }));

  // surge
  r.get('/surge', (req, res) => res.json({ rules: db.prepare('SELECT * FROM surge_charge_rules ORDER BY id DESC').all(), requests: db.prepare('SELECT q.*, r.name AS restaurant FROM surge_charge_requests q JOIN restaurants r ON r.id=q.restaurant_id ORDER BY (q.status=\'PENDING\') DESC, q.id DESC LIMIT 50').all(),
    orders: db.prepare("SELECT order_code,surge_paise,created_at FROM orders WHERE surge_paise>0 AND status NOT IN ('PAYMENT_PENDING','PAYMENT_FAILED','EXPIRED') ORDER BY id DESC LIMIT 50").all(),
    collected_paise: one("SELECT SUM(surge_paise) FROM orders WHERE surge_paise>0 AND status='DELIVERED'") }));
  const rule = z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(['fixed', 'percent']), value: z.number().int().min(0).max(100000), location_id: z.number().int().nullish(), starts_at: z.string().datetime().nullish(), ends_at: z.string().datetime().nullish(), active: z.boolean() });
  r.post('/surge/rules', wrap((req, res) => { const d = parse(rule, req, res); if (!d) return;
    const id = db.prepare('INSERT INTO surge_charge_rules (name,kind,value,location_id,starts_at,ends_at,active,created_by) VALUES (?,?,?,?,?,?,?,?)').run(d.name, d.kind, d.value, d.location_id ?? null, d.starts_at ?? null, d.ends_at ?? null, d.active ? 1 : 0, req.user.id).lastInsertRowid;
    audit(db, req, 'surge.create', 'surge_rule', id, d); res.status(201).json({ id }); }));
  r.put('/surge/rules/:id', wrap((req, res) => { const d = parse(rule, req, res); if (!d) return;
    const c = db.prepare('UPDATE surge_charge_rules SET name=?,kind=?,value=?,location_id=?,starts_at=?,ends_at=?,active=? WHERE id=?').run(d.name, d.kind, d.value, d.location_id ?? null, d.starts_at ?? null, d.ends_at ?? null, d.active ? 1 : 0, req.params.id).changes;
    audit(db, req, 'surge.update', 'surge_rule', req.params.id, d); c ? res.json({ ok: true }) : res.status(404).json({ error: 'Rule not found.' }); }));
  r.post('/surge/requests/:id/decide', wrap((req, res) => { const d = parse(z.object({ approve: z.boolean(), note: z.string().max(200).optional() }), req, res); if (!d) return;
    const c = db.prepare("UPDATE surge_charge_requests SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=? AND status='PENDING'").run(d.approve ? 'APPROVED' : 'REJECTED', req.user.id, iso(), d.note ?? null, req.params.id).changes;
    audit(db, req, d.approve ? 'surge.request.approve' : 'surge.request.reject', 'surge_request', req.params.id);
    c ? res.json({ ok: true, note: d.approve ? 'Approved. Create or activate a surge rule to apply it.' : undefined }) : res.status(409).json({ error: 'Request already decided.' }); }));


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
      if (!['delivery_otp_mode', 'fixed_delivery_otp', 'payout_methods'].includes(k) && !/^\d{1,9}$/.test(String(v))) return res.status(400).json({ error: `${k} must be a whole number.` }); }
    for (const [k, v] of Object.entries(s)) setSetting(db, k, v); audit(db, req, 'settings.update', 'settings', null, { keys: Object.keys(s) }); res.json({ ok: true }); }));
  r.get('/audit', (req, res) => res.json({ logs: db.prepare('SELECT a.action,a.target_type,a.target_id,a.actor_role,a.created_at,u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.id DESC LIMIT 100').all() }));
  return r;
}
