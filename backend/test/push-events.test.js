// Background notifications: Android (FCM) devices and browsers share one queue; new order events; no duplicates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';
import { setPushSender, dispatchPush } from '../src/services/push.js';
import { recordLocation } from '../src/services/tracking.js';

const W = await makeWorld('9410');
test.after(() => W.close());

test('device tokens: Android tokens are per account, only the owner removes them', async () => {
  const tok = 'fcm-token-' + 'a'.repeat(40);
  assert.equal((await W.call('POST', '/api/push/fcm', { token: tok }, W.rider)).status, 201);
  assert.equal(W.db.prepare("SELECT channel FROM push_subscriptions WHERE endpoint=?").pluck().get(tok), 'fcm');
  assert.equal((await W.call('POST', '/api/push/fcm', { token: 'bad token!' }, W.rider)).status, 400);
  assert.equal((await W.call('POST', '/api/push/fcm', { token: tok })).status, 401, 'signed-out callers cannot register');
  await W.call('POST', '/api/push/fcm/remove', { token: tok }, W.cust);            // someone else cannot remove it
  assert.ok(W.db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint=?').get(tok));
  await W.call('POST', '/api/push/fcm', { token: tok }, W.cust);                    // phone signed in as another account: the token moves to that account
  assert.equal(W.db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint=?').pluck().get(tok), W.custId);
  await W.call('POST', '/api/push/fcm/remove', { token: tok }, W.cust);
  assert.equal(W.db.prepare('SELECT COUNT(*) FROM push_subscriptions WHERE endpoint=?').pluck().get(tok), 0);
});

test('queue: FCM and Web Push devices both get it, a dead token is removed, nothing is sent twice', async () => {
  const sent = [];
  setPushSender(async (sub, payload) => { if (sub.endpoint.includes('dead')) { const e = new Error('gone'); e.statusCode = 410; throw e; } sent.push([sub.channel, JSON.parse(payload).title]); });
  W.db.prepare("INSERT INTO push_subscriptions (user_id,channel,endpoint,keys_json) VALUES (?,'fcm','fcm-live-token-xxxxxxxxxxxxxxxxxxxxxxxx','{}')").run(W.riderId);
  W.db.prepare("INSERT INTO push_subscriptions (user_id,channel,endpoint,keys_json) VALUES (?,'fcm','fcm-dead-token-xxxxxxxxxxxxxxxxxxxxxxxx','{}')").run(W.riderId);
  W.db.prepare("INSERT INTO push_subscriptions (user_id,channel,endpoint,keys_json) VALUES (?,'webpush','https://push.example/abc','{\"p256dh\":\"x\",\"auth\":\"y\"}')").run(W.riderId);
  W.db.prepare("INSERT INTO notifications (event_id,user_id,category,title,body,kind) VALUES ('t:1',?,'transactional','Hello','x','test')").run(W.riderId);
  W.db.prepare("INSERT OR IGNORE INTO notifications (event_id,user_id,category,title,body,kind) VALUES ('t:1',?,'transactional','Hello','x','test')").run(W.riderId);   // same event again
  await dispatchPush(W.db); await dispatchPush(W.db);
  assert.deepEqual(sent.sort(), [['fcm', 'Hello'], ['webpush', 'Hello']]);
  assert.equal(W.db.prepare("SELECT COUNT(*) FROM push_subscriptions WHERE endpoint LIKE 'fcm-dead%'").pluck().get(), 0, 'dead token cleaned up');
  setPushSender(null);
});

test('order events: rider assigned, picked up (customer + restaurant), arriving once', async () => {
  const o = await W.paidOrder();
  await W.call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, W.owner);
  assert.equal((await W.call('POST', `/api/rider/orders/${o.id}/accept`, {}, W.rider)).status, 200);
  assert.equal(W.notes(W.custId, 'Delivery partner assigned').length, 1);
  await W.call('POST', `/api/restaurant/orders/${o.id}/ready`, {}, W.owner);
  const pick = (await W.call('GET', `/api/restaurant/orders/${o.id}`, null, W.owner)).body.order.pickup_otp;
  assert.equal((await W.call('POST', `/api/rider/orders/${o.id}/pickup`, { otp: pick }, W.rider)).status, 200);
  const ownerId = W.db.prepare('SELECT user_id FROM restaurant_users WHERE restaurant_id=?').pluck().get(W.rest);
  assert.equal(W.notes(ownerId, 'restaurant_update').length, 1, 'restaurant told about pickup');
  const d = W.db.prepare('SELECT dest_lat,dest_lng FROM orders WHERE id=?').get(o.id);
  const far = recordLocation(W.db, W.riderId, { lat: d.dest_lat + 0.02, lng: d.dest_lng, accuracy: 10 }, Date.now());
  assert.ok(far.ok); assert.equal(W.notes(W.custId, 'Your order is arriving').length, 0);
  recordLocation(W.db, W.riderId, { lat: d.dest_lat + 0.001, lng: d.dest_lng, accuracy: 10 }, Date.now() + 5000);
  recordLocation(W.db, W.riderId, { lat: d.dest_lat, lng: d.dest_lng, accuracy: 10 }, Date.now() + 10000);
  assert.equal(W.notes(W.custId, 'Your order is arriving').length, 1, 'arriving is sent once');
});
