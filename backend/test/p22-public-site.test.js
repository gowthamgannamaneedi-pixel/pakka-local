// Public pages for the payment-gateway website check: business name, phone, e-mail and policies without login;
// the customer app gets the business details from /api/public/config (shown in its footer, also to guests).
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { makeWorld } from './helpers/world.js';
import { siteRoutes, BUSINESS } from '../src/routes/site.js';

const W = await makeWorld('9630');
const app = express(); app.use(siteRoutes()); const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
test.after(() => { srv.close(); W.close(); });
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, html: await r.text() }; };

test('contact and policy pages are public and carry the business name, phone and e-mail', async () => {
  for (const p of ['/terms', '/privacy', '/refund-policy', '/delivery-policy', '/contact']) {
    const { status, html } = await get(p); assert.equal(status, 200, p);
    assert.ok(html.includes('Pakka Local'), p); assert.ok(html.includes(BUSINESS.phone), p); assert.ok(html.includes('care@pakkalocal.online'), p);
  }
  assert.match((await get('/refund-policy')).html, /cannot cancel an order themselves/);
  assert.match((await get('/terms')).html, /cash on delivery is not available/);
});

test('public config gives the app the business details; menus and prices are public (guests can browse)', async () => {
  const c = (await W.call('GET', '/api/public/config')).body;
  assert.equal(c.business.name, 'Pakka Local'); assert.equal(c.business.phone, BUSINESS.phone); assert.equal(c.business.email, 'care@pakkalocal.online');
  const m = await W.call('GET', `/api/public/restaurants/${W.rest}/menu`); assert.equal(m.status, 200);
  assert.equal(m.body.items[0].price_paise, 16000); assert.equal(m.body.items[0].markup_paise, undefined);
});
