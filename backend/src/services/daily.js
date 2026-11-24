// One friendly notification a day for every customer, by first name, at a different time each day (between 10:00 and 21:30
// India time, never at night). The text rotates through short food lines and quotes written for Pakka Local, and mentions a
// real dish from a kitchen that is open at that moment when there is one. Goes to every phone/browser the customer has
// allowed notifications on (installed app or not). Admin can switch it off with the setting daily_notify_enabled = 0.
import crypto from 'node:crypto';
import { getSetting, notify } from './core.js';
import { availability } from './hours.js';

const IST = 330 * 60_000, FROM = 10 * 60, TO = 21 * 60 + 30;
const istDay = (t) => new Date(t + IST).toISOString().slice(0, 10);
const istMin = (t) => { const d = new Date(t + IST); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const h = (s) => crypto.createHash('sha256').update(s).digest();
// the customer's time today: spread over the day, different every day, stable for that day
export const slotFor = (uid, day) => FROM + (h(`daily:${uid}:${day}`).readUInt32BE(0) % (TO - FROM));

const MEAL = (m) => (m < 11 * 60 + 30 ? 'breakfast' : m < 15 * 60 ? 'lunch' : m < 18 * 60 ? 'snack' : 'dinner');
const LINES = {
  breakfast: ['Good morning {n}! A hot breakfast makes the whole day better.', 'Rise and shine, {n}! Idli, dosa or poha? Breakfast is one tap away.', 'Morning {n}! Skip the queue, we’ll bring breakfast to you.'],
  lunch: ['Lunch o’clock, {n}! What are you craving today?', '{n}, a good lunch is the best part of the day. Your favourites are cooking nearby.', 'Hungry, {n}? Fresh lunch from local kitchens, delivered hot.'],
  snack: ['Chai time, {n}? Something crispy goes perfectly with it.', '{n}, a little evening snack never hurt anyone.', 'Evening cravings, {n}? Samosa, momos or a cool shake?'],
  dinner: ['Dinner plans, {n}? Let the local kitchens cook tonight.', '{n}, end the day with something tasty. Dinner is just a tap away.', 'Long day, {n}? Put your feet up, we’ll bring dinner.'],
};
const QUOTES = ['Good food, good mood.', 'Life is short. Eat the biryani.', 'Happiness is a plate of hot food.', 'Eat well, study well, sleep well.', 'The best memories are made around food.',
  'First we eat, then we do everything else.', 'Home-style taste, delivered to your door.', 'Every great day starts with a great meal.'];
const TITLES = { breakfast: 'Breakfast time', lunch: 'Lunch is ready when you are', snack: 'Snack break', dinner: 'What’s for dinner?' };
const pick = (arr, seed) => arr[h(seed).readUInt32BE(4) % arr.length];

// one dish from a kitchen open right now (so the suggestion is real), varied per customer and day
function openDish(db, seed) {
  const open = db.prepare("SELECT r.id, r.name FROM restaurants r WHERE r.approved=1 AND r.admin_visible=1").all().filter((r) => availability(db, r.id).open);
  if (!open.length) return null;
  const r = pick(open, seed + ':r');
  const dishes = db.prepare('SELECT name FROM food_items WHERE restaurant_id=? AND deleted=0 AND available=1').pluck().all(r.id);
  return dishes.length ? { restaurant: r.name, id: r.id, dish: pick(dishes, seed + ':d') } : null;
}

export function messageFor(db, user, now = Date.now()) {
  const day = istDay(now), seed = `${user.id}:${day}`, n = String(user.name || '').trim().split(/\s+/)[0] || 'there', meal = MEAL(istMin(now));
  const d = openDish(db, seed);
  const line = pick(LINES[meal], seed).replace('{n}', n);
  const body = d ? `${line} ${d.dish} from ${d.restaurant} is ready to order. ${pick(QUOTES, seed + ':q')}` : `${line} ${pick(QUOTES, seed + ':q')}`;
  return { title: `${TITLES[meal]}, ${n}!`, body: body.slice(0, 220), link: d ? `/user/#/r/${d.id}` : '/user/#/home' };
}

// run often (every few minutes): sends today's message to each customer whose time has come and who has not had it yet
export function sendDaily(db, now = Date.now()) {
  if (getSetting(db, 'daily_notify_enabled') === '0') return 0;
  const day = istDay(now), m = istMin(now);
  if (m < FROM) return 0;
  let n = 0;
  const due = db.prepare(`SELECT u.id, u.name FROM users u WHERE u.role='customer' AND u.active=1
      AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id=u.id)
      AND NOT EXISTS (SELECT 1 FROM notifications x WHERE x.event_id = 'daily:' || u.id || ':' || ?)`).all(day);
  for (const u of due) {
    if (slotFor(u.id, day) > m) continue;
    const msg = messageFor(db, u, now);
    notify(db, u.id, 'promotional', msg.title, msg.body, msg.link, null, `daily:${u.id}:${day}`, 'daily');
    n++;
  }
  return n;
}
