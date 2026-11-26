// Live weather for the service area, used only to set the customer app's look (rain effect, hot-day picks...).
// Fetched by the server for the area centre, cached for 15 minutes, so every visitor shares one lookup and no key ever
// reaches the browser. Provider: OpenWeatherMap when WEATHER_API_KEY is set (free plan), otherwise Open-Meteo (no key;
// free for non-commercial use, fine for testing). Any failure simply means "no weather" and the app looks normal.
import { config } from '../config.js';
import { serviceArea } from './core.js';

const TTL = 15 * 60 * 1000, FALLBACK = { lat: 17.33814, lng: 78.3131 };      // Himayatnagar X Road
let cache = { at: 0, key: '', data: null }, inflight = null;

// one simple set of conditions for the app: clear, clouds, fog, drizzle, rain, storm
const fromWmo = (c) => (c >= 95 ? 'storm' : c >= 80 ? 'rain' : c >= 61 ? 'rain' : c >= 51 ? 'drizzle' : c >= 45 ? 'fog' : c >= 2 ? 'clouds' : 'clear');
const fromOwm = (id) => (id >= 200 && id < 300 ? 'storm' : id < 400 ? 'drizzle' : id < 600 ? 'rain' : id < 700 ? 'clouds' : id < 800 ? 'fog' : id === 800 ? 'clear' : 'clouds');

async function fetchJson(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'PakkaLocal/1.0' } }); if (!r.ok) throw new Error('weather ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

async function lookup(lat, lng) {
  if (config.weather.key) {
    const d = await fetchJson(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&units=metric&appid=${encodeURIComponent(config.weather.key)}`);
    const w = d.weather?.[0] || {};
    return { condition: fromOwm(Number(w.id)), temp_c: Math.round(d.main?.temp), is_day: String(w.icon || '').endsWith('d'), source: 'openweathermap' };
  }
  const d = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,is_day&timezone=Asia%2FKolkata`);
  const c = d.current || {};
  return { condition: fromWmo(Number(c.weather_code)), temp_c: Math.round(c.temperature_2m), is_day: c.is_day === 1, source: 'open-meteo' };
}

export async function currentWeather(db) {
  if (config.isTest || config.weather.off) return null;
  const a = serviceArea(db) || FALLBACK, lat = Number(a.lat).toFixed(3), lng = Number(a.lng).toFixed(3), key = `${lat},${lng}`;
  if (cache.key === key && Date.now() - cache.at < TTL) return cache.data;
  if (!inflight) inflight = lookup(lat, lng).then((data) => { cache = { at: Date.now(), key, data }; return data; })
    .catch(() => { cache = { at: Date.now() - TTL + 120000, key, data: null }; return null; })      // failed: try again in 2 minutes
    .finally(() => { inflight = null; });
  return inflight;
}
