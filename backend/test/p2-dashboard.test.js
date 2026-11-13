// Admin "Daily trend" data: checks the date buckets (IST) and that only DELIVERED orders / platform ledger rows are counted.
// Uses its own in-memory database and test rows only; no production data and no change to how money is recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:'); const server = createApp(db).listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const call = async (path, token) => { const r = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } }); return { status: r.status, body: await r.json() }; };
const PW = 'correct-horse-battery';
let admin, cust, rest, n = 0;

test('setup', async () => {
  db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run('admin', '+919600000001', 'Admin', bcrypt.hashSync(PW, 4));
  admin = (await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portal: 'admin', phone: '+919600000001', password: PW }) })).json()).token;
  assert.ok(admin);
  cust = db.prepare("INSERT INTO users (role,phone,name) VALUES ('customer','+919600000002','Cust')").run().lastInsertRowid;
  rest = db.prepare("INSERT INTO restaurants (name,admin_visible,approved) VALUES ('R',1,1)").run().lastInsertRowid;
});

// one order with a fixed price snapshot; DELIVERED orders also get the platform ledger rows the delivery step writes
const order = (status, at, total = 20000) => {
  const id = db.prepare(`INSERT INTO orders (order_code,customer_id,restaurant_id,status,items_base_paise,markup_paise,delivery_paise,total_paise,commission_bps,commission_paise,restaurant_payout_paise,rider_payout_paise,created_at,updated_at)
    VALUES (?,?,?,?,15000,1000,4000,?,1000,1500,13500,3000,?,?)`).run(`PLTEST${++n}`, cust, rest, status, total, at, at).lastInsertRowid;
  if (status === 'DELIVERED') for (const [k, v] of [['markup', 1000], ['commission', 1500], ['delivery_margin', 1000], ['tax_liability', 500]])
    db.prepare("INSERT INTO platform_transactions (account_type,account_id,kind,amount_paise,order_id,created_at) VALUES ('platform',0,?,?,?,?)").run(k, v, id, at);
  return id;
};

test('empty range: every day is present with zero values, no invented data', async () => {
  const r = await call('/api/admin/overview?preset=custom&from=2026-10-01&to=2026-10-07', admin);
  assert.equal(r.status, 200); assert.equal(r.body.daily.length, 7);
  assert.deepEqual(r.body.daily.map((d) => d.date), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']);
  assert.ok(r.body.daily.every((d) => d.collected_paise === 0 && d.revenue_paise === 0 && d.orders === 0));
  assert.equal(r.body.money.collected_paise, 0); assert.equal(r.body.money.platform_revenue_paise, 0);
});

test('realistic range: IST day buckets, only delivered orders, totals match the daily series', async () => {
  order('DELIVERED', '2026-11-10T18:29:59.000Z');            // 10 Nov 23:59 IST
  order('DELIVERED', '2026-11-10T18:30:00.000Z', 30000);     // 11 Nov 00:00 IST
  order('DELIVERED', '2026-11-11T06:00:00.000Z');            // 11 Nov 11:30 IST
  order('CANCELLED', '2026-11-11T07:00:00.000Z', 99900);     // never counted
  order('REJECTED', '2026-11-11T08:00:00.000Z', 99900);      // never counted
  order('PLACED', '2026-11-11T09:00:00.000Z', 99900);        // not delivered yet
  order('DELIVERED', '2026-11-13T18:30:00.000Z');            // 14 Nov IST: outside the range
  const r = await call('/api/admin/overview?preset=custom&from=2026-11-10&to=2026-11-12', admin);
  const by = Object.fromEntries(r.body.daily.map((d) => [d.date, d]));
  assert.deepEqual(Object.keys(by), ['2026-11-10', '2026-11-11', '2026-11-12']);
  assert.deepEqual([by['2026-11-10'].orders, by['2026-11-10'].collected_paise, by['2026-11-10'].revenue_paise], [1, 20000, 3500]);   // markup+commission+delivery margin; tax is a liability
  assert.deepEqual([by['2026-11-11'].orders, by['2026-11-11'].collected_paise, by['2026-11-11'].revenue_paise], [2, 50000, 7000]);
  assert.deepEqual([by['2026-11-12'].orders, by['2026-11-12'].collected_paise, by['2026-11-12'].revenue_paise], [0, 0, 0]);
  const sum = (k) => r.body.daily.reduce((s, d) => s + d[k], 0);
  assert.equal(sum('collected_paise'), r.body.money.collected_paise); assert.equal(sum('revenue_paise'), r.body.money.platform_revenue_paise);
  assert.equal(r.body.current.delivered, 3);
});

test('the overview never writes financial records', async () => {
  const count = () => [db.prepare('SELECT COUNT(*) FROM orders').pluck().get(), db.prepare('SELECT COUNT(*) FROM platform_transactions').pluck().get(), db.prepare('SELECT SUM(amount_paise) FROM platform_transactions').pluck().get()];
  const before = count(); for (const p of ['today', 'yesterday', '7d', '30d']) assert.equal((await call('/api/admin/overview?preset=' + p, admin)).status, 200);
  assert.deepEqual(count(), before);
});
