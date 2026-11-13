import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { claimOrder, dismissOffer, verifyPickup, verifyDelivery, balances, requestCashout, saveUpload, iso, getSetting } from '../services/core.js';
import { send, parse, wrap } from './util.js';

export function riderRoutes(db) {
  const r = Router();
  r.use(authenticate(db), requireRole('rider'));
  const me = (req) => db.prepare('SELECT * FROM riders WHERE user_id=?').get(req.user.id);
  const touch = (req) => db.prepare('UPDATE riders SET last_seen_at=? WHERE user_id=? AND is_online=1').run(iso(), req.user.id);
  const card = (o) => ({ id: o.id, order_code: o.order_code, status: o.status, fee_paise: o.rider_payout_paise, eta_at: o.eta_at,
    restaurant: db.prepare('SELECT name,address,phone,maps_link FROM restaurants WHERE id=?').get(o.restaurant_id),
    customer: { name: o.customer_name, phone: o.customer_phone }, destination: { text: o.dest_text, lat: o.dest_lat, lng: o.dest_lng, maps_link: o.dest_maps_link },
    instructions: o.instructions, distance_km: o.delivery_location_id ? db.prepare('SELECT distance_km FROM delivery_locations WHERE id=?').pluck().get(o.delivery_location_id) : null,
    items: db.prepare('SELECT name,qty FROM order_items WHERE order_id=?').all(o.id) });
  const restaurantMaps = (c) => { if (c.restaurant && !c.restaurant.maps_link) c.restaurant.maps_link = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.restaurant.name} ${c.restaurant.address || ''}`)}`; return c; };

  r.get('/me', (req, res) => { touch(req); const x = me(req); res.json({ rider: { verification_status: x.verification_status, is_online: x.is_online, vehicle_reg_no: x.vehicle_reg_no, profile_complete: !!(x.vehicle_reg_no && x.rc_path && x.licence_path && x.photo_path) } }); });
  r.post('/online', wrap((req, res) => {
    const d = parse(z.object({ online: z.boolean() }), req, res); if (!d) return;
    if (d.online && me(req).verification_status !== 'approved') return res.status(403).json({ error: 'Your account must be approved by Pakka Local before you can go online.' });
    db.prepare('UPDATE riders SET is_online=?, last_seen_at=? WHERE user_id=?').run(d.online ? 1 : 0, iso(), req.user.id);   // active deliveries are untouched
    res.json({ online: d.online });
  }));
  r.get('/offers', (req, res) => {
    touch(req); const x = me(req);
    if (!x.is_online || x.verification_status !== 'approved') return res.json({ offers: [], active: [] });
    const offers = db.prepare(`SELECT * FROM orders o WHERE rider_id IS NULL AND status IN ('ACCEPTED','PREPARING','READY')
      AND NOT EXISTS (SELECT 1 FROM rider_assignments a WHERE a.order_id=o.id AND a.rider_id=? AND a.status='DISMISSED') ORDER BY id`).all(req.user.id).map(card).map(restaurantMaps);
    const active = db.prepare("SELECT * FROM orders WHERE rider_id=? AND status IN ('ACCEPTED','PREPARING','READY','PICKED_UP') ORDER BY id").all(req.user.id).map(card).map(restaurantMaps);
    res.json({ offers, active });
  });
  // single order (notification deep link): only if it is yours, or still genuinely open for you to take
  r.get('/orders/:id(\\d+)', (req, res) => { touch(req); const x = me(req);
    const o = db.prepare("SELECT * FROM orders WHERE id=? AND (rider_id=? OR (rider_id IS NULL AND status IN ('ACCEPTED','PREPARING','READY')))").get(req.params.id, req.user.id);
    if (!o || (o.rider_id == null && (!x.is_online || x.verification_status !== 'approved'))) return res.status(404).json({ error: 'This delivery is no longer available.' });
    res.json({ order: restaurantMaps(card(o)), mine: o.rider_id === req.user.id }); });
  r.get('/active', (req, res) => res.json({ active: db.prepare("SELECT * FROM orders WHERE rider_id=? AND status IN ('ACCEPTED','PREPARING','READY','PICKED_UP') ORDER BY id").all(req.user.id).map(card).map(restaurantMaps) }));
  r.post('/orders/:id/accept', wrap((req, res) => { try { send(res, claimOrder(db, req.user.id, Number(req.params.id))); } catch (e) { if (e.rollback) return res.status(409).json({ error: 'This order is no longer available.' }); throw e; } }));
  r.post('/orders/:id/dismiss', (req, res) => res.json(dismissOffer(db, req.user.id, Number(req.params.id))));
  r.post('/orders/:id/pickup', wrap((req, res) => send(res, verifyPickup(db, req.user.id, Number(req.params.id), req.body?.otp))));
  r.post('/orders/:id/deliver', wrap((req, res) => send(res, verifyDelivery(db, req.user.id, Number(req.params.id), req.body?.otp))));
  r.get('/earnings', (req, res) => {
    const since = (d) => new Date(Date.now() - d * 86400_000).toISOString(), sum = (s) => db.prepare('SELECT COALESCE(SUM(amount_paise),0) FROM rider_earnings WHERE rider_id=? AND created_at>=?').pluck().get(req.user.id, s);
    res.json({ methods: getSetting(db, 'payout_methods').split(','), completed_count: db.prepare('SELECT COUNT(*) FROM rider_earnings WHERE rider_id=?').pluck().get(req.user.id), balance: balances(db, 'rider', req.user.id), today_paise: sum(new Date(new Date().toISOString().slice(0, 10)).toISOString()), week_paise: sum(since(7)),
      deliveries: db.prepare('SELECT o.order_code,e.amount_paise,e.created_at FROM rider_earnings e JOIN orders o ON o.id=e.order_id WHERE e.rider_id=? ORDER BY e.id DESC LIMIT 100').all(req.user.id),
      cashouts: db.prepare('SELECT c.id,c.amount_paise,c.status,c.payout_method,c.reject_reason,c.created_at,p.txn_reference,p.paid_at,p.proof_path IS NOT NULL AS has_proof FROM cashout_requests c LEFT JOIN cashout_proofs p ON p.cashout_id=c.id WHERE c.account_type=\'rider\' AND c.account_id=? ORDER BY c.id DESC').all(req.user.id) });
  });
  r.post('/cashouts', wrap((req, res) => send(res, requestCashout(db, 'rider', req.user.id, req.user.id, req.body || {}), 201)));
  // onboarding
  const vehicle = z.object({ email: z.string().trim().email().max(120).optional().or(z.literal('')), address: z.string().trim().min(5).max(200), emergency_phone: z.string().trim().min(10).max(16), vehicle_category: z.enum(['Motorcycle', 'Scooter', 'Electric Scooter', 'Other']),
    vehicle_make: z.string().trim().min(1).max(40), vehicle_model: z.string().trim().min(1).max(40), vehicle_reg_no: z.string().trim().min(5).max(16), licence_no: z.string().trim().min(5).max(30), insurance_no: z.string().max(30).optional() });
  r.put('/profile', wrap((req, res) => { const d = parse(vehicle, req, res); if (!d) return;
    db.prepare('UPDATE users SET email=? WHERE id=?').run(d.email || null, req.user.id);
    db.prepare("UPDATE riders SET address=?,emergency_phone=?,vehicle_category=?,vehicle_make=?,vehicle_model=?,vehicle_reg_no=?,licence_no=?,insurance_no=?, verification_status=CASE WHEN verification_status IN ('rejected','corrections_requested') THEN 'pending' ELSE verification_status END WHERE user_id=?")
      .run(d.address, d.emergency_phone, d.vehicle_category, d.vehicle_make, d.vehicle_model, d.vehicle_reg_no.toUpperCase().replace(/\s+/g, ' '), d.licence_no, d.insurance_no ?? null, req.user.id); res.json({ ok: true }); }));
  const DOC = { photo: 'photo_path', vehicle_photo: 'vehicle_photo_path', rc: 'rc_path', licence: 'licence_path', insurance: 'insurance_path' };
  r.post('/documents', wrap((req, res) => { const col = DOC[req.body?.kind]; if (!col) return res.status(400).json({ error: 'Unknown document type.' });
    const f = saveUpload(req.body.data, { scope: 'private', allow: ['png', 'jpg', 'webp', 'pdf'] });
    db.prepare(`UPDATE riders SET ${col}=? WHERE user_id=?`).run(f, req.user.id); res.json({ ok: true }); }));
  r.get('/profile', (req, res) => { const x = me(req); res.json({ profile: { ...x, email: db.prepare('SELECT email FROM users WHERE id=?').pluck().get(req.user.id), photo_path: undefined, rc_path: undefined, licence_path: undefined, insurance_path: undefined, vehicle_photo_path: undefined,
    docs: { photo: !!x.photo_path, vehicle_photo: !!x.vehicle_photo_path, rc: !!x.rc_path, licence: !!x.licence_path, insurance: !!x.insurance_path },
    history: db.prepare('SELECT status,note,created_at FROM rider_verification_history WHERE rider_id=? ORDER BY id DESC').all(req.user.id) } }); });
  return r;
}
