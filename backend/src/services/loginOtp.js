// Customer LOGIN codes sent on WhatsApp. Separate from pickup / delivery codes (different table, different hashing key),
// so a login code can never complete a delivery and a delivery code can never log anyone in.
// - 6 digits from crypto.randomInt; only an HMAC of (phone, code) is stored; codes are never logged.
// - Only the newest code for a number works: sending a new one cancels the old ones.
// - Expiry, attempts per code, resend wait, codes per hour and a temporary block after repeated wrong codes are configurable.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getOtpProvider, OtpSendError, loginChannel } from '../otpProviders.js';

const iso = (t = Date.now()) => new Date(t).toISOString();
export const hashOtp = (phone, otp) => crypto.createHmac('sha256', config.jwtSecret).update(`${phone}:${otp}`).digest('hex');
const mins = (ms) => Math.max(1, Math.ceil(ms / 60_000));
const err = (status, error, code, extra = {}) => ({ status, error, code, ...extra });

// Indian mobile numbers: +91 followed by 10 digits; real WhatsApp numbers start with 6-9.
// (Staging test accounts use +915... numbers with the fixed test code, so the 6-9 rule applies to real WhatsApp sending only.)
export function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s()-]/g, '');
  if (/^0\d{10}$/.test(p)) p = p.slice(1);
  if (/^\d{10}$/.test(p)) p = '+91' + p; else if (/^91\d{10}$/.test(p)) p = '+' + p;
  return /^\+91\d{10}$/.test(p) ? p : null;
}
export const realMobile = (p) => /^\+91[6-9]\d{9}$/.test(p);

function blocked(db, phone, now) {
  const b = db.prepare('SELECT blocked_until FROM otp_blocks WHERE phone=?').get(phone);
  return b?.blocked_until && b.blocked_until > iso(now) ? Date.parse(b.blocked_until) - now : 0;
}
function noteFailure(db, phone, now) {
  const b = db.prepare('SELECT * FROM otp_blocks WHERE phone=?').get(phone), fresh = !b || now - Date.parse(b.window_start) > 3600_000;
  const fails = fresh ? 1 : b.fails + 1, until = fails >= config.otp.blockAfterFails ? iso(now + config.otp.blockMs) : null;
  db.prepare(`INSERT INTO otp_blocks (phone,fails,window_start,blocked_until) VALUES (?,?,?,?)
    ON CONFLICT(phone) DO UPDATE SET fails=excluded.fails, window_start=excluded.window_start, blocked_until=COALESCE(excluded.blocked_until, otp_blocks.blocked_until)`)
    .run(phone, fails, fresh ? iso(now) : b.window_start, until);
  return until ? config.otp.blockMs : 0;
}

const SEND_MSG = {
  invalid_number: [400, 'We couldn’t send a WhatsApp message to this number. Check that it is your WhatsApp number and try again.', 'NOT_ON_WHATSAPP'],
  not_allowed: [403, 'This number is not added as a WhatsApp test recipient yet (test mode).', 'NOT_A_TEST_RECIPIENT'],
  rate_limited: [429, 'WhatsApp is busy right now. Please try again in a minute.', 'WHATSAPP_BUSY'],
  unavailable: [503, 'WhatsApp login is not available right now. Please try again shortly.', 'WHATSAPP_UNAVAILABLE'],
};
const SMS_MSG = {
  invalid_number: [400, 'We couldn’t send an SMS to this number. Check the number and try again.', 'BAD_NUMBER'],
  not_allowed: [403, 'SMS login is not available for this number.', 'SMS_NOT_ALLOWED'],
  rate_limited: [429, 'SMS service is busy right now. Please try again in a minute.', 'SMS_BUSY'],
  unavailable: [503, 'SMS login is not available right now. Please try again shortly.', 'SMS_UNAVAILABLE'],
};

