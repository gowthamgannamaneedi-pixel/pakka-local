// Handwritten list: notifications marked read when opened, offer banner, mandatory restaurant location, distance estimates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, PW } from './helpers/world.js';
import crypto from 'node:crypto';
import { config } from '../src/config.js';
const clickToken = (nid) => crypto.createHmac('sha256', config.jwtSecret).update(`click:${nid}`).digest('hex').slice(0, 24);      // same signature the server puts in each push

const W = await makeWorld('9460');
test.after(() => W.close());
const note = (uid, kind = 'transactional', title = 'Hello') => W.db.prepare("INSERT INTO notifications (event_id,user_id,category,title,body,kind) VALUES (?,?,?,?,'x',?)").run(`t:${Math.random()}`, uid, kind === 'promo' ? 'promotional' : 'transactional', title, kind).lastInsertRowid;

test('opening one notification marks only that one read; nobody can mark someone else’s', async () => {
  const a = note(W.custId), b = note(W.custId), other = note(W.riderId);
  const before = (await W.call('GET', '/api/push/inbox', null, W.cust)).body.unread;
  const r = await W.call('POST', `/api/push/inbox/${a}/read`, null, W.cust);
  assert.equal(r.status, 200); assert.equal(r.body.unread, before - 1);
  assert.ok(W.db.prepare('SELECT read_at FROM notifications WHERE id=?').pluck().get(a)); assert.equal(W.db.prepare('SELECT read_at FROM notifications WHERE id=?').pluck().get(b), null);
  assert.equal((await W.call('POST', `/api/push/inbox/${other}/read`, null, W.cust)).status, 404, 'not yours');
  assert.equal(W.db.prepare('SELECT read_at FROM notifications WHERE id=?').pluck().get(other), null);
  assert.ok((await W.call('GET', '/api/push/inbox', null, W.cust)).body.notifications[0].event_id, 'event id listed (app de-duplicates with it)');
});

test('tapping a phone notification marks it read too (signed token only)', async () => {
  const id = note(W.custId);
  assert.equal((await W.raw('POST', '/api/push/click', { nid: id, t: 'forged' })).status, 400);
  assert.equal(W.db.prepare('SELECT read_at FROM notifications WHERE id=?').pluck().get(id), null);
  assert.equal((await W.raw('POST', '/api/push/click', { nid: id, t: clickToken(id) })).status, 200);
  assert.ok(W.db.prepare('SELECT read_at FROM notifications WHERE id=?').pluck().get(id));
});

test('offer banner: latest unread offer only; gone once opened or dismissed', async () => {
  assert.equal((await W.call('GET', '/api/push/banner', null, W.cust)).body.banner, null);
  note(W.custId, 'promo', 'Old offer'); const id = note(W.custId, 'promo', '20% off today');
  const b = (await W.call('GET', '/api/push/banner', null, W.cust)).body.banner; assert.equal(b.id, id); assert.equal(b.title, '20% off today');
  assert.equal(b.image, null, 'no picture unless the admin added one to the offer');
  const cid = W.db.prepare("INSERT INTO campaigns (title,body,audience_type,status,image_path,created_by) VALUES ('Pic offer','b','customers','completed','offer.png',1)").run().lastInsertRowid;
  const pid = W.db.prepare("INSERT INTO notifications (event_id,user_id,category,title,body,kind,campaign_id) VALUES (?,?,'promotional','Pic offer','b','promo',?)").run(`t:${Math.random()}`, W.custId, cid).lastInsertRowid;
  assert.equal((await W.call('GET', '/api/push/banner', null, W.cust)).body.banner.image, '/api/files/public/offer.png', 'offer picture included');
  await W.call('POST', `/api/push/inbox/${pid}/read`, null, W.cust);
  await W.call('POST', `/api/push/inbox/${id}/read`, null, W.cust);
  assert.equal((await W.call('GET', '/api/push/banner', null, W.cust)).body.banner.title, 'Old offer');
  assert.equal((await W.call('GET', '/api/push/banner', null, W.rider)).body.banner, null, 'only your own');
});

