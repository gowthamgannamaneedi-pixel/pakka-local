// Admin "Import menu": many dishes at once from a pasted list; categories created, duplicates skipped, all-or-nothing on mistakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';

const W = await makeWorld('9540');
test.after(() => W.close());
const url = `/api/admin/restaurants/${W.rest}/menu-import`;
const CSV = `Category,Dish,Price,Diet,Prep_min
Veg Curries,Paneer Butter Masala,170,veg,20
Non Veg Biryanis,Chicken Biryani Single,140,nonveg,25
"Egg Starters & Curries","Egg Curry, Spicy",140,egg,
Rotis & Naan,Butter Naan,35,veg,10`;

test('check counts without writing, then imports with categories, prices, diet and cooking time', async () => {
  const before = W.db.prepare('SELECT COUNT(*) FROM food_items WHERE restaurant_id=?').pluck().get(W.rest);
  const c = await W.call('POST', url, { csv: CSV, check: true }, W.admin);
  assert.equal(c.status, 200); assert.equal(c.body.added, 4); assert.equal(c.body.new_categories.length, 4);
  assert.equal(W.db.prepare('SELECT COUNT(*) FROM food_items WHERE restaurant_id=?').pluck().get(W.rest), before, 'check writes nothing');
  const r = await W.call('POST', url, { csv: CSV }, W.admin); assert.equal(r.status, 200); assert.equal(r.body.added, 4);
  const it = W.db.prepare("SELECT i.*, c.name AS cat FROM food_items i JOIN food_categories c ON c.id=i.category_id WHERE i.restaurant_id=? AND i.name='Egg Curry, Spicy'").get(W.rest);
  assert.equal(it.base_price_paise, 14000); assert.equal(it.diet, 'egg'); assert.equal(it.prep_time_min, 15); assert.equal(it.cat, 'Egg Starters & Curries'); assert.equal(it.image_path, null); assert.equal(it.available, 1);
  const menu = await W.call('GET', `/api/public/restaurants/${W.rest}/menu`);
  assert.ok(JSON.stringify(menu.body).includes('Paneer Butter Masala'), 'customers see imported dishes ' + menu.status + JSON.stringify(menu.body).slice(0, 200));
  assert.ok(W.db.prepare("SELECT 1 FROM audit_logs WHERE action='menu.import'").get(), 'audited');
});

test('importing again skips dishes already on the menu; a bad line stops the whole import; only admins', async () => {
  const again = await W.call('POST', url, { csv: CSV + '\nRice,Curd Rice,100,veg,10' }, W.admin);
  assert.equal(again.body.added, 1); assert.equal(again.body.skipped, 4); assert.equal(again.body.new_categories.length, 1);
  const n = W.db.prepare('SELECT COUNT(*) FROM food_items WHERE restaurant_id=?').pluck().get(W.rest);
  const bad = await W.call('POST', url, { csv: 'Rice,Lemon Rice,90,veg,10\nRice,Jeera Rice,abc,veg,10' }, W.admin);
  assert.equal(bad.status, 400); assert.match(bad.body.error, /Line 2/);
  assert.equal(W.db.prepare('SELECT COUNT(*) FROM food_items WHERE restaurant_id=?').pluck().get(W.rest), n, 'nothing added');
  assert.equal((await W.call('POST', url, { csv: 'Rice,Diet test,90,fish,10' }, W.admin)).status, 400);
  assert.equal((await W.call('POST', url, { csv: CSV }, W.owner)).status, 403);
});
