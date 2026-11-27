// Daily personalised notification (one per customer per day, daytime only, by name) and friendly order updates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';
import { sendDaily, slotFor, messageFor, MOMENTS } from '../src/services/daily.js';

const W = await makeWorld('9530');
test.after(() => W.close());
const at = (h, m = 0) => Date.UTC(2026, 10, 24, h, m) - 330 * 60_000;            // 24 Nov 2026, India time
const sub = (uid) => W.db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, keys_json, device_label) VALUES (?,?,?,?)").run(uid, `https://push.example/${uid}/${Math.random()}`, '{"p256dh":"x","auth":"y"}', 'test');
const daily = (uid) => W.db.prepare("SELECT * FROM notifications WHERE user_id=? AND kind='daily' ORDER BY id").all(uid);


test('up to three messages a day (lunch, snack, dinner), each at the customer’s own time in its window, by first name', async () => {
  sub(W.custId);
  for (const w of MOMENTS) { const s = slotFor(W.custId, '2026-11-24', w.k); assert.ok(s >= w.from && s < w.to, w.k); }
  assert.equal(sendDaily(W.db, at(9)), 0, 'nothing before 10 am');
  const lunch = slotFor(W.custId, '2026-11-24', 'lunch');
  sendDaily(W.db, at(Math.floor(lunch / 60), lunch % 60) - 60_000); assert.equal(daily(W.custId).length, 0, 'not before their lunch time');
  sendDaily(W.db, at(Math.floor(lunch / 60), lunch % 60) + 60_000);
  let n = daily(W.custId); assert.equal(n.length, 1); assert.match(n[0].title, /Asha/); assert.match(n[0].body, /Biryani from Test Kitchen/); assert.equal(n[0].deep_link, `/user/#/r/${W.rest}`);
  sendDaily(W.db, at(14)); assert.equal(daily(W.custId).length, 1, 'lunch only once');
  sendDaily(W.db, at(18, 1)); sendDaily(W.db, at(21, 10)); n = daily(W.custId);
  assert.equal(n.length, 3, 'lunch + snack + dinner'); assert.deepEqual(n.map((x) => x.event_id.split(':').pop()), ['lunch', 'snack', 'dinner']);
  sendDaily(W.db, at(21, 25)); assert.equal(daily(W.custId).length, 3, 'never more than three');
  assert.equal(sendDaily(W.db, at(22, 30)), 0, 'never at night');
});

test('fewer per day when admin asks; nothing when kitchens are closed, offers are off, no device, not a customer, or switched off', async () => {
  const day2 = (h, m = 0) => at(h, m) + 864e5;
  assert.equal((await W.call('PUT', '/api/admin/settings', { settings: { notify_per_day: '1' } }, W.admin)).status, 200);
  assert.equal((await W.call('PUT', '/api/admin/settings', { settings: { notify_per_day: '5' } }, W.admin)).status, 400);
  sendDaily(W.db, day2(14)); sendDaily(W.db, day2(18, 1)); sendDaily(W.db, day2(21, 10));
  assert.deepEqual(daily(W.custId).slice(3).map((x) => x.event_id.split(':').pop()), ['dinner'], 'one a day = dinner only');
  await W.call('PUT', '/api/admin/settings', { settings: { notify_per_day: '3' } }, W.admin);
  const other = await W.customer(W.ph(398), 'Ravi'), otherId = W.db.prepare('SELECT id FROM users WHERE phone=?').pluck().get(W.ph(398)); void other;
  const day3 = (h, m = 0) => at(h, m) + 2 * 864e5;
  sendDaily(W.db, day3(13, 50)); assert.equal(daily(otherId).length, 0, 'no device registered');
  sub(otherId); W.db.prepare('UPDATE customers SET promo_opt_in=0 WHERE user_id=?').run(otherId);
  sendDaily(W.db, day3(13, 50)); assert.equal(daily(otherId).length, 0, 'offers & updates turned off');
  sub(W.riderId); sendDaily(W.db, day3(13, 50)); assert.equal(daily(W.riderId).length, 0, 'customers only');
  W.db.prepare('UPDATE customers SET promo_opt_in=1 WHERE user_id=?').run(otherId);
  await W.call('POST', '/api/restaurant/status', { open: false }, W.owner);
  assert.equal(messageFor(W.db, { id: otherId, name: 'Ravi' }, day3(13), 'lunch'), null, 'kitchen closed: nothing to suggest');
  sendDaily(W.db, day3(13, 50)); assert.equal(daily(otherId).length, 0, 'kitchen closed: nothing sent');
  await W.call('POST', '/api/restaurant/status', { open: true }, W.owner);
  await W.call('PUT', '/api/admin/settings', { settings: { daily_notify_enabled: '0' } }, W.admin);
  assert.equal(sendDaily(W.db, day3(13, 50)), 0, 'switched off');
  await W.call('PUT', '/api/admin/settings', { settings: { daily_notify_enabled: '1' } }, W.admin);
  sendDaily(W.db, day3(13, 50)); assert.equal(daily(otherId).length, 1, 'on again');
  const st = (await W.call('GET', '/api/admin/auto-messages', null, W.admin)).body; assert.equal(st.enabled, true); assert.equal(st.per_day, 3);
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
