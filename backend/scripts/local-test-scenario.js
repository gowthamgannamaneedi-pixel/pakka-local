// LOCAL TESTING ONLY. Builds browser-test scenarios against a running local server through the normal API
// (sandbox payments, test-code OTP). Refuses to run unless the server is on localhost and this is not production.
//
//   node scripts/local-test-scenario.js pending 3     -> 3 paid orders waiting for the restaurant (PLACED)
//   node scripts/local-test-scenario.js tracking      -> 1 order out for delivery, rider location shared
//   node scripts/local-test-scenario.js history 7     -> delivered orders spread over the last 7 days (test DB only)
//   Modes can be chained in one run: node scripts/local-test-scenario.js history 7 tracking pending 3
//
// Logins come from backend/data/LOCAL-TEST-LOGINS.txt (gitignored).
import { readFileSync } from 'node:fs';
import { config } from '../src/config.js';
import { openDb } from '../src/db/index.js';

if (config.isProd || config.appEnv === 'production' || config.appEnv === 'staging') { console.error('Refusing: local testing only.'); process.exit(1); }
const BASE = process.env.BASE || `http://localhost:${config.port}`;
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error('Refusing: BASE must be a localhost URL.'); process.exit(1); }
const logins = readFileSync(new URL('../data/LOCAL-TEST-LOGINS.txt', import.meta.url), 'utf8');
const PW = logins.match(/password: (\S+)/)[1], OTP = logins.match(/OTP code: (\d{6})/)[1];
const CUST = '+919700000001', REST = '+919000010001', RIDER = '+919000020001';

const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Origin: BASE, ...(token && { Authorization: `Bearer ${token}` }) }, body: body == null ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j)}`); return j;
};
const staff = async (portal, phone) => (await call('POST', '/api/auth/login', { portal, phone, password: PW })).token;
const customer = async () => { await call('POST', '/api/auth/customer/otp/request', { phone: CUST }); return (await call('POST', '/api/auth/customer/otp/verify', { phone: CUST, otp: OTP })).token; };

const bad = process.argv.slice(2).filter((a) => !/^\d+$/.test(a) && !['pending', 'tracking', 'history'].includes(a));
if (!process.argv[2] || bad.length) { console.error('Usage: node scripts/local-test-scenario.js [history 7] [tracking] [pending 3]'); process.exit(1); }
const cust = await customer(), rest = await staff('restaurant', REST), rider = await staff('rider', RIDER);
await call('POST', '/api/rider/online', { online: true }, rider);                     // customers can only order while a rider is online
const { restaurants } = await call('GET', '/api/public/restaurants', null, cust); const R = restaurants.find((r) => r.name === 'Spice Route Biryani');
const { items } = await call('GET', `/api/public/restaurants/${R.id}/menu`, null, cust);
const { locations } = await call('GET', '/api/public/locations', null, cust);
const place = async (k, pin) => {
  const cart = [{ id: items[k % items.length].id, qty: 1 + (k % 2) }, ...(k % 3 === 0 ? [{ id: items[(k + 1) % items.length].id, qty: 1 }] : [])];
  const o = await call('POST', '/api/customer/orders', { restaurant_id: R.id, items: cart, ...(pin ? { lat: 17.4401, lng: 78.3489, dest_text: 'Test drop-off, Gachibowli' } : { location_id: locations[k % locations.length].id }) }, cust);
  await call('POST', `/api/customer/payments/sandbox/${o.order_code}/complete`, { outcome: 'success' }, cust);
  const { orders } = await call('GET', '/api/restaurant/orders', null, rest); return orders.find((x) => x.order_code === o.order_code);
};
const toPickedUp = async (o) => {
  await call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, rest); await call('POST', `/api/rider/orders/${o.id}/accept`, {}, rider); await call('POST', `/api/restaurant/orders/${o.id}/ready`, {}, rest);
  const otp = (await call('GET', '/api/restaurant/orders', null, rest)).orders.find((x) => x.id === o.id).pickup_otp; await call('POST', `/api/rider/orders/${o.id}/pickup`, { otp }, rider);
};

const MODES = {
 pending: async (arg) => {
  const n = Number(arg || 3); for (let k = 0; k < n; k++) { const o = await place(k); console.log('PLACED', o.order_code, o.total_items_paise / 100); }
 },
 tracking: async () => {
  const o = await place(1, true); await toPickedUp(o);
  await call('POST', '/api/tracking/rider/location', { lat: 17.4448, lng: 78.3772, accuracy: 12, recorded_at: Date.now() }, rider);
  console.log('PICKED_UP with live rider location:', o.order_code);
 },
 history: async (arg) => {
  const days = Number(arg || 7), db = openDb(config.dbPath), plan = [2, 1, 3, 0, 2, 4, 1].slice(0, days);   // day 3 deliberately has no orders
  for (let d = 0; d < plan.length; d++) for (let j = 0; j < plan[d]; j++) {
    const o = await place(d + j); await toPickedUp(o);
    const dotp = (await call('GET', `/api/customer/orders/${o.order_code}`, null, cust)).delivery_otp; await call('POST', `/api/rider/orders/${o.id}/deliver`, { otp: dotp }, rider);
    // move this TEST order (and its own ledger rows) back in time so the 7-day chart has history; amounts are untouched
    const back = (days - 1 - d) * 864e5 + j * 37 * 60e3, shift = (t) => new Date(Date.parse(t) - back).toISOString();
    db.transaction(() => { const row = db.prepare('SELECT created_at, updated_at FROM orders WHERE id=?').get(o.id);
      db.prepare('UPDATE orders SET created_at=?, updated_at=? WHERE id=?').run(shift(row.created_at), shift(row.updated_at), o.id);
      for (const t of db.prepare('SELECT id, created_at FROM platform_transactions WHERE order_id=?').all(o.id)) db.prepare('UPDATE platform_transactions SET created_at=? WHERE id=?').run(shift(t.created_at), t.id); })();
    console.log('DELIVERED', o.order_code, `day -${days - 1 - d}`);
  }
 } };
// several modes may be chained in one run (one OTP login): e.g. history 7 tracking pending 3
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) { const f = MODES[argv[i]]; const a = /^\d+$/.test(argv[i + 1] || '') ? argv[++i] : undefined; await f(a); }
