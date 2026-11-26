// Live weather for the service area, used only to set the customer app's look (rain effect, hot-day picks...).
// The server checks 5 points across the area (the centre and ~5 km north, south, east and west, inside the 7 km circle),
// caches the answer for 15 minutes, and only says "rain" when real rain is falling at 2 or more of them. A trace of
// drizzle that a weather model reports at one point is ignored. No key ever reaches the browser.
// Provider: OpenWeatherMap when WEATHER_API_KEY is set (free plan: 5 calls every 15 min = 480 a day, under the 1,000 limit),
// otherwise Open-Meteo (no key; free for non-commercial use, fine for testing). Any failure = "no weather", normal look.
import { config } from '../config.js';
import { serviceArea } from './core.js';

const TTL = 15 * 60 * 1000, FALLBACK = { lat: 17.33814, lng: 78.3131, km: 7 };      // Himayatnagar X Road
const WET_MM = 0.3;      // at least this much rain (mm) before a point counts as raining
let cache = { at: 0, key: '', data: null }, inflight = null;

async function fetchJson(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'PakkaLocal/1.0' } }); if (!r.ok) throw new Error('weather ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

// one point -> { cond, temp, day }; cond is one of clear, clouds, fog, rain, storm
async function point(lat, lng) {
  if (config.weather.key) {
    const d = await fetchJson(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&units=metric&appid=${encodeURIComponent(config.weather.key)}`);
    const w = d.weather?.[0] || {}, id = Number(w.id), mm = Number(d.rain?.['1h'] ?? 0);
    const cond = id >= 200 && id < 300 ? 'storm' : (id >= 500 && id < 600) || (id >= 300 && id < 400 && mm >= WET_MM) ? (mm >= WET_MM || id >= 501 ? 'rain' : 'clouds')
      : id >= 700 && id < 800 ? 'fog' : id === 800 ? 'clear' : 'clouds';
    return { cond, temp: d.main?.temp, day: String(w.icon || '').endsWith('d') };
  }
  const d = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,is_day,precipitation,cloud_cover&timezone=Asia%2FKolkata`);
  const c = d.current || {}, code = Number(c.weather_code), mm = Number(c.precipitation || 0);
  const cond = code >= 95 ? 'storm' : (code >= 61 || mm >= WET_MM) && code >= 51 ? 'rain' : code === 45 || code === 48 ? 'fog' : Number(c.cloud_cover) >= 60 ? 'clouds' : 'clear';      // cloudy by actual cloud cover, not a drizzle blip
  return { cond, temp: c.temperature_2m, day: c.is_day === 1 };
}

// the centre plus 4 points ~5 km away (kept inside the radius)
const pointsFor = (a) => { const km = Math.min(5, (Number(a.km) || 7) * 0.7), dLat = km / 111, dLng = km / (111 * Math.cos((a.lat * Math.PI) / 180));
  return [[0, 0], [dLat, 0], [-dLat, 0], [0, dLng], [0, -dLng]].map(([y, x]) => [(a.lat + y).toFixed(3), (a.lng + x).toFixed(3)]); };

async function lookup(a) {
  const res = (await Promise.allSettled(pointsFor(a).map(([la, ln]) => point(la, ln)))).filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!res.length) throw new Error('no weather');
  const n = (c) => res.filter((r) => r.cond === c).length, wet = n('rain') + n('storm');
  const condition = n('storm') >= 2 ? 'storm' : wet >= 2 ? 'rain' : n('fog') >= 3 ? 'fog' : n('clouds') >= 3 ? 'clouds' : 'clear';
  const temps = res.map((r) => Number(r.temp)).filter(Number.isFinite);
  return { condition, temp_c: temps.length ? Math.round(temps.reduce((s, x) => s + x, 0) / temps.length) : null, is_day: res[0].day,
    raining_points: wet, points: res.length, source: config.weather.key ? 'openweathermap' : 'open-meteo' };
}

export async function currentWeather(db) {
  if (config.isTest || config.weather.off) return null;
  const s = serviceArea(db), a = s ? { lat: Number(s.lat), lng: Number(s.lng), km: Number(s.km) } : FALLBACK, key = `${a.lat.toFixed(3)},${a.lng.toFixed(3)},${a.km}`;
  if (cache.key === key && Date.now() - cache.at < TTL) return cache.data;
  if (!inflight) inflight = lookup(a).then((data) => { cache = { at: Date.now(), key, data }; return data; })
    .catch(() => { cache = { at: Date.now() - TTL + 120000, key, data: null }; return null; })      // failed: try again in 2 minutes
    .finally(() => { inflight = null; });
  return inflight;
}
