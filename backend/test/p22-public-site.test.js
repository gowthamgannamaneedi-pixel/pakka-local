// Public website (payment-gateway website check): home page with business name, dish prices, contact details and policy pages, no login.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { makeWorld } from './helpers/world.js';
import { siteRoutes, BUSINESS } from '../src/routes/site.js';

const W = await makeWorld('9630');
const app = express(); app.use(siteRoutes(W.db)); const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
test.after(() => { srv.close(); W.close(); });
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, html: await r.text() }; };

test('home shows the business name, menu prices (with markup, never the markup itself) and contact details', async () => {
  const { status, html } = await get('/');
  assert.equal(status, 200);
  assert.match(html, /<h1>Pakka Local<\/h1>/);
  assert.match(html, /Test Kitchen/); assert.match(html, /Biryani/);
  assert.match(html, /₹160</, 'base ₹140 + restaurant markup ₹20 = menu price ₹160');
  assert.doesNotMatch(html, /markup/i); assert.doesNotMatch(html, /₹140</);
  assert.ok(html.includes(BUSINESS.phone)); assert.ok(html.includes('care@pakkalocal.online'));
  for (const p of ['/terms', '/privacy', '/refund-policy', '/delivery-policy', '/contact']) assert.ok(html.includes(`href="${p}"`), p);
});

test('policy and contact pages are public and carry the contact details', async () => {
  for (const p of ['/terms', '/privacy', '/refund-policy', '/delivery-policy', '/contact']) {
    const { status, html } = await get(p); assert.equal(status, 200, p); assert.ok(html.includes(BUSINESS.phone), p); assert.ok(html.includes(BUSINESS.email), p);
  }
  assert.match((await get('/refund-policy')).html, /cannot cancel an order themselves/);
  assert.match((await get('/terms')).html, /cash on delivery is not available/);
});

test('hidden or unapproved restaurants and unavailable dishes are not listed', async () => {
  await W.call('POST', '/api/restaurant/menu', { name: 'Secret Soup', base_price_paise: 9000, prep_time_min: 10, available: false }, W.owner);
  W.db.prepare("INSERT INTO restaurants (name, approved, admin_visible) VALUES ('Hidden Place', 1, 0)").run();
  const { html } = await get('/'); assert.doesNotMatch(html, /Secret Soup/); assert.doesNotMatch(html, /Hidden Place/);
});
