import crypto from 'node:crypto';
import webpush from 'web-push';
import { config } from '../config.js';
import { iso, getSetting } from './core.js';

// ---- sender abstraction: Web Push today; FCM / desktop adapters can implement the same (subscription, payload) interface ----
let sender = null;
export const pushEnabled = () => !!sender;
export const setPushSender = (fn) => { sender = fn; };
if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  sender = (sub, payload) => webpush.sendNotification({ endpoint: sub.endpoint, keys: JSON.parse(sub.keys_json) }, payload, { TTL: 3600, urgency: 'high' });
}
const clickToken = (nid) => crypto.createHmac('sha256', config.jwtSecret).update(`click:${nid}`).digest('hex').slice(0, 24);
export const verifyClick = (nid, t) => typeof t === 'string' && t.length === 24 && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(clickToken(nid)));

// A queued push is stale if the thing it announces no longer needs action.
function stale(db, n) {
  if (!n.order_id) return false;
  const o = db.prepare('SELECT status, rider_id FROM orders WHERE id=?').get(n.order_id);
  if (!o) return true;
  if (n.kind === 'rider_offer') return !!o.rider_id || !['ACCEPTED', 'PREPARING', 'READY'].includes(o.status) || Date.now() - Date.parse(n.created_at) > Number(getSetting(db, 'offer_expiry_min')) * 60_000;   // offers expire
  if (n.kind === 'restaurant_new') return o.status !== 'PLACED'      // only while it still needs action, and only for a login still linked to THAT restaurant
    || !db.prepare('SELECT 1 FROM restaurant_users ru JOIN orders x ON x.restaurant_id=ru.restaurant_id WHERE ru.user_id=? AND x.id=?').get(n.user_id, n.order_id);
  return false;
}
const payloadFor = (db, n) => JSON.stringify({ title: n.title, body: n.body, url: n.deep_link || '/', tag: n.event_id, nid: n.id, t: clickToken(n.id), kind: n.kind,
  urgent: n.kind === 'rider_offer' || n.kind === 'restaurant_new', click: `${config.publicApiUrl}/api/push/click`,
  image: n.campaign_id ? (db.prepare('SELECT image_path FROM campaigns WHERE id=?').pluck().get(n.campaign_id) ? `${config.publicApiUrl}/api/files/public/${db.prepare('SELECT image_path FROM campaigns WHERE id=?').pluck().get(n.campaign_id)}` : undefined) : undefined });

// Fan out new notifications to each registered device, then send due deliveries (batched, with retry + cleanup).
export async function dispatchPush(db) {
  if (!sender) return { sent: 0 };
  db.transaction(() => {
    for (const n of db.prepare("SELECT * FROM notifications WHERE push_state='pending' ORDER BY id LIMIT 300").all()) {
      let state = 'done';
      if (stale(db, n)) state = 'skipped';
      else if (!db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(n.user_id)) state = 'skipped';      // deactivated accounts get nothing
      else if (n.kind === 'promo' && !db.prepare("SELECT 1 FROM users u LEFT JOIN customers c ON c.user_id=u.id WHERE u.id=? AND u.active=1 AND (u.role!='customer' OR c.promo_opt_in=1)").get(n.user_id)) state = 'skipped';
      else for (const s of db.prepare('SELECT id FROM push_subscriptions WHERE user_id=?').pluck().all(n.user_id))
        db.prepare('INSERT OR IGNORE INTO push_deliveries (notification_id, subscription_id) VALUES (?,?)').run(n.id, s);
      db.prepare('UPDATE notifications SET push_state=? WHERE id=?').run(state, n.id);
    }
  })();
  const due = db.prepare(`SELECT d.id AS did, d.attempts, d.subscription_id, s.endpoint, s.keys_json, n.* FROM push_deliveries d JOIN notifications n ON n.id=d.notification_id
    LEFT JOIN push_subscriptions s ON s.id=d.subscription_id WHERE d.status='pending' AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=?) ORDER BY d.id LIMIT 100`).all(iso());
  let sent = 0;
  for (const r of due) {
    const set = (status, extra = {}) => db.prepare('UPDATE push_deliveries SET status=?, attempts=attempts+?, last_error=?, next_attempt_at=?, sent_at=? WHERE id=?')
      .run(status, extra.attempt ? 1 : 0, extra.err ?? null, extra.next ?? null, status === 'sent' ? iso() : null, r.did);
    if (!r.endpoint) { set('gone'); continue; }
    if (stale(db, r)) { set('skipped', { err: 'stale' }); continue; }
    try { await sender(r, payloadFor(db, r)); set('sent', { attempt: true }); sent++; }
    catch (e) {
      const code = e.statusCode || 0;
      if (code === 404 || code === 410) { db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(r.subscription_id); set('gone', { attempt: true, err: String(code) }); }
      else if (r.attempts + 1 >= 4) set('failed', { attempt: true, err: String(code || e.message).slice(0, 80) });
      else set('pending', { attempt: true, err: String(code || 'network'), next: new Date(Date.now() + 5000 * 2 ** r.attempts).toISOString() });
    }
  }
  return { sent };
}

