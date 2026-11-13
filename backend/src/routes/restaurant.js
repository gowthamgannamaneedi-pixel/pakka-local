import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, audit } from '../auth.js';
import { restaurantStep, balances, requestCashout, derivedOtp, saveUpload, iso, getSetting } from '../services/core.js';
import { send, parse, wrap, money, img } from './util.js';

// Suggested categories a restaurant can add with one tap; restaurants can still create their own.
export const CATEGORY_PRESETS = ['Starters', 'Soups', 'Main Course', 'Biryani', 'Rice', 'Breads', 'Curries', 'South Indian', 'Chinese', 'Tandoor', 'Snacks', 'Rolls & Wraps', 'Burgers & Sandwiches', 'Pizza', 'Combos', 'Thalis', 'Desserts', 'Beverages'];
export function restaurantRoutes(db) {
  const r = Router();
  r.use(authenticate(db), requireRole('restaurant'), (req, res, next) => {
    const row = db.prepare('SELECT restaurant_id FROM restaurant_users WHERE user_id=?').get(req.user.id);
    if (!row) return res.status(403).json({ error: 'No restaurant is linked to this account.' });
    req.restaurantId = row.restaurant_id; next();
  });
  const actor = (req) => ({ id: req.user.id, role: 'restaurant' });
  const statusRow = (rid) => db.prepare('SELECT is_open,reopen_mode,reopen_at FROM restaurant_operating_status WHERE restaurant_id=?').get(rid) || { is_open: 0, reopen_mode: 'manual', reopen_at: null };

  r.get('/me', (req, res) => res.json({ restaurant: db.prepare('SELECT id,name,description,address,phone,cuisine,operating_info,logo_path,image_path,admin_visible,approved,packing_buffer_min FROM restaurants WHERE id=?').get(req.restaurantId), status: statusRow(req.restaurantId) }));
  r.put('/me', wrap((req, res) => {
    const d = parse(z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(300).optional(), address: z.string().max(200).optional(), phone: z.string().max(20).optional(),
      cuisine: z.string().max(60).optional(), operating_info: z.string().max(200).optional(), logo: img, image: img }), req, res); if (!d) return;
    const logo = d.logo ? saveUpload(d.logo, { scope: 'public' }) : null, image = d.image ? saveUpload(d.image, { scope: 'public' }) : null;
    db.prepare('UPDATE restaurants SET name=?,description=?,address=?,phone=?,cuisine=?,operating_info=?,logo_path=COALESCE(?,logo_path),image_path=COALESCE(?,image_path) WHERE id=?')
      .run(d.name, d.description ?? null, d.address ?? null, d.phone ?? null, d.cuisine ?? null, d.operating_info ?? null, logo, image, req.restaurantId);
    res.json({ ok: true });
  }));
  r.post('/status', wrap((req, res) => {
    const d = parse(z.object({ open: z.boolean(), mode: z.enum(['auto', 'manual']).optional(), days: z.number().int().min(0).max(30).optional(), hours: z.number().int().min(0).max(23).optional(), minutes: z.number().int().min(0).max(59).optional() }), req, res); if (!d) return;
    let open = d.open ? 1 : 0, mode = null, at = null;
    if (!d.open) {
      mode = d.mode || 'manual';
      if (mode === 'auto') { const mins = (d.days || 0) * 1440 + (d.hours || 0) * 60 + (d.minutes || 0); if (mins < 1) return res.status(400).json({ error: 'Choose how long to stay closed.' }); at = new Date(Date.now() + mins * 60_000).toISOString(); }
    }
    db.prepare(`INSERT INTO restaurant_operating_status (restaurant_id,is_open,reopen_mode,reopen_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(restaurant_id) DO UPDATE SET is_open=excluded.is_open,reopen_mode=excluded.reopen_mode,reopen_at=excluded.reopen_at,updated_at=excluded.updated_at`).run(req.restaurantId, open, mode, at, iso());
    audit(db, req, open ? 'restaurant.open' : 'restaurant.close', 'restaurant', req.restaurantId, { mode, at });
    res.json({ status: statusRow(req.restaurantId) });
  }));

  // menu: an item is shown to customers only with a photo (new items and any edit/publish from now on)
  const NEED_PHOTO = 'Add a photo of this dish before showing it to customers. You can save it as sold out until you have one.';
  r.get('/category-presets', (req, res) => res.json({ presets: CATEGORY_PRESETS }));
  const itemSchema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(300).optional(), base_price_paise: money, prep_time_min: z.number().int().min(1).max(180), available: z.boolean().optional(), category_id: z.number().int().positive().nullish(), image: img });
  r.get('/menu', (req, res) => res.json({ items: db.prepare('SELECT id,name,description,image_path,base_price_paise,prep_time_min,available,category_id FROM food_items WHERE restaurant_id=? AND deleted=0 ORDER BY name').all(req.restaurantId), categories: db.prepare('SELECT id,name,sort_order FROM food_categories WHERE restaurant_id=? ORDER BY sort_order,name').all(req.restaurantId) }));
  const ownCat = (req, cid) => cid == null || !!db.prepare('SELECT 1 FROM food_categories WHERE id=? AND restaurant_id=?').get(cid, req.restaurantId);
  r.post('/menu', wrap((req, res) => { const d = parse(itemSchema, req, res); if (!d) return; if (!ownCat(req, d.category_id)) return res.status(400).json({ error: 'Unknown category.' });
    if (d.available !== false && !d.image) return res.status(400).json({ error: NEED_PHOTO, code: 'PHOTO_REQUIRED' }); const im = d.image ? saveUpload(d.image, { scope: 'public' }) : null;
    const id = db.prepare('INSERT INTO food_items (restaurant_id,category_id,name,description,image_path,base_price_paise,prep_time_min,available) VALUES (?,?,?,?,?,?,?,?)').run(req.restaurantId, d.category_id ?? null, d.name, d.description ?? null, im, d.base_price_paise, d.prep_time_min, d.available === false ? 0 : 1).lastInsertRowid;
    res.status(201).json({ id }); }));
  r.put('/menu/:id', wrap((req, res) => { const d = parse(itemSchema.partial().extend({ name: z.string().trim().min(1).max(80) }), req, res); if (!d) return;
    const cur = db.prepare('SELECT * FROM food_items WHERE id=? AND restaurant_id=? AND deleted=0').get(req.params.id, req.restaurantId);
    if (!cur) return res.status(404).json({ error: 'Item not found.' });
    const willShow = d.available === undefined ? !!cur.available : !!d.available;
    // publishing (sold out -> available) needs a photo; items published before this rule keep working and are flagged in the menu screen
    if (willShow && !cur.available && !d.image && !cur.image_path) return res.status(400).json({ error: NEED_PHOTO, code: 'PHOTO_REQUIRED' });
    const im = d.image ? saveUpload(d.image, { scope: 'public' }) : cur.image_path;
    if (d.category_id !== undefined && !ownCat(req, d.category_id)) return res.status(400).json({ error: 'Unknown category.' });
    db.prepare('UPDATE food_items SET name=?,description=?,image_path=?,base_price_paise=?,prep_time_min=?,available=?,category_id=? WHERE id=?').run(d.name, d.description ?? cur.description, im, d.base_price_paise ?? cur.base_price_paise, d.prep_time_min ?? cur.prep_time_min, d.available === undefined ? cur.available : d.available ? 1 : 0, d.category_id === undefined ? cur.category_id : d.category_id, cur.id);
    res.json({ ok: true }); }));
  r.delete('/menu/:id', (req, res) => { const c = db.prepare('UPDATE food_items SET deleted=1 WHERE id=? AND restaurant_id=?').run(req.params.id, req.restaurantId).changes; c ? res.json({ ok: true }) : res.status(404).json({ error: 'Item not found.' }); });


  // menu categories
  r.post('/categories', wrap((req, res) => { const d = parse(z.object({ name: z.string().trim().min(1).max(40), sort_order: z.number().int().min(0).max(999).optional() }), req, res); if (!d) return;
    res.status(201).json({ id: db.prepare('INSERT INTO food_categories (restaurant_id,name,sort_order) VALUES (?,?,?)').run(req.restaurantId, d.name, d.sort_order ?? 0).lastInsertRowid }); }));
  r.put('/categories/:id', wrap((req, res) => { const d = parse(z.object({ name: z.string().trim().min(1).max(40), sort_order: z.number().int().min(0).max(999).optional() }), req, res); if (!d) return;
    const c = db.prepare('UPDATE food_categories SET name=?, sort_order=COALESCE(?,sort_order) WHERE id=? AND restaurant_id=?').run(d.name, d.sort_order ?? null, req.params.id, req.restaurantId).changes; c ? res.json({ ok: true }) : res.status(404).json({ error: 'Category not found.' }); }));
  r.delete('/categories/:id', (req, res) => { db.prepare('UPDATE food_items SET category_id=NULL WHERE category_id=? AND restaurant_id=?').run(req.params.id, req.restaurantId);
    const c = db.prepare('DELETE FROM food_categories WHERE id=? AND restaurant_id=?').run(req.params.id, req.restaurantId).changes; c ? res.json({ ok: true }) : res.status(404).json({ error: 'Category not found.' }); });

  // orders
  const placedAt = (o) => db.prepare("SELECT created_at FROM order_events WHERE order_id=? AND event_type='PAYMENT_SUCCESS' ORDER BY id LIMIT 1").pluck().get(o.id) || o.created_at;
  const serialize = (o) => ({ id: o.id, order_code: o.order_code, status: o.status, created_at: o.created_at, placed_at: o.status === 'PLACED' ? placedAt(o) : undefined, total_items_paise: o.items_base_paise, commission_paise: o.commission_paise, payout_paise: o.restaurant_payout_paise,
    rejection_reason: o.rejection_reason, eta_at: o.eta_at, instructions: null,
    items: db.prepare('SELECT name,qty,base_price_paise,prep_time_min FROM order_items WHERE order_id=?').all(o.id),
    pickup_otp: o.status === 'READY' ? derivedOtp('pickup', o.order_code) : undefined,
    rider: o.rider_id ? db.prepare('SELECT u.name FROM users u WHERE u.id=?').get(o.rider_id) : null,
    refund: db.prepare('SELECT status FROM refunds WHERE order_id=?').pluck().get(o.id) || null });
  r.get('/orders', (req, res) => { const t = getSetting(db, 'restaurant_accept_timeout_min');
    res.json({ accept_timeout_sec: t ? Number(t) * 60 : null, server_time: new Date().toISOString(), orders: db.prepare("SELECT * FROM orders WHERE restaurant_id=? AND status NOT IN ('PAYMENT_PENDING','PAYMENT_FAILED','EXPIRED') ORDER BY id DESC LIMIT 100").all(req.restaurantId).map(serialize) }); });
  r.get('/orders/by-code/:code', (req, res) => {          // scoped by session: other restaurants' orders are simply "not found"
    const o = db.prepare('SELECT * FROM orders WHERE order_code=? AND restaurant_id=?').get(req.params.code.toUpperCase(), req.restaurantId);
    if (!o) return res.status(404).json({ error: 'Order not found.' });
    res.json({ order: { ...serialize(o), customer_name: o.customer_name, events: db.prepare('SELECT event_type,actor_role,created_at FROM order_events WHERE order_id=? ORDER BY id').all(o.id) } });
  });
  r.get('/orders/:id(\\d+)', (req, res) => { const o = db.prepare('SELECT * FROM orders WHERE id=? AND restaurant_id=?').get(req.params.id, req.restaurantId); o ? res.json({ order: serialize(o) }) : res.status(404).json({ error: 'Order not found.' }); });
  for (const step of ['accept', 'preparing', 'ready', 'reject'])
    r.post(`/orders/:id/${step}`, wrap((req, res) => send(res, restaurantStep(db, actor(req), req.restaurantId, Number(req.params.id), step, req.body || {}))));

  // earnings, cashouts (restaurant surge-charge requests were removed)
  // Daily earnings: one row per India day, from the commission record written when each order is delivered (same numbers as the ledger).
  const istDay = (col) => `substr(datetime(${col}, '+330 minutes'), 1, 10)`;
  const dayKey = (offset = 0) => new Date(Date.now() + 330 * 60_000 + offset * 864e5).toISOString().slice(0, 10);
  r.get('/earnings', (req, res) => { const rows = Object.fromEntries(db.prepare(`SELECT ${istDay('created_at')} AS d, COUNT(*) AS orders, SUM(base_paise) AS sales_paise, SUM(commission_paise) AS commission_paise, SUM(payout_paise) AS payout_paise
      FROM restaurant_commissions WHERE restaurant_id=? AND created_at >= ? GROUP BY d`).all(req.restaurantId, new Date(Date.now() - 15 * 864e5).toISOString()).map((x) => [x.d, x]));
    const daily = Array.from({ length: 14 }, (_, i) => dayKey(-i)).map((d) => ({ date: d, orders: rows[d]?.orders || 0, sales_paise: rows[d]?.sales_paise || 0, commission_paise: rows[d]?.commission_paise || 0, payout_paise: rows[d]?.payout_paise || 0 }));
    res.json({ daily, today: daily[0], yesterday: daily[1], methods: getSetting(db, 'payout_methods').split(','), balance: balances(db, 'restaurant', req.restaurantId),
    sales_paise: db.prepare("SELECT COALESCE(SUM(items_base_paise),0) FROM orders WHERE restaurant_id=? AND status='DELIVERED'").pluck().get(req.restaurantId),
    commission_paise: db.prepare("SELECT COALESCE(SUM(commission_paise),0) FROM orders WHERE restaurant_id=? AND status='DELIVERED'").pluck().get(req.restaurantId),
    orders: db.prepare("SELECT order_code,items_base_paise,commission_paise,restaurant_payout_paise,updated_at FROM orders WHERE restaurant_id=? AND status='DELIVERED' ORDER BY id DESC LIMIT 100").all(req.restaurantId),
    cashouts: db.prepare('SELECT c.id,c.amount_paise,c.status,c.payout_method,c.reject_reason,c.created_at,p.txn_reference,p.paid_at,p.proof_path IS NOT NULL AS has_proof FROM cashout_requests c LEFT JOIN cashout_proofs p ON p.cashout_id=c.id WHERE c.account_type=\'restaurant\' AND c.account_id=? ORDER BY c.id DESC').all(req.restaurantId) }); });
  r.post('/cashouts', wrap((req, res) => send(res, requestCashout(db, 'restaurant', req.restaurantId, req.user.id, req.body || {}), 201)));
  return r;
}
