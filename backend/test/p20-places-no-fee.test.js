// Delivery places need no fixed charge when delivery is priced by distance (the default).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';

const W = await makeWorld('9610');
test.after(() => W.close());

test('a place can be added and imported without a charge; the list says distance pricing is on', async () => {
  const r = await W.call('POST', '/api/admin/locations', { name: 'New Girls Hostel', address: 'Main road, Moinabad', area: 'Moinabad', lat: 17.33, lng: 78.31, active: true }, W.admin);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const g = (await W.call('GET', '/api/admin/locations', null, W.admin)).body; assert.equal(g.fixed_place_fees, false);
  const csv = 'Location_ID,Place_Name,Place_Type,Full_Address,Area\nLOC_900,Test PG,PG,Some street,Aziznagar\n';
  const imp = await W.call('POST', '/api/admin/locations/import', { csv, dry_run: false }, W.admin); assert.equal(imp.status, 200, JSON.stringify(imp.body)); assert.equal(imp.body.created, 1);
});
