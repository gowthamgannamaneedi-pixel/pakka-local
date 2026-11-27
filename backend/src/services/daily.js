// Automatic messages that reach customers' phones even when the app is closed (web push / installed app).
// Up to three a day per customer — lunch, evening snack and dinner — each at the customer's own time inside that window,
// plus one rain alert on days it really rains in the service area. Every message names a real dish from a kitchen that is
// open at that moment (nothing is sent while every kitchen is closed), by first name, in short lines that mix plain
// English with light Gen-Z words that still read clearly at any age. Never at night (only 10:00–21:30 India time).
// Only customers who allowed notifications on a device and kept "offers & updates" on. Admin settings:
//   daily_notify_enabled = 0 switches all of it off; notify_per_day = 1, 2 or 3 (default 3); notify_rain = 0 turns off rain alerts.
import crypto from 'node:crypto';
import { getSetting, notify } from './core.js';
import { availability } from './hours.js';
import { cachedWeather, currentWeather } from './weather.js';

const IST = 330 * 60_000, FROM = 10 * 60, TO = 21 * 60 + 30;
const istDay = (t) => new Date(t + IST).toISOString().slice(0, 10);
const istMin = (t) => { const d = new Date(t + IST); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const h = (s) => crypto.createHash('sha256').update(s).digest();
const pick = (arr, seed) => arr[h(seed).readUInt32BE(4) % arr.length];

// the three daily moments (minutes after midnight, India time). A customer's time inside each window is fixed for the day.
export const MOMENTS = [
  { k: 'lunch', from: 11 * 60 + 45, to: 13 * 60 + 30 },
  { k: 'snack', from: 16 * 60 + 30, to: 18 * 60 },
  { k: 'dinner', from: 19 * 60 + 15, to: 21 * 60 },
];
const LATE = 30;      // if the server was down, a moment is still sent up to 30 minutes after its window, never later
export const slotFor = (uid, day, k = 'lunch') => { const w = MOMENTS.find((x) => x.k === k) || MOMENTS[0]; return w.from + (h(`daily:${uid}:${day}:${k}`).readUInt32BE(0) % (w.to - w.from)); };
const momentsFor = (perDay) => (perDay >= 3 ? MOMENTS : perDay === 2 ? [MOMENTS[0], MOMENTS[2]] : [MOMENTS[2]]);

// {n} first name, {dish} a dish on an open menu, {rest} its kitchen
const COPY = {
  lunch: {
    t: ['Lunch o’clock, {n} 🍛', '{n}, your lunch break called', 'Hungry? Say less, {n}', 'Biryani hours, {n} 🔥', 'Main-character lunch, {n}'],
    b: ['{dish} from {rest} is cooking right now. Zero platform fee, no cap.', 'Lowkey craving {dish}? {rest} has it hot and ready.', 'A good lunch fixes most things. Try {dish} from {rest}.',
      '{dish} from {rest} hits different at lunch. Tap to order.', 'Fuel up: {dish} from {rest}. Menu price + delivery, that’s it.'],
  },
  snack: {
    t: ['Chai o’clock, {n} ☕', 'Snack break unlocked, {n}', '5 pm cravings are valid, {n}', '{n}, treat yourself', 'Evening vibe check, {n} ✨'],
    b: ['{dish} from {rest} + your evening = the vibe.', 'Something tasty hits different right now. Try {dish} from {rest}.', 'Small snack, big mood: {dish} from {rest}.',
      'You’ve earned a break. {dish} from {rest} is ready to order.', 'Pick your fighter: {dish} from {rest} is up first.'],
  },
  dinner: {
    t: ['Dinner, sorted, {n} 🌙', 'Skip the dishes tonight, {n}', 'Long day, {n}? We got you', 'Tonight’s plan: eat good, {n}', 'Dinner bell, {n} 🔔'],
    b: ['Let {rest} do the cooking. {dish} is on the menu tonight.', 'It’s giving comfort food: {dish} from {rest}.', 'Feet up. {dish} from {rest} can be at your door soon.',
      '{dish} from {rest}. Hot food, live tracking, zero extra fees.', 'End the day with a W: {dish} from {rest}.'],
  },
  rain: {
    t: ['It’s raining, {n} 🌧️', 'Baarish + hot food = perfect', 'Rain outside, {n}. Stay in.', 'Rainy day plan, {n}: stay dry'],
    b: ['Stay dry. {dish} from {rest} will come to you. Riders may take a few extra minutes.', 'Cosy weather, cosy food: {dish} from {rest}. Allow a little extra time.',
      'Perfect weather for {dish} from {rest}. We deliver carefully in the rain.'],
  },
};

// one dish from a kitchen open right now (so the suggestion is real), varied per customer, day and moment
function openDish(db, seed) {
  const open = db.prepare('SELECT r.id, r.name FROM restaurants r WHERE r.approved=1 AND r.admin_visible=1').all().filter((r) => availability(db, r.id).open);
  if (!open.length) return null;
  const r = pick(open, seed + ':r');
  const dishes = db.prepare('SELECT name FROM food_items WHERE restaurant_id=? AND deleted=0 AND available=1').pluck().all(r.id);
  return dishes.length ? { restaurant: r.name, id: r.id, dish: pick(dishes, seed + ':d') } : null;
}

const momentAt = (m) => (m < 15 * 60 ? 'lunch' : m < 18 * 60 + 30 ? 'snack' : 'dinner');
// the message for one customer and moment; null when no kitchen is open (nothing would be orderable)
export function messageFor(db, user, now = Date.now(), k = momentAt(istMin(now))) {
  const day = istDay(now), seed = `${user.id}:${day}:${k}`, n = String(user.name || '').trim().split(/\s+/)[0] || 'there';
  const d = openDish(db, seed); if (!d) return null;
  const fill = (s) => s.replace('{n}', n).replace('{dish}', d.dish).replace('{rest}', d.restaurant);
  return { title: fill(pick(COPY[k].t, seed + ':t')).slice(0, 80), body: fill(pick(COPY[k].b, seed + ':b')).slice(0, 220), link: `/user/#/r/${d.id}` };
}

const raining = () => { const w = cachedWeather(); return !!w && (w.condition === 'rain' || w.condition === 'storm'); };

// runs every few minutes: sends each due moment once; returns how many were queued
export function sendDaily(db, now = Date.now()) {
  if (getSetting(db, 'daily_notify_enabled') === '0') return 0;
  currentWeather(db).catch(() => {});      // keeps the weather fresh for rain alerts (cached, at most every 15 min)
  const day = istDay(now), m = istMin(now);
  if (m < FROM || m > TO) return 0;
  const perDay = Math.min(3, Math.max(1, Number(getSetting(db, 'notify_per_day')) || 3)), moments = momentsFor(perDay);
  const rainOn = getSetting(db, 'notify_rain') !== '0' && raining();
  const users = db.prepare(`SELECT u.id, u.name FROM users u JOIN customers c ON c.user_id=u.id WHERE u.role='customer' AND u.active=1 AND c.promo_opt_in=1
      AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id=u.id)`).all();
  const sent = db.prepare('SELECT 1 FROM notifications WHERE user_id=? AND event_id=?');
  const recent = db.prepare("SELECT MAX(created_at) FROM notifications WHERE user_id=? AND kind='daily'");
  let n = 0;
  for (const u of users) {
    for (const w of moments) {
      const key = `daily:${u.id}:${day}:${w.k}`;
      if (m < slotFor(u.id, day, w.k) || m > w.to + LATE || sent.get(u.id, key)) continue;
      const msg = messageFor(db, u, now, w.k); if (!msg) continue;      // every kitchen closed: skip this moment
      notify(db, u.id, 'promotional', msg.title, msg.body, msg.link, null, key, 'daily'); n++;
    }
    if (rainOn) {      // one rain alert a day, never within 2 hours of another message
      const key = `daily:${u.id}:${day}:rain`, last = recent.get(u.id);
      if (!sent.get(u.id, key) && (!last || now - Date.parse(last) > 2 * 3600_000)) { const msg = messageFor(db, u, now, 'rain'); if (msg) { notify(db, u.id, 'promotional', msg.title, msg.body, msg.link, null, key, 'daily'); n++; } }
    }
  }
  return n;
}

// for the admin page: what is on and how many went out today
export function autoStatus(db, now = Date.now()) {
  const day = istDay(now);
  return { enabled: getSetting(db, 'daily_notify_enabled') !== '0', per_day: Math.min(3, Math.max(1, Number(getSetting(db, 'notify_per_day')) || 3)), rain: getSetting(db, 'notify_rain') !== '0',
    raining_now: raining(), sent_today: db.prepare("SELECT COUNT(*) FROM notifications WHERE kind='daily' AND event_id LIKE ?").pluck().get(`daily:%:${day}:%`),
    reachable: db.prepare(`SELECT COUNT(*) FROM users u JOIN customers c ON c.user_id=u.id WHERE u.role='customer' AND u.active=1 AND c.promo_opt_in=1 AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id=u.id)`).pluck().get(),
    windows: MOMENTS.map((w) => w.k) };
}
