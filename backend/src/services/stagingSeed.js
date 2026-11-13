// STAGING-ONLY dummy accounts for testing all four portals (STAGING_TEST_ACCOUNTS=1; refused on production).
// - Synthetic +91 5xxxxxxxxx numbers: Indian mobile numbers start with 6-9, so these cannot reach a real phone.
// - Passwords are generated here and written ONLY to SECRETS_DIR/TEST-ACCOUNTS.txt (mode 600); never logged or returned.
// - Never resets or overwrites an existing account: a number already in use is skipped and reported.
// - Everything created is named "TEST …" and recorded in SECRETS_DIR/test-data.json so STAGING_TEST_ACCOUNTS=remove can clean it up.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

export const TEST = {
  admin: { phone: '+915000000001', name: 'TEST Pakka Admin' },
  restaurant: { name: 'TEST Restaurant (staging)', cuisine: 'Test kitchen', address: 'Staging test address (not a real place)', phone: '+915000000100' },
  owner: { phone: '+915000000101', name: 'TEST Restaurant Owner' },
  rider: { phone: '+915000000201', name: 'TEST Rider' },
  customer: { phone: '+915000000301', name: 'TEST Customer' },
  location: { name: 'TEST Staging Hostel', kind: 'Hostel', address: 'Staging test address (not a real place)', fee: 3000, km: 1.0, lat: 17.3400, lng: 78.3000 },   // map point: test value
  menu: [['TEST Veg Biryani', 12000, 15], ['TEST Masala Dosa', 6000, 10]]
};
const FILE = 'TEST-ACCOUNTS.txt', DATA = 'test-data.json';
const pw = () => crypto.randomBytes(15).toString('base64url');            // 20 characters
const readData = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, DATA), 'utf8')); } catch { return {}; } };

export function seedStagingTestAccounts(db, { secretsDir, appEnv, testOtp, publicUrl = '' }) {
  if (appEnv === 'production') throw new Error('Staging test accounts are refused on production.');
  if (!secretsDir) throw new Error('STAGING_TEST_ACCOUNTS needs SECRETS_DIR (where the generated passwords are saved).');
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  const rec = readData(secretsDir), made = [], skipped = [], lines = [];
  const userByPhone = (p) => db.prepare('SELECT id, role FROM users WHERE phone = ?').get(p);
  const newUser = (role, t, withPw) => {
    const ex = userByPhone(t.phone);
    if (ex) { skipped.push(`${t.phone} already used (${ex.role}); left unchanged`); return { id: ex.id, existed: true, role: ex.role }; }
    const p = withPw ? pw() : null;
    const id = db.prepare('INSERT INTO users (role, phone, name, password_hash) VALUES (?,?,?,?)').run(role, t.phone, t.name, p ? bcrypt.hashSync(p, 12) : null).lastInsertRowid;
    made.push(`${role} ${t.phone}`); return { id, password: p };
  };
  db.transaction(() => {
    // test admin (the first/real admin is never touched)
    const a = newUser('admin', TEST.admin, true);
    if (a.password) lines.push(['Admin', '/admin/', TEST.admin.name, TEST.admin.phone, a.password, 'Mobile + password']);
    rec.admin = a.id;
    // test restaurant + menu + open, visible and approved; linked owner login
    let rid = rec.restaurant && db.prepare('SELECT id FROM restaurants WHERE id = ? AND name = ?').pluck().get(rec.restaurant, TEST.restaurant.name);
    if (!rid) rid = db.prepare('SELECT id FROM restaurants WHERE name = ?').pluck().get(TEST.restaurant.name);
    if (!rid) {
      const r = TEST.restaurant;
      rid = db.prepare('INSERT INTO restaurants (name,cuisine,address,phone,description,commission_bps,markup_paise,admin_visible,approved) VALUES (?,?,?,?,?,1000,0,1,1)')
        .run(r.name, r.cuisine, r.address, r.phone, 'Staging test data. Safe to delete.').lastInsertRowid;
      for (const [n, price, prep] of TEST.menu) db.prepare('INSERT INTO food_items (restaurant_id,name,base_price_paise,prep_time_min) VALUES (?,?,?,?)').run(rid, n, price, prep);
      db.prepare('INSERT INTO restaurant_operating_status (restaurant_id,is_open) VALUES (?,1)').run(rid);
      made.push(`restaurant "${r.name}"`);
    }
    rec.restaurant = rid;
    const o = newUser('restaurant', TEST.owner, true);
    if (!o.existed) db.prepare('INSERT INTO restaurant_users VALUES (?,?)').run(o.id, rid);
    if (o.password) lines.push(['Restaurant', '/restaurant/', `${TEST.owner.name} (${TEST.restaurant.name})`, TEST.owner.phone, o.password, 'Mobile + password']);
    rec.owner = o.id;
    // test rider: starts as a DRAFT application, exactly like an admin-created agent (no shortcut to approved)
    const rd = newUser('rider', TEST.rider, true);
    if (!rd.existed) db.prepare("INSERT INTO riders (user_id, verification_status) VALUES (?, 'draft')").run(rd.id);
    // The TEST rider's synthetic number cannot receive a code, so its phone step is pre-verified (this one account only,
    // staging only). Every other rider still verifies their own number. Only the account this seeder created is touched.
    if (!rd.existed || rec.rider === rd.id)
      db.prepare("UPDATE riders SET phone_verified_at = COALESCE(phone_verified_at, ?) WHERE user_id = ? AND user_id IN (SELECT id FROM users WHERE phone = ? AND role = 'rider')")
        .run(new Date().toISOString(), rd.id, TEST.rider.phone);
    if (rd.password) lines.push(['Rider', '/rider/ or the Pakka Rider (Staging) app', TEST.rider.name, TEST.rider.phone, rd.password, 'Mobile + password; mobile number already verified (test account only)']);
    rec.rider = rd.id;
    // test customer: no password (customers sign in with a one-time code)
    const c = newUser('customer', TEST.customer, false);
    if (!c.existed) { db.prepare('INSERT INTO customers (user_id) VALUES (?)').run(c.id); lines.push(['Customer', '/user/', TEST.customer.name, TEST.customer.phone, '(none: one-time code)', 'Mobile + staging test code']); }
    rec.customer = c.id;
    // a listed delivery place for the test customer
    let lid = db.prepare('SELECT id FROM delivery_locations WHERE name = ?').pluck().get(TEST.location.name);
    if (!lid) { const l = TEST.location; lid = db.prepare('INSERT INTO delivery_locations (name,kind,address,delivery_fee_paise,distance_km,lat,lng) VALUES (?,?,?,?,?,?,?)').run(l.name, l.kind, l.address, l.fee, l.km, l.lat, l.lng).lastInsertRowid; made.push(`delivery place "${l.name}"`); }
    rec.location = lid;
  })();
  fs.writeFileSync(path.join(secretsDir, DATA), JSON.stringify(rec, null, 2), { mode: 0o600 });
  if (lines.length) {
    const otpPhones = testOtp?.phones || [], code = testOtp?.code;
    const otpNote = [TEST.rider.phone, TEST.customer.phone].map((p) => `${p}: ${otpPhones.includes(p) && code ? `test code ${code}` : 'NOT enabled for the staging test code (add it to TEST_OTP_PHONES)'}`).join('\n  ');
    const body = `\n==== Pakka Local STAGING test accounts, created ${new Date().toISOString()} ====\nStaging only. Synthetic +91 5xxxxxxxxx numbers (no real phone can receive anything). Site: ${publicUrl || '(staging site)'}\n\n`
      + lines.map(([portal, url, name, phone, pass, how]) => `${portal}\n  URL: ${url}\n  Name: ${name}\n  Mobile: ${phone}\n  Password: ${pass}\n  Sign-in: ${how}\n`).join('\n')
      + `\nStaging test code (customer login and rider phone verification; nothing is sent):\n  ${otpNote}\n\nKeep this file private. Delete it once the passwords are saved in a password manager.\n`;
    fs.appendFileSync(path.join(secretsDir, FILE), body, { mode: 0o600 });
  }
  return { made, skipped, file: lines.length ? FILE : null };
}