export async function requestCode(db, rawPhone, now = Date.now()) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return err(400, 'Enter a valid 10-digit mobile number.', 'BAD_NUMBER');
  const prov = getOtpProvider();
  if (!prov.fixedFor && ['whatsapp', 'msg91', 'fast2sms', 'startmessaging'].includes(config.otpProvider) && !realMobile(phone)) return err(400, 'Enter a valid 10-digit Indian mobile number.', 'BAD_NUMBER');
  const wait = blocked(db, phone, now);
  if (wait) return err(429, `Too many wrong codes. Try again in ${mins(wait)} minute${mins(wait) > 1 ? 's' : ''}.`, 'BLOCKED', { retryAfterSec: Math.ceil(wait / 1000) });
  let otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  if (prov.fixedFor) { otp = prov.fixedFor(phone); if (!otp) return err(403, 'This number is not enabled for test login.', 'NOT_A_TESTER'); }
  // check + create in one transaction, so two quick taps cannot both create a code
  const made = db.transaction(() => {
    const last = db.prepare('SELECT created_at FROM otp_challenges WHERE phone=? ORDER BY id DESC LIMIT 1').get(phone);
    const since = last ? now - Date.parse(last.created_at) : Infinity;
    if (since < config.otp.resendCooldownMs) return err(429, `Please wait ${Math.ceil((config.otp.resendCooldownMs - since) / 1000)} seconds before asking for another code.`, 'WAIT', { retryAfterSec: Math.ceil((config.otp.resendCooldownMs - since) / 1000) });
    const hour = db.prepare('SELECT COUNT(*) FROM otp_challenges WHERE phone=? AND created_at>?').pluck().get(phone, iso(now - 3600_000));
    if (hour >= config.otp.maxPerHour) return err(429, 'Too many codes requested for this number. Try again in an hour.', 'HOURLY_LIMIT');
    db.prepare('UPDATE otp_challenges SET used=1 WHERE phone=? AND used=0').run(phone);                     // older codes stop working now
    return { id: db.prepare('INSERT INTO otp_challenges (phone, otp_hash, expires_at, channel, created_at) VALUES (?,?,?,?,?)')
      .run(phone, hashOtp(phone, otp), iso(now + config.otp.ttlMs), config.otpProvider, iso(now)).lastInsertRowid };
  })();
  if (made.error) return made;
  try {
    const r = await prov.send(phone, otp);
    db.prepare("UPDATE otp_challenges SET wa_message_id=?, delivery='sent', delivery_at=? WHERE id=?").run(r?.messageId ?? null, iso(), made.id);
  } catch (e) {
    db.prepare("UPDATE otp_challenges SET used=1, delivery='failed', delivery_error=? WHERE id=?").run(String(e.message).slice(0, 200), made.id);
    console.error('Login code could not be sent:', e.message);                                            // never contains the code
    const [status, msg, code] = (loginChannel() === 'sms' ? SMS_MSG : SEND_MSG)[e instanceof OtpSendError ? e.kind : 'unavailable'];
    return err(status, msg, code);
  }
  return { ok: true, phone, resendAfterSec: config.otp.resendCooldownMs / 1000, expiresInSec: config.otp.ttlMs / 1000, channel: loginChannel() };
}

