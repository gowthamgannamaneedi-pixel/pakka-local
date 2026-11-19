// Road route from the delivery partner to the drop-off, for the live tracking maps and the arrival time.
// Providers: OpenRouteService (ORS_API_KEY, free tier) or a self-hosted OSRM (OSRM_URL). With neither, no route is returned
// and the maps draw no line (a straight line looked like a "random" route, so it is never shown as one).
// Lookups are kept low: one per order until the rider has moved about 150 m away from the stored route or 3 minutes have
// passed, never more often than every 20 s per order, and at most ORS_DAILY_LIMIT lookups a day (ORS free tier: 2,000).
// Between lookups the stored route is trimmed to start at the rider's current position.
import { config } from '../config.js';

const R = 6371000, rad = (x) => (x * Math.PI) / 180;
export const meters = (a, b) => { const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const cache = new Map();                      // orderId -> { to, coords: [[lat,lng]], at, tried }
let day = '', used = 0;

export const routeProvider = () => (config.routing.orsKey ? 'ors' : config.routing.osrmUrl ? 'osrm' : 'none');
let fetcher = null; export const setRouteFetcher = (fn) => { fetcher = fn; cache.clear(); used = 0; };      // tests only

async function lookup(from, to) {
  if (fetcher) return fetcher(from, to);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), config.routing.timeoutMs || 3000);
  try {
    if (config.routing.orsKey) {
      const r = await fetch(`https://api.openrouteservice.org/v2/directions/${config.routing.orsProfile}?start=${from.lng},${from.lat}&end=${to.lng},${to.lat}`,
        { signal: ctl.signal, headers: { Authorization: config.routing.orsKey, Accept: 'application/geo+json' } });
      const j = await r.json().catch(() => null); const f = j?.features?.[0];
      if (!r.ok || !f?.geometry?.coordinates?.length) return null;
      return f.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    }
    const base = config.routing.osrmUrl.replace(/\/$/, '');
    const r = await fetch(`${base}/route/v1/${config.routing.profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`,
      { signal: ctl.signal, headers: { Accept: 'application/json', ...(config.routing.apiKey && { 'X-Routing-Key': config.routing.apiKey }) } });
    const j = await r.json().catch(() => null);
    if (!r.ok || j?.code !== 'Ok' || !j.routes?.[0]?.geometry?.coordinates?.length) return null;
    return j.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  } catch { return null; } finally { clearTimeout(t); }
}

// The part of the route still ahead: from the rider's position to the nearest route point onwards. null if the rider is off it.
function ahead(coords, at) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < coords.length; i++) { const d = meters(at, { lat: coords[i][0], lng: coords[i][1] }); if (d < bd) { bd = d; best = i; } }
  if (bd > 150) return null;
  const rest = [[at.lat, at.lng], ...coords.slice(best + 1)];
  let m = 0; for (let i = 1; i < rest.length; i++) m += meters({ lat: rest[i - 1][0], lng: rest[i - 1][1] }, { lat: rest[i][0], lng: rest[i][1] });
  return { coords: rest, distance_m: Math.round(m) };
}

// Stored route only (no network): used when recalculating the arrival time on each location update.
export function cachedRoute(orderId, at, to) {
  const c = cache.get(orderId); if (!c?.coords || c.to.lat !== to.lat || c.to.lng !== to.lng) return null;
  return ahead(c.coords, at);
}

// Route for the maps: refreshed when needed (see the rules at the top), otherwise trimmed from the stored one.
export async function liveRoute(orderId, at, to, now = Date.now()) {
  if (routeProvider() === 'none' && !fetcher) return null;
  const c = cache.get(orderId), same = c && c.to.lat === to.lat && c.to.lng === to.lng;
  const cur = same && c.coords ? ahead(c.coords, at) : null;
  const due = !same || !cur || now - c.at > 180_000;
  if (due && (!same || now - c.tried > 20_000)) {
    const d = new Date(now).toISOString().slice(0, 10); if (d !== day) { day = d; used = 0; }
    if (used < config.routing.orsDailyLimit || !config.routing.orsKey) {
      used++; const entry = { to, coords: same ? c.coords : null, at: same ? c.at : 0, tried: now }; cache.set(orderId, entry);
      const coords = await lookup(at, to);
      if (coords && coords.length > 1) { entry.coords = coords; entry.at = now; return ahead(coords, at); }
    }
  }
  return cur;
}
export const forgetRoute = (orderId) => cache.delete(orderId);
// drop routes of orders that are no longer being delivered (called with the active order ids)
export const pruneRoutes = (activeIds) => { for (const k of cache.keys()) if (!activeIds.has(k)) cache.delete(k); };
