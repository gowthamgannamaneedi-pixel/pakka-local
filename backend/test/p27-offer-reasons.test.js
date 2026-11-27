// "Not now" on a delivery offer needs a reason; admin sees accepted / turned-down counts with reasons, is alerted when a
// partner keeps turning offers down and when every online partner has turned an order down, can offer it again, and can
// suspend a partner for a set number of days (the suspension ends on its own).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, PW } from './helpers/world.js';

const W = await makeWorld('9527');
test.after(() => W.close());
const set = (s) => W.call('PUT', '/api/admin/settings', { settings: s }, W.admin);
const newOrder = async () => { const r = await W.call('POST', '/api/customer/orders', W.cart(), W.cust); assert.equal(r.status, 201, JSON.stringify(r.body));
  await W.call('POST', `/api/customer/payments/sandbox/${r.body.order_code}/complete`, { outcome: 'success' }, W.cust);
  const o = W.db.prepare('SELECT * FROM orders WHERE order_code=?').get(r.body.order_code); await W.call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, W.owner); return o; };
const adminNotes = (like) => W.db.prepare("SELECT title, body FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.role='admin' AND n.title LIKE ? ORDER BY n.id").all(like);
const dismiss = (o, body) => W.call('POST', `/api/rider/orders/${o.id}/dismiss`, body, W.rider);

test('Not now: a valid reason is required ("Other" needs words); it is stored with the offer and the offer disappears', async () => {
  const o = await newOrder();
  assert.equal((await dismiss(o, { reason: 'nope' })).status, 400);
  assert.equal((await dismiss(o, { reason: 'other' })).status, 400, 'Other without details');
  assert.equal((await dismiss(o, { reason: 'too_far', note: 'across the lake' })).status, 200);
  assert.equal(W.db.prepare('SELECT reason FROM rider_assignments WHERE order_id=? AND rider_id=?').pluck().get(o.id, W.riderId), 'Too far (across the lake)');
  assert.ok(!(await W.call('GET', '/api/rider/offers', null, W.rider)).body.offers.some((x) => x.id === o.id));
  // only partner online turned it down: admin is told nobody is left, then offers it again and the partner sees it again
  assert.equal(adminNotes(`No delivery partner for ${o.order_code}%`).length, 1);
  const r = await W.call('POST', `/api/admin/orders/${o.id}/reoffer`, {}, W.admin); assert.equal(r.status, 200); assert.equal(r.body.riders, 1);
  assert.ok((await W.call('GET', '/api/rider/offers', null, W.rider)).body.offers.some((x) => x.id === o.id), 'offered again');
  assert.ok(W.db.prepare('SELECT reason FROM rider_assignments WHERE order_id=?').pluck().get(o.id), 'reason kept on record');
  // the Reject button on the phone's ringing alert sends no reason: recorded as such
  assert.equal((await dismiss(o, undefined)).status, 200);
  assert.match(W.db.prepare('SELECT reason FROM rider_assignments WHERE order_id=? AND rider_id=?').pluck().get(o.id, W.riderId), /ringing alert/);
});

test('admin is alerted at every 3rd turn-down in a day and sees accepted / turned-down counts with reasons', async () => {
  // the order turned down twice above counts once (same offer); two more orders make 3 today
  const o2 = await newOrder(); await dismiss(o2, { reason: 'low_pay' }); const o4 = await newOrder(); await dismiss(o4, { reason: 'busy' });
  const alerts = adminNotes('%turned down 3 offers today'); assert.equal(alerts.length, 1); assert.match(alerts[0].body, /Accepted 0, turned down 3/);
  const o3 = await newOrder(); assert.equal((await W.call('POST', `/api/rider/orders/${o3.id}/accept`, {}, W.rider)).status, 200);
  const a = (await W.call('GET', `/api/admin/riders/${W.riderId}`, null, W.admin)).body.application.offers;
  assert.deepEqual(a.today, { accepted: 1, rejected: 3 }); assert.equal(a.week.rejected, 3);
  assert.ok(a.reasons.some((x) => x.reason === 'Busy with another order') && a.reasons.some((x) => x.reason === 'Payout too low'));
  assert.equal(a.recent.length, 3);
  assert.equal((await set({ rider_reject_alert: '0' })).status, 400);
});

test('suspend for 2 days: partner goes offline with an end time, cannot take offers, and is restored automatically when it ends', async () => {
  const bad = await W.call('POST', `/api/admin/riders/${W.riderId}/verify`, { action: 'suspend', note: 'Too many turn-downs', days: 99, reauth_password: PW }, W.admin); assert.equal(bad.status, 400);
  const r = await W.call('POST', `/api/admin/riders/${W.riderId}/verify`, { action: 'suspend', note: 'Too many turn-downs', days: 2, reauth_password: PW }, W.admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const me = (await W.call('GET', '/api/rider/me', null, W.rider)).body.rider; assert.equal(me.verification_status, 'suspended');
  const hours = (Date.parse(me.suspended_until) - Date.now()) / 3600_000; assert.ok(hours > 47 && hours <= 48, String(hours));
  assert.match(me.decision_note, /suspended for 2 days/);
  const { endSuspensions } = await import('../src/services/core.js');
  assert.equal(endSuspensions(W.db), 0, 'not yet');
  W.db.prepare('UPDATE riders SET suspended_until=? WHERE user_id=?').run(new Date(Date.now() - 1000).toISOString(), W.riderId);
  assert.equal(endSuspensions(W.db), 1);
  const after = (await W.call('GET', '/api/rider/me', null, W.rider)).body.rider; assert.equal(after.verification_status, 'approved'); assert.equal(after.suspended_until, null);
  assert.equal(W.db.prepare("SELECT action FROM rider_verification_history WHERE rider_id=? ORDER BY id DESC LIMIT 1").pluck().get(W.riderId), 'suspension_ended');
});