// ---- campaigns (promotional broadcasts, Web Push only) ----
const IST = 330 * 60_000;
export const istDayStart = () => new Date(Math.floor((Date.now() + IST) / 864e5) * 864e5 - IST).toISOString();
export function audienceUsers(db, type, param) {
  const cust = "SELECT u.id FROM users u JOIN customers c ON c.user_id=u.id WHERE u.role='customer' AND u.active=1 AND c.promo_opt_in=1";
  const days = (d) => new Date(Date.now() - Math.max(1, Math.min(365, Number(d) || 7)) * 864e5).toISOString();
  switch (type) {
    case 'all_customers': return db.prepare(cust).pluck().all();
    case 'location': return db.prepare(`${cust} AND u.id IN (SELECT customer_id FROM orders WHERE delivery_location_id=?)`).pluck().all(Number(param) || 0);
    case 'ordered_recent': return db.prepare(`${cust} AND u.id IN (SELECT customer_id FROM orders WHERE status NOT IN ('PAYMENT_PENDING','PAYMENT_FAILED','EXPIRED') AND created_at>=?)`).pluck().all(days(param));
    case 'inactive': return db.prepare(`${cust} AND u.id NOT IN (SELECT customer_id FROM orders WHERE created_at>=?)`).pluck().all(days(param));
    case 'riders': return db.prepare("SELECT id FROM users WHERE role='rider' AND active=1").pluck().all();
    case 'restaurants': return db.prepare("SELECT id FROM users WHERE role='restaurant' AND active=1").pluck().all();
    case 'user': return db.prepare("SELECT id FROM users WHERE phone=? AND active=1").pluck().all(String(param || ''));
    default: return [];
  }
}
export function processCampaigns(db) {
  const cap = Number(getSetting(db, 'promo_daily_cap'));
  for (const c of db.prepare("SELECT * FROM campaigns WHERE status='scheduled' AND scheduled_at<=? ORDER BY id LIMIT 3").all(iso())) {
    db.transaction(() => {
      if (!db.prepare("UPDATE campaigns SET status='sending' WHERE id=? AND status='scheduled'").run(c.id).changes) return;   // cancelled meanwhile
      let targeted = 0, capped = 0; const dayStart = istDayStart();
      for (const uid of audienceUsers(db, c.audience_type, c.audience_param)) {
        if (db.prepare("SELECT COUNT(*) FROM notifications WHERE user_id=? AND kind='promo' AND created_at>=?").pluck().get(uid, dayStart) >= cap) { capped++; continue; }
        db.prepare("INSERT OR IGNORE INTO notifications (event_id,user_id,category,title,body,deep_link,kind,campaign_id) VALUES (?,?,'promotional',?,?,?,'promo',?)")
          .run(`promo:${c.id}:${uid}`, uid, c.title, c.body, c.deep_link, c.id); targeted++;
      }
      db.prepare('UPDATE campaigns SET targeted=?, capped=? WHERE id=?').run(targeted, capped, c.id);
    })();
  }
  for (const c of db.prepare("SELECT id FROM campaigns WHERE status='sending'").all())     // finished when nothing is queued any more
    if (!db.prepare("SELECT 1 FROM notifications n WHERE n.campaign_id=? AND (n.push_state='pending' OR EXISTS (SELECT 1 FROM push_deliveries d WHERE d.notification_id=n.id AND d.status='pending'))").get(c.id))
      db.prepare("UPDATE campaigns SET status='completed', completed_at=? WHERE id=?").run(iso(), c.id);
}
export const campaignStats = (db, id) => ({
  sent: db.prepare("SELECT COUNT(*) FROM push_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.campaign_id=? AND d.status='sent'").pluck().get(id),
  failed: db.prepare("SELECT COUNT(*) FROM push_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.campaign_id=? AND d.status IN ('failed','gone')").pluck().get(id),
  clicked: db.prepare('SELECT COUNT(*) FROM notifications WHERE campaign_id=? AND clicked_at IS NOT NULL').pluck().get(id) });

export function offerRiders(db, orderId, exceptRider = 0) {
  const gen = db.prepare("SELECT COUNT(*) FROM order_events WHERE order_id=? AND event_type='ADMIN_INTERVENTION'").pluck().get(orderId);   // new generation after a reassignment
  const ttl = new Date(Date.now() - Number(getSetting(db, 'rider_online_ttl_sec')) * 1000).toISOString();
  for (const id of db.prepare("SELECT r.user_id FROM riders r JOIN users u ON u.id=r.user_id WHERE u.active=1 AND r.verification_status='approved' AND r.is_online=1 AND r.last_seen_at>? AND r.user_id!=?").pluck().all(ttl, exceptRider))
    db.prepare("INSERT OR IGNORE INTO notifications (event_id,user_id,category,title,body,deep_link,order_id,kind) VALUES (?,?,'transactional','New delivery offer','A delivery is available. Open the app to view details.',?,?,'rider_offer')").run(`offer:${orderId}:${id}:${gen}`, id, `/rider/#/job/${orderId}`, orderId);
}
import { setOfferHook } from './core.js';
setOfferHook(offerRiders);
