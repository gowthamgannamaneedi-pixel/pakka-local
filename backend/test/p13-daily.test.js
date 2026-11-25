// Daily personalised notification (one per customer per day, daytime only, by name) and friendly order updates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';
import { sendDaily, slotFor, messageFor } from '../src/services/daily.js';

const W = await makeWorld('9530');
test.after(() => W.close());
const at = (h, m = 0) => Date.UTC(2026, 10, 24, h, m) - 330 * 60_000;            // 24 Nov 2026, India time
const sub = (uid) => W.db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, keys_json, device_label) VALUES (?,?,?,?)").run(uid, `https://push.example/${uid}/${Math.random()}`, '{"p256dh":"x","auth":"y"}', 'test');
const daily = (uid) => W.db.prepare("SELECT * FROM notifications WHERE user_id=? AND kind='daily' ORDER BY id").all(uid);

test('each customer gets exactly one message a day, at their own daytime slot, addressed by first name', async () => {
  sub(W.custId);
  const slot = slotFor(W.custId, '2026-11-24'); assert.ok(slot >= 600 && slot <= 1290, 'between 10:00 and 21:30');
  assert.equal(sendDaily(W.db, at(7)), 0, 'nothing before 10 am');
  const before = Math.floor(slot / 60), mins = slot % 60;
  if (slot > 600) assert.equal(sendDaily(W.db, at(before, mins) - 60_000), 0, 'not before their slot');
  sendDaily(W.db, at(before, mins) + 60_000);
  const n = daily(W.custId); assert.equal(n.length, 1); assert.match(n[0].title, /Asha!$/); assert.ok(n[0].body.includes('Asha'));
  sendDaily(W.db, at(21, 59)); assert.equal(daily(W.custId).length, 1, 'never twice in a day');
  const next = Date.UTC(2026, 10, 25, 21, 59) - 330 * 60_000; sendDaily(W.db, next); assert.equal(daily(W.custId).length, 2, 'again the next day');
});

test('a real dish from an open kitchen is suggested; riders/restaurants and customers without a registered device get none; admin can switch it off', async () => {
  const m = messageFor(W.db, { id: W.custId, name: 'Asha Rao' }, at(13));
  assert.match(m.title, /^Lunch is ready when you are, Asha!/); assert.match(m.body, /Biryani from Test Kitchen is ready to order/); assert.equal(m.link, `/user/#/r/${W.rest}`);
  const other = await W.customer(W.ph(398), 'Ravi'), otherId = W.db.prepare('SELECT id FROM users WHERE phone=?').pluck().get(W.ph(398));
  sendDaily(W.db, at(21, 59)); assert.equal(daily(otherId).length, 0, 'no registered device: nothing queued');
  sub(W.riderId); sendDaily(W.db, at(21, 59)); assert.equal(daily(W.riderId).length, 0, 'customers only');
  await W.call('PUT', '/api/admin/settings', { settings: { daily_notify_enabled: '0' } }, W.admin); sub(otherId);
  assert.equal(sendDaily(W.db, at(21, 59)), 0, 'switched off');
  await W.call('PUT', '/api/admin/settings', { settings: { daily_notify_enabled: '1' } }, W.admin);
  void other;
});

test('order updates use plain words and the restaurant name', async () => {
  const o = await W.paidOrder();
  await W.call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, W.owner);
  const notes = W.db.prepare("SELECT title, body FROM notifications WHERE user_id=? AND order_id=? ORDER BY id").all(W.custId, o.id);
  assert.ok(notes.some((x) => x.title === 'Order placed!' && x.body.includes('Test Kitchen')));
  assert.ok(notes.some((x) => x.title === 'Order accepted' && x.body.includes('Test Kitchen accepted your order')));
});

test('admin can switch test ordering for everyone on and off (0/1 only)', async () => {
  assert.equal((await W.call('PUT', '/api/admin/settings', { settings: { test_orders_everyone: '1' } }, W.admin)).status, 200);
  const g = await W.call('GET', '/api/admin/settings', null, W.admin); assert.equal(g.body.settings.test_orders_everyone, '1'); assert.equal(typeof g.body.test_payments, 'boolean');
  assert.equal((await W.call('PUT', '/api/admin/settings', { settings: { test_orders_everyone: 'yes' } }, W.admin)).status, 400);
  assert.equal((await W.call('PUT', '/api/admin/settings', { settings: { test_orders_everyone: '0' } }, W.admin)).status, 200);
});
