// Service area: orders only to delivery points within the radius of the centre (Fiza Restaurant, Himayatnagar X Road, 10 km).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';

const W = await makeWorld('9620');
test.after(() => W.close());
const place = async (name, lat, lng) => (await W.call('POST', '/api/admin/locations', { name, address: name + ' road', lat, lng, active: true }, W.admin)).body.id;
const area = (s) => W.call('PUT', '/api/admin/settings', { settings: s }, W.admin);

test('inside the radius can order; outside is refused with a clear reason; outside places are hidden', async () => {
  const near = await place('Near Hostel', 17.36, 78.32), far = await place('Far College', 17.45, 78.5);
  assert.equal((await area({ service_center_name: 'Fiza Restaurant, Himayatnagar X Road', service_center_lat: '17.33814', service_center_lng: '78.31310', service_radius_km: '10' })).status, 200);
  const qf = await W.call('POST', '/api/customer/quote', W.cart({ location_id: far, lat: 17.45, lng: 78.5 }), W.cust);
  assert.equal(qf.status, 409); assert.equal(qf.body.code, 'OUTSIDE_AREA'); assert.equal(qf.body.error, 'Sorry, we don’t deliver to this address yet. Please choose a nearby address.');
  const of = await W.call('POST', '/api/customer/orders', W.cart({ location_id: far, lat: 17.45, lng: 78.5 }), W.cust); assert.equal(of.body.code, 'OUTSIDE_AREA', 'cannot place either');
  const qn = await W.call('POST', '/api/customer/quote', W.cart({ location_id: near, lat: 17.36, lng: 78.32 }), W.cust); assert.notEqual(qn.body.code, 'OUTSIDE_AREA');
  const list = (await W.call('GET', '/api/public/locations')).body; const names = list.locations.map((l) => l.name);
  assert.ok(names.includes('Near Hostel')); assert.ok(!names.includes('Far College')); assert.deepEqual(list.service_area, { km: 10, name: 'Fiza Restaurant, Himayatnagar X Road' });
});

test('bad values are refused; an empty radius removes the limit', async () => {
  assert.equal((await area({ service_radius_km: '0' })).status, 400);
  assert.equal((await area({ service_center_lat: '17' })).status, 400);
  assert.equal((await area({ service_radius_km: '' })).status, 200);
  const far = (await W.call('GET', '/api/admin/locations', null, W.admin)).body.locations.find((l) => l.name === 'Far College').id;
  assert.notEqual((await W.call('POST', '/api/customer/quote', W.cart({ location_id: far, lat: 17.45, lng: 78.5 }), W.cust)).body.code, 'OUTSIDE_AREA');
});
