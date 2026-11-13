// Delivery-agent application: draft saving, completeness checklist, phone verification, submission and admin decisions.
// Eligibility for orders is decided elsewhere by verification_status = 'approved' only (see core.js / routes/rider.js).
import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { iso, saveUpload } from './core.js';

// ---------- payout secrets (bank account number, UPI ID): AES-256-GCM at rest, separate key label from MFA ----------
const key = () => crypto.createHash('sha256').update(`payout:${config.jwtSecret}`).digest();
export const seal = (txt) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv); const d = Buffer.concat([c.update(String(txt), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), d]).toString('base64'); };
export const unseal = (b64) => { const r = Buffer.from(b64, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', key(), r.subarray(0, 12)); d.setAuthTag(r.subarray(12, 28)); return Buffer.concat([d.update(r.subarray(28)), d.final()]).toString('utf8'); };
const maskUpi = (u) => { const [a, b] = u.split('@'); return `${a.slice(0, 2)}${'•'.repeat(Math.max(2, a.length - 2))}@${b}`; };

export const VEHICLES = ['Motorcycle', 'Scooter', 'Electric Scooter', 'Bicycle', 'Other'];
const motor = (v) => v && v !== 'Bicycle';      // a bicycle needs no driving licence or registration certificate
export const ID_TYPES = { aadhaar: 'Aadhaar (masked copy)', voter_id: 'Voter ID', passport: 'Passport', pan: 'PAN card' };
const twoSided = (t) => t === 'aadhaar' || t === 'voter_id';
// document kind -> column
export const DOCS = { photo: 'photo_path', id_front: 'id_front_path', id_back: 'id_back_path', licence: 'licence_path', rc: 'rc_path', vehicle_photo: 'vehicle_photo_path', insurance: 'insurance_path' };
export const DOC_LABEL = { photo: 'Profile photo', id_front: 'Identity document (front)', id_back: 'Identity document (back)', licence: 'Driving licence', rc: 'Vehicle registration certificate (RC)', vehicle_photo: 'Vehicle photo (number plate visible)', insurance: 'Vehicle insurance' };
// states in which the agent may edit and (re)submit
export const EDITABLE = ['draft', 'corrections_requested', 'reverification_required'];

const ageOn = (dob, now = new Date()) => { const d = new Date(dob + 'T00:00:00Z'); let a = now.getUTCFullYear() - d.getUTCFullYear(); const m = now.getUTCMonth() - d.getUTCMonth(); if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) a--; return a; };
const today = () => new Date().toISOString().slice(0, 10);

// What is still missing. Each entry: { key, label, section }. Empty list = complete.
export function missing(r) {
  const out = [], need = (ok, key, label, section) => { if (!ok) out.push({ key, label, section }); };
  need(r.legal_name, 'legal_name', 'Full legal name', 'personal');
  need(r.date_of_birth, 'date_of_birth', 'Date of birth', 'personal');
  need(r.phone_verified_at, 'phone_verified', 'Verify your mobile number', 'personal');
  need(r.address, 'address', 'Current address', 'personal');
  need(r.emergency_phone, 'emergency_phone', 'Emergency contact number', 'personal');
  need(r.photo_path, 'photo', DOC_LABEL.photo, 'personal');
  need(r.id_type, 'id_type', 'Identity document type', 'identity');
  need(r.id_last4, 'id_last4', 'Last 4 digits of the identity document', 'identity');
  need(r.id_front_path, 'id_front', DOC_LABEL.id_front, 'identity');
  if (twoSided(r.id_type)) need(r.id_back_path, 'id_back', DOC_LABEL.id_back, 'identity');
  need(r.vehicle_category, 'vehicle_category', 'Vehicle type', 'vehicle');
  need(r.vehicle_photo_path, 'vehicle_photo', DOC_LABEL.vehicle_photo, 'vehicle');
  if (motor(r.vehicle_category)) {
    need(r.vehicle_make && r.vehicle_model, 'vehicle_model', 'Vehicle make and model', 'vehicle');
    need(r.vehicle_reg_no, 'vehicle_reg_no', 'Vehicle registration number', 'vehicle');
    need(r.rc_path, 'rc', DOC_LABEL.rc, 'vehicle');
    need(r.licence_no, 'licence_no', 'Driving licence number', 'vehicle');
    need(r.licence_expiry, 'licence_expiry', 'Driving licence expiry date', 'vehicle');
    need(r.licence_path, 'licence', DOC_LABEL.licence, 'vehicle');
  }
  need(r.payout_method === 'upi' ? r.payout_upi_enc : r.payout_method === 'bank' ? (r.bank_holder && r.bank_account_enc && r.bank_ifsc) : null, 'payout', 'Payout details (UPI or bank account)', 'payout');
  need(r.consent_at, 'consent', 'Declaration and consent', 'review');
  return out;
}
// Problems that block submission/approval even when every field is filled
export function problems(r) {
  const p = [];
  if (r.date_of_birth && ageOn(r.date_of_birth) < 18) p.push('You must be at least 18 years old.');
  if (motor(r.vehicle_category) && r.licence_expiry && r.licence_expiry < today()) p.push('Your driving licence has expired.');
  return p;
}

// What the agent sees: never the stored file names or the full payout secrets
export function view(db, r) {
  const u = db.prepare('SELECT name, phone, email FROM users WHERE id=?').get(r.user_id);
  return { status: r.verification_status, editable: EDITABLE.includes(r.verification_status),
    name: u.name, phone: u.phone, email: u.email, phone_verified: !!r.phone_verified_at,
    legal_name: r.legal_name, date_of_birth: r.date_of_birth, address: r.address, emergency_phone: r.emergency_phone,
    id_type: r.id_type, id_last4: r.id_last4, vehicle_category: r.vehicle_category, vehicle_make: r.vehicle_make, vehicle_model: r.vehicle_model,
    vehicle_reg_no: r.vehicle_reg_no, licence_no: r.licence_no, licence_expiry: r.licence_expiry, insurance_no: r.insurance_no,
    payout_method: r.payout_method, payout_upi_hint: r.payout_upi_hint, bank_holder: r.bank_holder, bank_account_last4: r.bank_account_last4, bank_ifsc: r.bank_ifsc,
    consent: !!r.consent_at, submitted_at: r.submitted_at, decided_at: r.decided_at, decision_note: r.decision_note,
    correction_fields: r.correction_fields ? JSON.parse(r.correction_fields) : [],
    docs: Object.fromEntries(Object.entries(DOCS).map(([k, c]) => [k, !!r[c]])),
    missing: missing(r), problems: problems(r), updated_at: r.application_updated_at };
}

const opt = (s) => s.optional().or(z.literal('').transform(() => null)).nullable();
const draftSchema = z.object({
  legal_name: opt(z.string().trim().min(3, 'Enter your full name as on your ID.').max(80).regex(/^[\p{L} .'-]+$/u, 'Use letters only in your name.')),
  date_of_birth: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date of birth.').refine((d) => !Number.isNaN(Date.parse(d)) && d < today(), 'Use a valid date of birth.')),
  address: opt(z.string().trim().min(10, 'Enter your full address.').max(300)),
  emergency_phone: opt(z.string().trim().regex(/^\+?[0-9 ]{10,16}$/, 'Enter a valid emergency contact number.')),
  email: opt(z.string().trim().email('Enter a valid email address.').max(120)),
  id_type: opt(z.enum(Object.keys(ID_TYPES))),
  id_last4: opt(z.string().trim().regex(/^[0-9A-Za-z]{4}$/, 'Enter only the last 4 characters of the ID number.')),
  vehicle_category: opt(z.enum(VEHICLES)),
  vehicle_make: opt(z.string().trim().min(1).max(40)), vehicle_model: opt(z.string().trim().min(1).max(40)),
  vehicle_reg_no: opt(z.string().trim().toUpperCase().regex(/^[A-Z]{2}[ -]?[0-9]{1,2}[ -]?[A-Z]{0,3}[ -]?[0-9]{1,4}$/, 'Enter the number as on the RC, e.g. TS 09 AB 1234.')),
  licence_no: opt(z.string().trim().toUpperCase().regex(/^[A-Z0-9 -]{8,20}$/, 'Enter a valid driving licence number.')),
  licence_expiry: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid expiry date.')),
  insurance_no: opt(z.string().trim().max(30)),
  payout_method: opt(z.enum(['upi', 'bank'])),
  payout_upi: opt(z.string().trim().regex(/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}$/, 'Enter a valid UPI ID, e.g. name@okbank.')),
  bank_holder: opt(z.string().trim().min(3).max(80)),
  bank_account: opt(z.string().trim().regex(/^[0-9]{9,18}$/, 'Enter a valid bank account number (9 to 18 digits).')),
  bank_ifsc: opt(z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC code, e.g. SBIN0001234.')),
  consent: z.boolean().optional()
}).strict();

const row = (db, id) => db.prepare('SELECT * FROM riders WHERE user_id=?').get(id);
const fail = (error, status = 400, code) => ({ error, status, code });
const locked = (r) => r.verification_status === 'pending' ? fail('Your application is being reviewed. You can edit it again only if the admin asks for corrections.', 409, 'UNDER_REVIEW')
  : r.verification_status === 'approved' ? fail('Your application is approved. Contact Pakka Local to change verified details.', 409, 'LOCKED')
  : fail('This application cannot be edited. Contact Pakka Local.', 409, 'LOCKED');

// Partial save: only the fields sent are changed; any field may be left for later.
export function saveDraft(db, riderId, body) {
  const r = row(db, riderId); if (!r) return fail('Not found.', 404);
  if (!EDITABLE.includes(r.verification_status)) return locked(r);
  const p = draftSchema.safeParse(body ?? {}); if (!p.success) return fail(p.error.issues[0].message);
  const d = p.data, set = {};
  for (const k of ['legal_name', 'date_of_birth', 'address', 'emergency_phone', 'id_type', 'id_last4', 'vehicle_category', 'vehicle_make', 'vehicle_model', 'vehicle_reg_no', 'licence_no', 'licence_expiry', 'insurance_no', 'payout_method', 'bank_holder', 'bank_ifsc'])
    if (k in d) set[k] = d[k];
  if ('id_last4' in d && d.id_last4) set.id_last4 = d.id_last4.toUpperCase();
  if ('payout_upi' in d) { set.payout_upi_enc = d.payout_upi ? seal(d.payout_upi) : null; set.payout_upi_hint = d.payout_upi ? maskUpi(d.payout_upi) : null; }
  if ('bank_account' in d) { set.bank_account_enc = d.bank_account ? seal(d.bank_account) : null; set.bank_account_last4 = d.bank_account ? d.bank_account.slice(-4) : null; }
  if ('consent' in d) set.consent_at = d.consent ? iso() : null;
  if ('id_type' in d && d.id_type !== r.id_type) set.id_back_path = null;      // a back side belongs to the previous document
  const changed = Object.keys(set).length;
  db.transaction(() => {
    if (changed) db.prepare(`UPDATE riders SET ${Object.keys(set).map((k) => `${k}=@${k}`).join(',')}, application_updated_at=@t WHERE user_id=@id`).run({ ...set, t: iso(), id: riderId });
    if ('email' in d) db.prepare('UPDATE users SET email=? WHERE id=?').run(d.email, riderId);
  })();
  return { ok: true, application: view(db, row(db, riderId)) };
}

export function uploadDoc(db, riderId, kind, data) {
  const r = row(db, riderId); if (!r) return fail('Not found.', 404);
  if (!EDITABLE.includes(r.verification_status)) return locked(r);
  const col = DOCS[kind]; if (!col) return fail('Unknown document type.');
  const allow = kind === 'photo' || kind === 'vehicle_photo' ? ['png', 'jpg', 'webp'] : ['png', 'jpg', 'webp', 'pdf'];
  const f = saveUpload(data, { scope: 'private', allow, maxBytes: 5_000_000 });     // type checked from file content, not the name
  db.prepare(`UPDATE riders SET ${col}=?, application_updated_at=? WHERE user_id=?`).run(f, iso(), riderId);
  return { ok: true, application: view(db, row(db, riderId)) };
}

export function submit(db, riderId) {
  const r = row(db, riderId); if (!r) return fail('Not found.', 404);
  if (!EDITABLE.includes(r.verification_status)) return locked(r);
  const m = missing(r); if (m.length) return { ...fail(`Complete these first: ${m.map((x) => x.label).join(', ')}.`, 400, 'INCOMPLETE'), missing: m };
  const pr = problems(r); if (pr.length) return fail(pr.join(' '), 400, 'NOT_ELIGIBLE');
  db.transaction(() => {
    db.prepare("UPDATE riders SET verification_status='pending', is_online=0, submitted_at=?, correction_fields=NULL WHERE user_id=?").run(iso(), riderId);
    db.prepare("INSERT INTO rider_verification_history (rider_id,status,action,note) VALUES (?,'pending','submitted',?)").run(riderId, r.verification_status === 'draft' ? 'Application submitted' : 'Application resubmitted');
  })();
  return { ok: true, application: view(db, row(db, riderId)) };
}

// ---------- admin ----------
export const DECISIONS = { approve: 'approved', reject: 'rejected', corrections: 'corrections_requested', suspend: 'suspended' };
export function decide(db, adminId, riderId, { action, note, fields }) {
  const r = row(db, riderId); if (!r) return fail('Delivery agent not found.', 404);
  const st = DECISIONS[action]; if (!st) return fail('Unknown action.');
  note = String(note || '').trim().slice(0, 500);
  if (action !== 'approve' && note.length < 5) return fail('Enter a reason (at least 5 characters). The delivery agent will see it.');
  if (action === 'approve') {
    if (!['pending', 'suspended'].includes(r.verification_status)) return fail('Only a submitted application (or a suspended agent with a complete application) can be approved.', 409);
    const m = missing(r), pr = problems(r);
    if (m.length || pr.length) return fail(`The application is not complete: ${[...m.map((x) => x.label), ...pr].join(', ')}.`, 409);
  }
  if (action === 'corrections') {
    if (!['pending', 'approved', 'suspended', 'reverification_required'].includes(r.verification_status)) return fail('Corrections can be requested only for a submitted or active application.', 409);
    if (!Array.isArray(fields) || !fields.length) return fail('Choose what needs to be corrected.');
  }
  if (action === 'reject' && !['pending', 'corrections_requested', 'reverification_required', 'draft'].includes(r.verification_status)) return fail('Use Suspend for an approved agent.', 409);
  if (action === 'suspend' && !['approved', 'reverification_required'].includes(r.verification_status)) return fail('Only an approved agent can be suspended.', 409);
  const f = action === 'corrections' ? fields.filter((x) => typeof x === 'string').slice(0, 30) : null;
  db.transaction(() => {
    db.prepare('UPDATE riders SET verification_status=?, is_online=CASE WHEN ?=\'approved\' THEN is_online ELSE 0 END, decided_at=?, decided_by=?, decision_note=?, correction_fields=? WHERE user_id=?')
      .run(st, st, iso(), adminId, note || null, f ? JSON.stringify(f) : null, riderId);
    db.prepare('INSERT INTO rider_verification_history (rider_id,status,action,note,admin_id,fields) VALUES (?,?,?,?,?,?)').run(riderId, st, action, note || null, adminId, f ? JSON.stringify(f) : null);
  })();
  return { ok: true, status: st };
}

// Full record for the admin review screen. Payout numbers stay masked unless revealed through the audited endpoint.
export function adminView(db, riderId) {
  const r = row(db, riderId); if (!r) return null;
  const u = db.prepare('SELECT id, name, phone, email, active, created_at FROM users WHERE id=?').get(riderId);
  return { ...view(db, r), user: u, is_online: !!r.is_online,
    active_deliveries: db.prepare("SELECT order_code, status FROM orders WHERE rider_id=? AND status IN ('ACCEPTED','PREPARING','READY','PICKED_UP')").all(riderId),
    history: db.prepare('SELECT h.status, h.action, h.note, h.fields, h.created_at, a.name AS admin_name FROM rider_verification_history h LEFT JOIN users a ON a.id=h.admin_id WHERE h.rider_id=? ORDER BY h.id DESC').all(riderId)
      .map((h) => ({ ...h, fields: h.fields ? JSON.parse(h.fields) : null })) };
}
export function revealPayout(db, riderId) {
  const r = row(db, riderId); if (!r) return null;
  return { method: r.payout_method, upi: r.payout_upi_enc ? unseal(r.payout_upi_enc) : null, bank_holder: r.bank_holder, bank_account: r.bank_account_enc ? unseal(r.bank_account_enc) : null, bank_ifsc: r.bank_ifsc };
}
