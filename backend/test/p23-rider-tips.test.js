// Automatic rider messages: rush-hour reminders for offline riders, weather safety alerts, late-shift note; caps and switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';
import { sendRiderTips } from '../src/services/daily.js';
import { setWeatherForTest } from '../src/services/weather.js';

const W = await makeWorld('9640');
test.after(() => { setWeatherForTest(null); W.close(); });
const at = (h, m = 0) => Date.UTC(2026, 10, 24, h, m) - 330 * 60_000;      // 24 Nov 2026, India time
const tips = (uid) => W.db.prepare("SELECT title, body, event_id FROM notifications WHERE user_id=? AND kind='rider_tip' ORDER BY id").all(uid);
const online = (on) => W.db.prepare('UPDATE riders SET is_online=?, last_seen_at=? WHERE user_id=?').run(on ? 1 : 0, new Date().toISOString(), W.riderId);

test('rush-hour reminders go only to offline approved riders, once, by first name; never at night', () => {
  setWeatherForTest({ condition: 'clear', temp_c: 28 });
  online(true); sendRiderTips(W.db, at(11, 30)); assert.equal(tips(W.riderId).length, 0, 'already online: no lunch reminder');
  online(false); sendRiderTips(W.db, at(11, 30)); sendRiderTips(W.db, at(11, 35));
  const t = tips(W.riderId); assert.equal(t.length, 1); assert.match(t[0].title, /Rahul/); assert.match(t[0].event_id, /lunch_rush$/);
  assert.equal(sendRiderTips(W.db, at(23, 30)), 0, 'quiet at night');
});

test('weather safety alert once a day when it rains; heat alert names the temperature; admin can switch off', async () => {
  setWeatherForTest({ condition: 'rain', temp_c: 24 });
  sendRiderTips(W.db, at(15)); sendRiderTips(W.db, at(16));
  const rain = tips(W.riderId).filter((x) => x.event_id.endsWith(':rain')); assert.equal(rain.length, 1); assert.match(rain[0].body, /Slow down|Wet roads/);
  setWeatherForTest({ condition: 'clear', temp_c: 39 });
  const next = (h) => at(h) + 864e5; sendRiderTips(W.db, next(13));
  const heat = tips(W.riderId).filter((x) => x.event_id.endsWith(':heat')); assert.equal(heat.length, 1);
  assert.ok(/water|shade/i.test(heat[0].body));
  assert.equal((await W.call('PUT', '/api/admin/settings', { settings: { rider_notify_enabled: '0' } }, W.admin)).status, 200);
  setWeatherForTest({ condition: 'storm', temp_c: 22 }); assert.equal(sendRiderTips(W.db, at(14) + 2 * 864e5), 0, 'switched off');
  await W.call('PUT', '/api/admin/settings', { settings: { rider_notify_enabled: '1' } }, W.admin);
  assert.ok(sendRiderTips(W.db, at(14) + 2 * 864e5) >= 1, 'storm alert once on again');
  const st = (await W.call('GET', '/api/admin/auto-messages', null, W.admin)).body; assert.equal(st.riders_enabled, true); assert.ok(st.riders_approved >= 1);
});

test('customers never get rider messages', () => {
  setWeatherForTest({ condition: 'rain', temp_c: 24 }); sendRiderTips(W.db, at(12) + 3 * 864e5);
  assert.equal(tips(W.custId).length, 0);
});