test('restaurant location: required to open, validated, GPS needs accuracy, audited, own restaurant only', async () => {
  const rid = (await W.call('POST', '/api/admin/restaurants', { name: 'No Pin Kitchen', commission_bps: 1000, markup_paise: 0, admin_visible: true, approved: true }, W.admin)).body.id;
  await W.call('POST', '/api/admin/users', { role: 'restaurant', name: 'Owner2', phone: W.ph(111), password: PW, restaurant_id: rid }, W.admin);
  const o2 = await W.staff('restaurant', W.ph(111));
  const open = await W.call('POST', '/api/restaurant/status', { open: true }, o2); assert.equal(open.status, 409); assert.equal(open.body.code, 'LOCATION_REQUIRED');
  const put = (b) => W.call('PUT', '/api/restaurant/location', b, o2);
  assert.equal((await put({ lat: 0, lng: 0, source: 'manual' })).status, 400);
  assert.equal((await put({ lat: 78.48, lng: 17.38, source: 'manual' })).status, 400, 'swapped lat/lng caught (outside India)');
  assert.equal((await put({ lat: 17.38, lng: 78.48, source: 'gps' })).status, 400, 'GPS without accuracy refused');
  assert.equal((await put({ lat: 17.38, lng: 78.48, source: 'gps', accuracy_m: 900 })).body.code, 'LOW_ACCURACY');
  const ok = await put({ lat: 17.3812345, lng: 78.4812345, source: 'gps', accuracy_m: 25 }); assert.equal(ok.status, 200); assert.deepEqual(ok.body.location, { lat: 17.381235, lng: 78.481235 });
  assert.equal((await W.call('GET', '/api/restaurant/me', null, o2)).body.restaurant.pickup_lat, 17.381235);
  assert.equal((await W.call('POST', '/api/restaurant/status', { open: true }, o2)).status, 200, 'opens once the location is set');
  assert.ok(W.db.prepare("SELECT 1 FROM audit_logs WHERE action='restaurant.location' AND target_id=?").get(String(rid)), 'audited');
  assert.equal(W.db.prepare('SELECT pickup_lat FROM restaurants WHERE id=?').pluck().get(W.rest), 17.385, 'other restaurant untouched');
  assert.equal((await W.call('PUT', '/api/restaurant/location', { lat: 17.3, lng: 78.4, source: 'manual' }, W.cust)).status, 403);
});

test('distance and estimate: from the restaurant location to the delivery point; straight line labelled, never invented', async () => {
  const q = (await W.call('POST', '/api/customer/quote', W.cart(), W.cust)).body;
  assert.equal(typeof q.trip_km, 'number'); assert.equal(q.trip_by_road, false, 'no routing service in tests: straight line, labelled');
  const a = W.db.prepare('SELECT lat,lng FROM delivery_locations WHERE id=?').get(W.loc);
  if (a.lat != null) assert.ok(q.trip_km >= 0);
  assert.ok(q.delivery_min >= 4);
  W.db.prepare('UPDATE restaurants SET pickup_lat=NULL, pickup_lng=NULL WHERE id=?').run(W.rest);
  const none = await W.call('POST', '/api/customer/quote', W.cart(), W.cust); assert.equal(none.status, 409); assert.equal(none.body.reason, 'no_location', 'no restaurant location: no order and no invented distance');
  W.db.prepare('UPDATE restaurants SET pickup_lat=17.385, pickup_lng=78.4867 WHERE id=?').run(W.rest);
  const list = (await W.call('GET', '/api/public/restaurants')).body.restaurants.find((x) => x.id === W.rest);
  assert.equal(list.lat, 17.385); assert.equal(list.lng, 78.4867);
});
