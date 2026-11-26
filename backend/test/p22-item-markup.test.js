// Markup per dish (admin-only): dish markup overrides the restaurant default; set for many dishes at once; never shown to customers or restaurants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';

const W = await makeWorld('9630');
test.after(() => W.close());
const menu = async () => (await W.call('GET', `/api/public/restaurants/${W.rest}/menu`)).body.items;
const price = async (id) => (await menu()).find((i) => i.id === id).price_paise;

test('default markup, then a dish markup (₹250 + ₹20 = ₹270), then back to default; orders charge the same', async () => {
  const base = W.db.prepare('SELECT base_price_paise FROM food_items WHERE id=?').pluck().get(W.item);
  const def = W.db.prepare('SELECT markup_paise FROM restaurants WHERE id=?').pluck().get(W.rest);
  assert.equal(await price(W.item), base + def);
  assert.equal((await W.call('PUT', `/api/admin/restaurants/${W.rest}/markup`, { item_ids: [W.item], markup_paise: 2000 }, W.admin)).status, 200);
  assert.equal(await price(W.item), base + 2000);
  const q = (await W.call('POST', '/api/customer/quote', W.cart(), W.cust)).body; assert.equal(q.items_paise, base + 2000);
  const o = await W.paidOrder(); const row = W.db.prepare('SELECT items_base_paise, markup_paise FROM orders WHERE id=?').get(o.id); assert.deepEqual(row, { items_base_paise: base, markup_paise: 2000 });
  assert.equal((await W.call('PUT', `/api/admin/restaurants/${W.rest}/markup`, { item_ids: [W.item], markup_paise: null }, W.admin)).status, 200);
  assert.equal(await price(W.item), base + def);
  assert.equal((await W.call('PUT', `/api/admin/restaurants/${W.rest}/markup`, { restaurant_default: true, markup_paise: 3000 }, W.admin)).status, 200);
  assert.equal(await price(W.item), base + 3000);
});

test('only admins; customers and restaurants never see markup', async () => {
  assert.equal((await W.call('PUT', `/api/admin/restaurants/${W.rest}/markup`, { item_ids: [W.item], markup_paise: 100 }, W.owner)).status, 403);
  assert.equal((await W.call('GET', `/api/admin/restaurants/${W.rest}/markup`, null, W.cust)).status, 403);
  assert.ok(!/markup/.test(JSON.stringify((await W.call('GET', `/api/public/restaurants/${W.rest}/menu`)).body)));
  assert.ok(!/markup/.test(JSON.stringify((await W.call('GET', '/api/restaurant/menu', null, W.owner)).body)));
  const m = (await W.call('GET', `/api/admin/restaurants/${W.rest}/markup`, null, W.admin)).body; assert.equal(m.restaurant_markup_paise, 3000);
  assert.equal((await W.call('PUT', `/api/admin/restaurants/${W.rest}/markup`, { item_ids: [W.item], markup_paise: -5 }, W.admin)).status, 400);
});