// Returns { phone } when the code is right (the code is used up), or an error.
export function checkCode(db, rawPhone, otp, now = Date.now()) {
  const phone = normalizePhone(rawPhone);
  if (!phone || !/^\d{6}$/.test(String(otp || ''))) return err(400, 'Enter the 6-digit code.', 'BAD_CODE');
  const wait = blocked(db, phone, now);
  if (wait) return err(429, `Too many wrong codes. Try again in ${mins(wait)} minute${mins(wait) > 1 ? 's' : ''}.`, 'BLOCKED');
  const ch = db.prepare('SELECT * FROM otp_challenges WHERE phone=? AND used=0 ORDER BY id DESC LIMIT 1').get(phone);
  if (!ch) return err(401, 'This code has expired or was replaced by a newer one. Request a new code.', 'EXPIRED');
  if (ch.expires_at < iso(now)) { db.prepare('UPDATE otp_challenges SET used=1 WHERE id=?').run(ch.id); return err(401, 'This code has expired. Request a new code.', 'EXPIRED'); }
  if (ch.attempts >= config.otp.maxAttempts) { db.prepare('UPDATE otp_challenges SET used=1 WHERE id=?').run(ch.id); return err(401, 'Too many wrong tries for this code. Request a new code.', 'TOO_MANY_TRIES'); }
  db.prepare('UPDATE otp_challenges SET attempts=attempts+1 WHERE id=?').run(ch.id);
  if (!crypto.timingSafeEqual(Buffer.from(ch.otp_hash), Buffer.from(hashOtp(phone, String(otp))))) {
    const left = config.otp.maxAttempts - ch.attempts - 1, blockedMs = noteFailure(db, phone, now);
    if (left <= 0) db.prepare('UPDATE otp_challenges SET used=1 WHERE id=?').run(ch.id);
    if (blockedMs) return err(429, `Too many wrong codes. Try again in ${mins(blockedMs)} minutes.`, 'BLOCKED');
    return err(401, left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code is not right. Request a new code.', left > 0 ? 'WRONG_CODE' : 'TOO_MANY_TRIES');
  }
  if (db.prepare('UPDATE otp_challenges SET used=1 WHERE id=? AND used=0').run(ch.id).changes !== 1) return err(401, 'This code was already used. Request a new code.', 'EXPIRED');   // single use
  db.prepare('DELETE FROM otp_blocks WHERE phone=?').run(phone);
  return { phone };
}

// What the code screen shows while waiting: sent / delivered / read / failed. WhatsApp: from Meta's delivery reports (webhook).
// SMS providers with a status lookup (StartMessaging): asked at most every 5 s per code while it is still on its way.
const lastAsk = new Map();
export async function deliveryStatus(db, rawPhone) {
  const phone = normalizePhone(rawPhone); if (!phone) return { status: 'unknown' };
  const ch = db.prepare('SELECT id, delivery, used, created_at, wa_message_id FROM otp_challenges WHERE phone=? ORDER BY id DESC LIMIT 1').get(phone);
  if (!ch || Date.now() - Date.parse(ch.created_at) > config.otp.ttlMs) return { status: 'unknown' };
  const prov = getOtpProvider();
  if (prov.status && ch.wa_message_id && (!ch.delivery || ch.delivery === 'sent') && Date.now() - (lastAsk.get(ch.id) || 0) > 5000) {
    lastAsk.set(ch.id, Date.now()); if (lastAsk.size > 500) lastAsk.clear();
    const st = await prov.status(ch.wa_message_id);
    if (st === 'delivered' || st === 'failed') { db.prepare('UPDATE otp_challenges SET delivery=?, delivery_at=? WHERE id=?').run(st, iso(), ch.id); return { status: st }; }
  }
  return { status: ch.delivery || 'sent' };
}

// Meta webhook: statuses[] { id: wamid, status: sent|delivered|read|failed, errors[] }. Signature checked by the route.
export function applyDeliveryReport(db, body) {
  let n = 0;
  for (const entry of body?.entry || []) for (const ch of entry.changes || []) for (const st of ch.value?.statuses || []) {
    if (!st?.id || !['sent', 'delivered', 'read', 'failed'].includes(st.status)) continue;
    const e = st.errors?.[0];
    n += db.prepare(`UPDATE otp_challenges SET delivery=CASE WHEN delivery IN ('read','failed') THEN delivery ELSE ? END, delivery_error=COALESCE(?, delivery_error), delivery_at=? WHERE wa_message_id=?`)
      .run(st.status, e ? `${e.code} ${e.title || ''}`.trim().slice(0, 200) : null, iso(), String(st.id)).changes;
  }
  return n;
}
