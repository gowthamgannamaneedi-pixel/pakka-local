import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { claimOrder, dismissOffer, verifyPickup, verifyDelivery, balances, requestCashout, saveUpload, iso, getSetting } from '../services/core.js';
import { send, parse, wrap } from './util.js';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { getOtpProvider } from '../otpProviders.js';
import { view, saveDraft, uploadDoc, submit, EDITABLE, ID_TYPES, VEHICLES, DOC_LABEL, missing } from '../services/riderApplication.js';
const otpLimit = rateLimit({ windowMs: 15 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false, skip: () => config.isTest, message: { error: 'Too many attempts. Try again later.' } });

export function riderRoutes(db) {
  const r = Router();
  r.use(authenticate(db), requireRole('rider'));
  const me = (req) => db.prepare('SELECT * FROM riders WHERE user_id=?').get(req.user.id);
  const touch = (req) => db.prepare('UPDATE riders SET last_seen_at=? WHERE user_id=? AND is_online=1').run(iso(), req.user.id);
  // mine=false (an open offer): no customer phone, exact address, GPS pin, maps link or instructions until the rider has accepted
  const card = (o, mine = o.rider_id != null) => {
    const loc = o.delivery_location_id ? db.prepare('SELECT name, area, distance_km FROM delivery_locations WHERE id=?').get(o.delivery_location_id) : null;
    return { id: o.id, order_code: o.order_code, status: o.status, fee_paise: o.rider_payout_paise, eta_at: o.eta_at,
      restaurant: db.prepare('SELECT name,address,phone,maps_link FROM restaurants WHERE id=?').get(o.restaurant_id),
      customer: mine ? { name: o.customer_name, phone: o.customer_phone } : { name: null, phone: null },
      destination: mine ? { text: o.dest_text, lat: o.dest_lat, lng: o.dest_lng, maps_link: o.dest_maps_link }
        : { text: loc ? [loc.name, loc.area].filter(Boolean).join(', ') : 'Customer pinned location', area_only: true, lat: null, lng: null, maps_link: null },
      instructions: mine ? o.instructions : null, distance_km: loc?.distance_km ?? null,
      items: db.prepare('SELECT name,qty FROM order_items WHERE order_id=?').all(o.id) };
  };
  const restaurantMaps = (c) => { if (c.restaurant && !c.restaurant.maps_link) c.restaurant.maps_link = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.restaurant.name} ${c.restaurant.address || ''}`)}`; return c; };

  r.get('/me', (req, res) => { touch(req); const x = me(req); const m = missing(x);
    res.json({ rider: { verification_status: x.verification_status, is_online: x.is_online, vehicle_reg_no: x.vehicle_reg_no, vehicle_category: x.vehicle_category, can_take_orders: x.verification_status === 'approved',
      missing_count: m.length, profile_complete: !m.length, decision_note: x.decision_note, correction_fields: x.correction_fields ? JSON.parse(x.correction_fields) : [] } }); });
  r.post('/online', wrap((req, res) => {
    const d = parse(z.object({ online: z.boolean() }), req, res); if (!d) return;
    if (d.online && me(req).verification_status !== 'approved') return res.status(403).json({ error: 'Your account must be approved by Pakka Local before you can go online.' });
    db.prepare('UPDATE riders SET is_online=?, last_seen_at=? WHERE user_id=?').run(d.online ? 1 : 0, iso(), req.user.id);   // active deliveries are untouched
    res.json({ online: d.online });
  }));
  r.get('/offers', (req, res) => {
    touch(req); const x = me(req);
    // deliveries already assigned stay visible (and finishable) whatever the verification state; new offers only for approved + online
    const active = db.prepare("SELECT * FROM orders WHERE rider_id=? AND status IN ('ACCEPTED','PREPARING','READY','PICKED_UP') ORDER BY id").all(req.user.id).map((o) => card(o, true)).map(restaurantMaps);
    if (!x.is_online || x.verification_status !== 'approved') return res.json({ offers: [], active });
    const offers = db.prepare(`SELECT * FROM orders o WHERE rider_id IS NULL AND status IN ('ACCEPTED','PREPARING','READY')
      AND NOT EXISTS (SELECT 1 FROM rider_assignments a WHERE a.order_id=o.id AND a.rider_id=? AND a.status='DISMISSED') ORDER BY id`).all(req.user.id).map((o) => card(o, false)).map(restaurantMaps);
    res.json({ offers, active });
  });
  // single order (notification deep link): only if it is yours, or still genuinely open for you to take
  r.get('/orders/:id(\\d+)', (req, res) => { touch(req); const x = me(req);
    const o = db.prepare("SELECT * FROM orders WHERE id=? AND (rider_id=? OR (rider_id IS NULL AND status IN ('ACCEPTED','PREPARING','READY')))").get(req.params.id, req.user.id);
    if (!o || (o.rider_id == null && (!x.is_online || x.verification_status !== 'approved'))) return res.status(404).json({ error: 'This delivery is no longer available.' });
    res.json({ order: restaurantMaps(card(o, o.rider_id === req.user.id)), mine: o.rider_id === req.user.id }); });
  r.get('/active', (req, res) => res.json({ active: db.prepare("SELECT * FROM orders WHERE rider_id=? AND status IN ('ACCEPTED','PREPARING','READY','PICKED_UP') ORDER BY id").all(req.user.id).map((o) => card(o, true)).map(restaurantMaps) }));
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
  // ---------- application (save as you go, resume any time, submit when complete) ----------
  r.get('/application', (req, res) => res.json({ application: view(db, me(req)), id_types: ID_TYPES, vehicles: VEHICLES, doc_labels: DOC_LABEL,
    history: db.prepare('SELECT status,action,note,fields,created_at FROM rider_verification_history WHERE rider_id=? ORDER BY id DESC LIMIT 20').all(req.user.id).map((h) => ({ ...h, fields: h.fields ? JSON.parse(h.fields) : null })) }));
  r.put('/application', wrap((req, res) => send(res, saveDraft(db, req.user.id, req.body))));
  r.post('/application/documents', wrap((req, res) => send(res, uploadDoc(db, req.user.id, req.body?.kind, req.body?.data))));
  r.post('/application/submit', wrap((req, res) => send(res, submit(db, req.user.id))));
  // mobile number verification (code sent through the configured OTP provider; codes are hashed and single-use)
  const otpHash = (id, otp) => crypto.createHmac('sha256', config.jwtSecret).update(`rider-phone:${id}:${otp}`).digest('hex');
  r.post('/application/phone/request', otpLimit, wrap(async (req, res) => {
    const x = me(req); if (!EDITABLE.includes(x.verification_status)) return res.status(409).json({ error: 'Your application cannot be edited right now.' });
    const last = db.prepare('SELECT created_at FROM rider_phone_otps WHERE rider_id=? ORDER BY id DESC LIMIT 1').get(req.user.id);
    if (last && Date.now() - Date.parse(last.created_at) < config.otp.resendCooldownMs) return res.status(429).json({ error: 'Please wait a few seconds before requesting another code.' });
    const prov = getOtpProvider(); let otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    if (prov.fixedFor) { otp = prov.fixedFor(req.user.phone); if (!otp) return res.status(403).json({ error: 'This number is not enabled for test codes.' }); }
    const id = db.prepare('INSERT INTO rider_phone_otps (rider_id, phone, otp_hash, expires_at) VALUES (?,?,?,?)').run(req.user.id, req.user.phone, otpHash(req.user.id, otp), new Date(Date.now() + config.otp.ttlMs).toISOString()).lastInsertRowid;
    try { await prov.send(req.user.phone, otp); } catch (e) { db.prepare('UPDATE rider_phone_otps SET used=1 WHERE id=?').run(id); console.error('OTP delivery failed:', e.message); return res.status(502).json({ error: 'We could not send the code. Please try again.' }); }
    res.json({ ok: true, sent_to: req.user.phone, resendAfterSec: config.otp.resendCooldownMs / 1000 });
  }));
  r.post('/application/phone/verify', otpLimit, wrap((req, res) => {
    const x = me(req); if (!EDITABLE.includes(x.verification_status)) return res.status(409).json({ error: 'Your application cannot be edited right now.' });
    const c = db.prepare('SELECT * FROM rider_phone_otps WHERE rider_id=? AND used=0 ORDER BY id DESC LIMIT 1').get(req.user.id);
    if (!c || Date.parse(c.expires_at) < Date.now() || c.phone !== req.user.phone) return res.status(400).json({ error: 'The code has expired. Request a new one.' });
    if (c.attempts >= config.otp.maxAttempts) { db.prepare('UPDATE rider_phone_otps SET used=1 WHERE id=?').run(c.id); return res.status(429).json({ error: 'Too many wrong attempts. Request a new code.' }); }
    const ok = /^\d{6}$/.test(String(req.body?.otp || '')) && crypto.timingSafeEqual(Buffer.from(otpHash(req.user.id, String(req.body.otp))), Buffer.from(c.otp_hash));
    if (!ok) { db.prepare('UPDATE rider_phone_otps SET attempts=attempts+1 WHERE id=?').run(c.id); return res.status(400).json({ error: 'Incorrect code.' }); }
    db.transaction(() => { db.prepare('UPDATE rider_phone_otps SET used=1 WHERE id=?').run(c.id); db.prepare('UPDATE riders SET phone_verified_at=?, application_updated_at=? WHERE user_id=?').run(iso(), iso(), req.user.id); })();
    res.json({ ok: true, application: view(db, me(req)) });
  }));
  return r;
}
