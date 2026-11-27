// Production clean-up: test/demo accounts go (deleted, or switched off when they have orders), real accounts and the
// main admin stay, a backup is taken first, and only the main admin with a fresh password can run it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { makeWorld, PW } from './helpers/world.js';
import { config } from '../src/config.js';

const W = await makeWorld('9650');
test.after(() => W.close());
const add = (role, phone, name) => W.db.prepare('INSERT INTO users (role, phone, name, password_hash) VALUES (?,?,?,?)').run(role, phone, name, bcrypt.hashSync(PW, 4)).lastInsertRowid;

test('preview lists only test/demo items; run deletes or switches off, keeps real data, backs up first', async () => {
  const tAdmin = add('admin', '+915000000001', 'TEST Pakka Admin');
  const tCust = add('customer', '+915000000301', 'TEST Customer'); W.db.prepare('INSERT INTO customers (user_id) VALUES (?)').run(tCust);
  const demoRider = add('rider', '+915000000311', 'Demo Rider One');
  const realCust = add('customer', '+919812345678', 'Priya'); W.db.prepare('INSERT INTO customers (user_id) VALUES (?)').run(realCust);
  const demoRest = W.db.prepare("INSERT INTO restaurants (name, approved, admin_visible) VALUES ('Demo Restaurant 1', 1, 0)").run().lastInsertRowid;
  // a test customer with an order cannot be deleted (history): use the world's paid order flow with a test-number customer
  const tok = await W.customer('+915000000302', 'TEST Buyer'); await W.paidOrder({}, tok);
  const pv = (await W.call('GET', '/api/admin/cleanup', null, W.admin)).body;
  const phones = pv.users.map((u) => u.phone);
  assert.ok(phones.includes('+915000000001') && phones.includes('+915000000301') && phones.includes('+915000000311') && phones.includes('+915000000302'));
  assert.ok(!phones.includes('+919812345678'), 'real customer never listed'); assert.ok(!phones.includes(W.ph(1)), 'the running admin never listed');
  assert.ok(pv.restaurants.some((r) => r.name === 'Demo Restaurant 1')); assert.ok(!pv.restaurants.some((r) => r.name === 'Test Kitchen'));
  const before = fs.existsSync(config.backupDir) ? fs.readdirSync(config.backupDir).length : 0;
  const run = await W.call('POST', '/api/admin/cleanup', { reauth_password: PW }, W.admin);
  assert.equal(run.status, 200, JSON.stringify(run.body)); assert.ok(run.body.backup.endsWith('.sqlite'));
  assert.ok(fs.readdirSync(config.backupDir).length > before, 'backup file written');
  const exists = (id) => !!W.db.prepare('SELECT 1 FROM users WHERE id=?').get(id);
  assert.equal(exists(tAdmin), false); assert.equal(exists(tCust), false); assert.equal(exists(demoRider), false);
  const buyer = W.db.prepare("SELECT active FROM users WHERE phone='+915000000302'").get(); assert.equal(buyer.active, 0, 'has an order: switched off, history kept');
  assert.equal(exists(realCust), true); assert.equal(W.db.prepare('SELECT 1 FROM restaurants WHERE id=?').get(demoRest), undefined);
  assert.equal(W.db.prepare("SELECT COUNT(*) FROM orders").pluck().get() >= 1, true, 'orders kept');
});

test('needs the password again', async () => {
  assert.equal((await W.call('POST', '/api/admin/cleanup', {}, W.admin)).status, 401);
});
