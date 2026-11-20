// Test world: an in-memory app with an admin, one restaurant (+ owner, one dish), one delivery place,
// one approved online rider and one customer, plus helpers to place paid orders and move them along.
import bcrypt from 'bcryptjs';
import { openDb } from '../../src/db/index.js';
import { createApp } from '../../src/app.js';
import { testOutbox } from '../../src/otpProviders.js';
import { completeApplication } from './rider-application.js';
import { withAddresses } from './address.js';

export const PW = 'correct-horse-battery';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export async function makeWorld(prefix = '9400') {
  const db = openDb(':memory:'); const server = createApp(db).listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const raw = async (method, path, body, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const call = withAddresses((...a) => raw(...a));
  const ph = (n) => `+91${prefix}${String(n).padStart(6, '0')}`;
  const staff = async (portal, phone) => (await raw('POST', '/api/auth/login', { portal, phone, password: PW })).body.token;
  const customer = async (phone, name) => { await raw('POST', '/api/auth/customer/otp/request', { phone }); return (await raw('POST', '/api/auth/customer/otp/verify', { phone, otp: testOutbox.at(-1).otp, name })).body.token; };
  db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run('admin', ph(1), 'Admin', bcrypt.hashSync(PW, 4));
  const W = { db, server, base, call, raw, staff, customer, ph };
  W.admin = await staff('admin', ph(1));
  W.rest = (await call('POST', '/api/admin/restaurants', { name: 'Test Kitchen', commission_bps: 1000, markup_paise: 2000, admin_visible: true, approved: true }, W.admin)).body.id;
  await call('POST', '/api/admin/users', { role: 'restaurant', name: 'Owner', phone: ph(101), password: PW, restaurant_id: W.rest }, W.admin);
  W.owner = await staff('restaurant', ph(101)); await call('PUT', '/api/restaurant/location', { lat: 17.385, lng: 78.4867, source: 'manual' }, W.owner); await call('POST', '/api/restaurant/status', { open: true }, W.owner);
  W.item = (await call('POST', '/api/restaurant/menu', { name: 'Biryani', base_price_paise: 14000, prep_time_min: 20, image: PNG }, W.owner)).body.id;
  W.loc = (await call('POST', '/api/admin/locations', { name: 'Sunrise Hostel', address: 'Uppal Road', delivery_fee_paise: 4000, distance_km: 2 }, W.admin)).body.id;
  await call('POST', '/api/admin/users', { role: 'rider', name: 'Rahul', phone: ph(201), password: PW }, W.admin);
  W.rider = await staff('rider', ph(201)); W.riderId = db.prepare('SELECT id FROM users WHERE phone=?').pluck().get(ph(201));
  await completeApplication(call, W.rider, 7);
  await call('POST', `/api/admin/riders/${W.riderId}/verify`, { action: 'approve', reauth_password: PW }, W.admin);
  await call('POST', '/api/rider/online', { online: true }, W.rider);
  W.cust = await customer(ph(301), 'Asha'); W.custId = db.prepare('SELECT id FROM users WHERE phone=?').pluck().get(ph(301));
  W.cart = (o = {}) => ({ restaurant_id: W.rest, items: [{ id: W.item, qty: 1 }], location_id: W.loc, ...o });
  W.paidOrder = async (o = {}, token = W.cust) => { const r = await call('POST', '/api/customer/orders', W.cart(o), token); if (r.status !== 201) throw new Error('order ' + r.status + ' ' + JSON.stringify(r.body));
    await call('POST', `/api/customer/payments/sandbox/${r.body.order_code}/complete`, { outcome: 'success' }, token);
    return db.prepare('SELECT * FROM orders WHERE order_code=?').get(r.body.order_code); };
  W.notes = (userId, kindOrTitle) => db.prepare('SELECT * FROM notifications WHERE user_id=? AND (kind=? OR title=?) ORDER BY id').all(userId, kindOrTitle, kindOrTitle);
  W.close = () => server.close();
  return W;
}
