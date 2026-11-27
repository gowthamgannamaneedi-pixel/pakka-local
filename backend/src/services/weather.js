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

// one point -> { cond, temp, day, clouds, vis_km }; cond is one of clear, clouds, haze, fog, rain, storm.
// Decided from the real readings, in this order: storm, real rain (>= 0.3 mm or a rain reading), real fog (visibility
// under 1 km), mostly covered sky (>= 80 % cloud = cloudy, even if the provider also says "haze"), haze/dust/smoke with
// fair visibility, partly cloudy (>= 60 %), otherwise clear.
export function classify({ storm, rainMm, rainCode, visKm, clouds, hazeCode }) {
  if (storm) return 'storm';
  if (rainMm >= WET_MM || rainCode) return 'rain';
  if (Number.isFinite(visKm) && visKm < 1) return 'fog';
  if (clouds >= 80) return 'clouds';
  if (hazeCode) return 'haze';
  if (clouds >= 60) return 'clouds';
  return 'clear';
}
async function point(lat, lng) {
  if (config.weather.key) { try { return await owm(lat, lng); } catch { /* key not active yet or limit reached: use Open-Meteo for now */ } }
  return openMeteo(lat, lng);
}
async function owm(lat, lng) {
  const d = await fetchJson(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&units=metric&appid=${encodeURIComponent(config.weather.key)}`);
  const w = d.weather?.[0] || {}, id = Number(w.id), mm = Number(d.rain?.['1h'] ?? 0), clouds = Number(d.clouds?.all ?? 0), visKm = d.visibility != null ? Number(d.visibility) / 1000 : NaN;
  const cond = classify({ storm: id >= 200 && id < 300, rainMm: mm, rainCode: id >= 501 && id < 600, visKm, clouds, hazeCode: id >= 700 && id < 800 });
  return { cond, temp: d.main?.temp, day: String(w.icon || '').endsWith('d'), clouds, vis_km: visKm, src: 'openweathermap' };
}
async function openMeteo(lat, lng) {
  const d = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,is_day,precipitation,cloud_cover,visibility&timezone=Asia%2FKolkata`);
  const c = d.current || {}, code = Number(c.weather_code), clouds = Number(c.cloud_cover ?? 0), visKm = c.visibility != null ? Number(c.visibility) / 1000 : NaN;
  const cond = classify({ storm: code >= 95, rainMm: Number(c.precipitation || 0), rainCode: code >= 61 && code < 95, visKm, clouds, hazeCode: code === 45 || code === 48 });
  return { cond, temp: c.temperature_2m, day: c.is_day === 1, clouds, vis_km: visKm, src: 'open-meteo' };
}

// the centre plus 4 points ~5 km away (kept inside the radius)
const pointsFor = (a) => { const km = Math.min(5, (Number(a.km) || 7) * 0.7), dLat = km / 111, dLng = km / (111 * Math.cos((a.lat * Math.PI) / 180));
  return [[0, 0], [dLat, 0], [-dLat, 0], [0, dLng], [0, -dLng]].map(([y, x]) => [(a.lat + y).toFixed(3), (a.lng + x).toFixed(3)]); };

async function lookup(a) {
  const res = (await Promise.allSettled(pointsFor(a).map(([la, ln]) => point(la, ln)))).filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!res.length) throw new Error('no weather');
  const n = (c) => res.filter((r) => r.cond === c).length, wet = n('rain') + n('storm');
  // the area's weather = what most points say (rain or storm already when 2 of 5 points really have it)
  const condition = n('storm') >= 2 ? 'storm' : wet >= 2 ? 'rain' : n('fog') >= 3 ? 'fog' : n('clouds') >= 3 ? 'clouds' : n('haze') + n('fog') >= 3 ? 'haze' : n('clouds') + n('haze') + n('fog') >= 3 ? 'clouds' : 'clear';
  const avg = (k) => { const v = res.map((r) => Number(r[k])).filter(Number.isFinite); return v.length ? Math.round((v.reduce((a2, b) => a2 + b, 0) / v.length) * 10) / 10 : null; };
  const temps = res.map((r) => Number(r.temp)).filter(Number.isFinite);
  return { condition, temp_c: temps.length ? Math.round(temps.reduce((s, x) => s + x, 0) / temps.length) : null, is_day: res[0].day,
    raining_points: wet, points: res.length, cloud_cover: avg('clouds'), visibility_km: avg('vis_km'), source: res.every((r) => r.src === 'openweathermap') ? 'openweathermap' : res.some((r) => r.src === 'openweathermap') ? 'mixed' : 'open-meteo' };
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

// last known weather without waiting (null when older than 30 minutes or never fetched)
export const cachedWeather = () => (cache.data && Date.now() - cache.at < 30 * 60 * 1000 ? cache.data : null);
// tests only: pretend the area has this weather right now
export const setWeatherForTest = (data) => { cache = { at: Date.now(), key: 'test', data }; };
