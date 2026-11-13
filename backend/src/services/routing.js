// Road distance between two points, from a self-hosted OSRM routing engine (no paid API, no public demo server).
// Results are cached by the exact coordinates of both points, so a moved restaurant or address always gets a fresh lookup.
// Never invents a distance: if the engine is not configured, unreachable or finds no route, the caller gets null + a reason.
import { config } from '../config.js';
import { getSetting } from './core.js';

const okPoint = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);
const r6 = (v) => Number(v).toFixed(6);                                     // ~0.1 m: the key changes whenever a point moves
export const cacheKey = (provider, a, b) => `${provider}|${r6(a.lat)},${r6(a.lng)}|${r6(b.lat)},${r6(b.lng)}`;

// OSRM HTTP API: GET {base}/route/v1/{profile}/{lng,lat};{lng,lat}?overview=false  -> routes[0].distance (metres)
async function osrm(from, to) {
  if (!config.routing.osrmUrl) return { error: 'not_configured' };
  const url = `${config.routing.osrmUrl.replace(/\/$/, '')}/route/v1/${config.routing.profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false&steps=false`;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), config.routing.timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json', ...(config.routing.apiKey && { 'X-Routing-Key': config.routing.apiKey }) } });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.code !== 'Ok' || !j.routes?.length) return { error: j?.code === 'NoRoute' ? 'no_route' : `router_error_${r.status}` };
    const d = Number(j.routes[0].distance); if (!Number.isFinite(d) || d < 0) return { error: 'bad_response' };
    return { distance_m: d, duration_s: Number(j.routes[0].duration) || null };
  } catch (e) { return { error: e.name === 'AbortError' ? 'timeout' : 'unreachable' }; }
  finally { clearTimeout(t); }
}

let router = osrm;                       // tests replace this with a mock (setRouter); production always uses OSRM
export const setRouter = (fn) => { router = fn || osrm; };
export const providerName = () => (router === osrm ? (config.routing.osrmUrl ? 'osrm' : 'none') : 'mock');

// Returns { distance_m, source: 'cache' | provider } or { distance_m: null, reason }.
export async function roadDistance(db, from, to) {
  if (!okPoint(from)) return { distance_m: null, reason: 'restaurant_has_no_pickup_point' };
  if (!okPoint(to)) return { distance_m: null, reason: 'invalid_delivery_point' };
  const provider = providerName(); if (provider === 'none') return { distance_m: null, reason: 'routing_not_configured' };
  // the engine's address is part of the key: pointing OSRM_URL at another engine (or new map data on another host) never reuses old distances
  const key = cacheKey(provider === 'osrm' ? `osrm@${config.routing.osrmUrl}` : provider, from, to), days = Number(getSetting(db, 'route_cache_days')) || 30;
  const hit = db.prepare('SELECT distance_m, created_at FROM route_cache WHERE cache_key=?').get(key);
  if (hit && Date.now() - Date.parse(hit.created_at) < days * 864e5) return { distance_m: hit.distance_m, source: 'cache' };
  const out = await router(from, to);
  if (out.error) return { distance_m: null, reason: out.error };
  db.prepare('INSERT INTO route_cache (cache_key, provider, distance_m, duration_s, created_at) VALUES (?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET distance_m=excluded.distance_m, duration_s=excluded.duration_s, created_at=excluded.created_at')
    .run(key, provider, out.distance_m, out.duration_s ?? null, new Date().toISOString());
  return { distance_m: out.distance_m, source: provider };
}
export const purgeRouteCache = (db) => db.prepare('DELETE FROM route_cache WHERE created_at < ?').run(new Date(Date.now() - (Number(getSetting(db, 'route_cache_days')) || 30) * 864e5).toISOString()).changes;
export const clearRouteCache = (db) => db.prepare('DELETE FROM route_cache').run().changes;