// Removes the dummy data recorded in test-data.json. Anything with history (orders, audit entries) is deactivated instead.
export function removeStagingTestAccounts(db, { secretsDir, appEnv }) {
  if (appEnv === 'production') throw new Error('Refused on production.');
  const rec = readData(secretsDir), out = [];
  const attempt = (label, del, fallback) => { try { db.transaction(del)(); out.push(`${label}: deleted`); } catch { if (fallback) { fallback(); out.push(`${label}: deactivated (has history)`); } else out.push(`${label}: kept (has history)`); } };
  const offUser = (id) => () => db.prepare('UPDATE users SET active = 0, token_version = token_version + 1 WHERE id = ?').run(id);
  const delUser = (id, extra = []) => () => { for (const s of extra) db.prepare(s).run(id); db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(id); db.prepare('DELETE FROM notifications WHERE user_id = ?').run(id); db.prepare('DELETE FROM users WHERE id = ?').run(id); };
  const isTest = (id, phone) => id && db.prepare('SELECT 1 FROM users WHERE id = ? AND phone = ?').get(id, phone);
  if (isTest(rec.customer, TEST.customer.phone)) attempt('customer', delUser(rec.customer, ['DELETE FROM customer_addresses WHERE customer_id = ?', 'DELETE FROM customers WHERE user_id = ?']), offUser(rec.customer));
  if (isTest(rec.rider, TEST.rider.phone)) attempt('rider', delUser(rec.rider, ['DELETE FROM rider_verification_history WHERE rider_id = ?', 'DELETE FROM rider_phone_otps WHERE rider_id = ?', 'DELETE FROM riders WHERE user_id = ?']), offUser(rec.rider));
  if (isTest(rec.owner, TEST.owner.phone)) attempt('restaurant login', delUser(rec.owner, ['DELETE FROM restaurant_users WHERE user_id = ?']), offUser(rec.owner));
  if (rec.restaurant && db.prepare('SELECT 1 FROM restaurants WHERE id = ? AND name = ?').get(rec.restaurant, TEST.restaurant.name))
    attempt('restaurant', () => { for (const t of ['food_items', 'restaurant_operating_status']) db.prepare(`DELETE FROM ${t} WHERE restaurant_id = ?`).run(rec.restaurant); db.prepare('DELETE FROM restaurants WHERE id = ?').run(rec.restaurant); },
      () => db.prepare('UPDATE restaurants SET admin_visible = 0 WHERE id = ?').run(rec.restaurant));
  if (rec.location && db.prepare('SELECT 1 FROM delivery_locations WHERE id = ? AND name = ?').get(rec.location, TEST.location.name))
    attempt('delivery place', () => db.prepare('DELETE FROM delivery_locations WHERE id = ?').run(rec.location), () => db.prepare('UPDATE delivery_locations SET active = 0 WHERE id = ?').run(rec.location));
  if (isTest(rec.admin, TEST.admin.phone)) attempt('test admin', delUser(rec.admin), offUser(rec.admin));
  return out;
}
