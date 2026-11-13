# Distance-based delivery charges (road distance, self-hosted OSRM)

Branch `distance-pricing`, built on the delivery-places work (commit e229d33). Owner decisions (13 Nov 2026):
**self-host OSRM** for routing; when distance pricing is ON, **every order** (listed PG/college and GPS address alike)
is charged by road distance; the per-place charges stay stored and are used again if distance pricing is switched OFF.
Nothing was deployed or purchased.

## 1. How the charge is worked out (server only)

1. The browser sends only the cart and the saved address id (anything else is ignored).
2. Start point: the **restaurant's pickup point** (set per restaurant by an admin). End point: the address's map point
   (the customer's confirmed GPS, or for a listed place without customer GPS, the place's map point).
3. The server asks the routing engine for the **road distance** (OSRM `route` service, `driving` profile). The result is
   cached by the exact coordinates of both points (6 decimals) for `route_cache_days` (default 30); moving either point
   always means a fresh lookup; failures are never cached.
4. The distance is matched to the admin's ranges `[from, to)`: a distance exactly on a boundary uses the higher range
   (1.0 km → 1–2 km). The minimum charge (if set) is applied. The restaurant's free-delivery threshold and surge rules
   still apply afterwards, as before.
5. **Beyond the maximum distance** (or beyond the last range when it is not open-ended): the order is refused with the
   distance shown ("…37.6 km by road… Pakka Local delivers up to 8 km").
6. **Distance not available** (engine not set up, unreachable, timeout, no route, restaurant without a pickup point):
   the admin's **fallback charge** applies and the order records `distance_fallback` and the reason; **no distance is
   invented**. If no fallback is set, the order is refused ("try again in a few minutes").
7. The checkout shows "4.27 km by road from Spice Route Biryani ₹30", or "Standard charge" with a notice for the fallback.
8. The order stores `delivery_paise`, `delivery_pricing` (distance / distance_fallback / listed / gps_fixed),
   `delivery_distance_m`, `delivery_band` (e.g. "4–5 km: ₹30") and `delivery_route_source` (osrm / cache / none:reason).
   The database refuses changes once payment has started; later price changes affect new orders only.

## 2. Admin: More → Distance-based delivery pricing

- On/off switch (with confirmation) and the routing-engine status.
- Ranges editor: from / to (empty = "and above") / charge. Refused: a first range not starting at 0, gaps, overlaps,
  an open-ended range that is not the last, negative or non-whole-paise charges, more than 30 ranges.
- Maximum distance (km), minimum charge, fallback charge (empty = refuse), days to keep calculated distances.
- Restaurant pickup points (paste "17.3395, 78.3082" from Google Maps). "Try it": restaurant + place → road distance and
  the charge the current setup gives. Recent distance-priced orders with distance, range and method.
- Each order's admin view shows "Road distance 4.27 km · 4–5 km: ₹30" or the fallback reason.
- Needs-attention panel: distance pricing on but no engine configured; visible restaurants without a pickup point.
- All changes audited with the admin, time and exact old → new values (ranges included).

Example values used in tests (0–1 ₹10, 1–2 ₹15, 2–3 ₹20, 3–4 ₹25, 4–5 ₹30, 5+ ₹40, max 8 km, fallback ₹35) are
**not approved prices**. In the local test database distance pricing is configured but switched **off**.

## 3. Routing architecture, hosting and cost

| Option | Verdict |
| --- | --- |
| Public OSRM demo server | Not used: best-effort, heavy use forbidden, access may be withdrawn ([policy](https://github.com/Project-OSRM/osrm-backend/wiki/API%20Usage%20Policy)). |
| OpenRouteService free key | Not used: the free plan states commercial use is not allowed ([plans](https://openrouteservice.org/plans/)). |
| Google Routes API | Not used (needs billing account; would need your approval). ~10,000 free route-matrix elements/month, then about $5 per 1,000 ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing)). |
| **Self-hosted OSRM (chosen)** | ₹0 per request. Needs a small Linux VPS; Hostinger shared/Business web hosting runs Node.js apps on demand and stops them when idle ([docs](https://docs.hostinger.com/node.js/overview)), and cannot run a routing engine. |

**Estimated cost:** one small VPS (1 vCPU, 1–4 GB RAM) at roughly a few hundred rupees per month; check the current
Hostinger KVM price before buying. OSRM, the map data (OpenStreetMap via Geofabrik, ODbL) and the routing are free.
The same VPS can run Pakka Local itself, which also removes the idle-shutdown problem for background jobs and push.

**Load:** with fewer than 50 orders a day, lookups are a few hundred a day at most (quotes are cached per exact pair of
points). A routing engine for a clipped area of ~30 × 35 km uses well under 500 MB RAM and answers in milliseconds.

### OSRM setup on an Ubuntu VPS (one time, ~15 minutes)

```bash
sudo apt update && sudo apt install -y docker.io osmium-tool
sudo mkdir -p /srv/osrm && cd /srv/osrm
# Telangana is in Geofabrik's India "southern zone" extract
sudo wget https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf
# keep only the delivery area (west Hyderabad: Moinabad, Chilkur, Himayatnagar, Aziznagar) with a wide margin
sudo osmium extract -b 78.10,17.20,78.55,17.55 southern-zone-latest.osm.pbf -o pakka-area.osm.pbf
IMG=ghcr.io/project-osrm/osrm-backend:v5.27.1      # pin a version
sudo docker run --rm -v /srv/osrm:/data $IMG osrm-extract -p /opt/car.lua /data/pakka-area.osm.pbf
sudo docker run --rm -v /srv/osrm:/data $IMG osrm-partition /data/pakka-area.osrm
sudo docker run --rm -v /srv/osrm:/data $IMG osrm-customize /data/pakka-area.osrm
sudo docker run -d --name osrm --restart unless-stopped -p 127.0.0.1:5000:5000 -v /srv/osrm:/data $IMG osrm-routed --algorithm mld /data/pakka-area.osrm
curl "http://127.0.0.1:5000/route/v1/driving/78.3000,17.3380;78.3295,17.3422?overview=false"     # should print "code":"Ok"
```

Then in Pakka Local's environment: `OSRM_URL=http://127.0.0.1:5000` (keep the engine on 127.0.0.1, not public),
restart the app, set each restaurant's pickup point, configure ranges, use "Try it", then switch distance pricing on.
To refresh map data (e.g. monthly), repeat the download/extract/partition/customize steps and restart the container.
If the delivery area grows, widen the `-b` box. The `car` profile is used for two-wheelers too; it may avoid some very
narrow lanes a scooter could use, so road distances can be slightly longer than a scooter's real route.

## 4. Database migration `p6_001_distance_pricing`

- `restaurants`: `pickup_lat`, `pickup_lng` (validated), `pickup_updated_at`.
- `distance_fee_bands` (from_km, to_km nullable for the last open range, fee_paise ≥ 0).
- `route_cache` (key = provider + both exact coordinates, distance, duration, time).
- `orders`: `delivery_pricing`, `delivery_distance_m`, `delivery_band`, `delivery_route_source`; existing orders got
  `delivery_pricing` derived from what they already stored (listed / gps_fixed); the freeze trigger covers the new fields.
- Settings: `distance_pricing_enabled` ('0'), `distance_max_km`, `distance_min_fee_paise`, `distance_fallback_fee_paise`
  (all empty = not set), `route_cache_days` ('30'). Environment: `OSRM_URL`, `OSRM_PROFILE` (driving), `OSRM_TIMEOUT_MS` (3000).

## 5. Tests

| Run | Routing | Result |
| --- | --- | --- |
| `node --test test/*.test.js` (Node 22, real dependencies) | **Mocked** router function; OSRM client against a **fake OSRM HTTP server** | **128 tests, 128 passed** (12 new: validation, permissions, every range and boundary, maximum, two restaurants, listed + GPS, minimum, failure → fallback / refusal, restaurant without pickup point, cache hits and invalidation, order snapshot vs later price change, tampering, admin check tool, OSRM success / NoRoute / HTTP 500 / timeout / not configured) |
| Chrome (headless) at 390 and 1280 px, local database | **Fake OSRM server** (straight line × 1.35, not road data) | Admin sets pickup point, ranges (gap refused), max, fallback, switches on, "Try it" 4.27 km → ₹30; customer: listed PG ₹30, GPS address 0.97 km → ₹10, address 37.6 km away refused; order keeps ₹30 after prices rise; admin order view shows distance and range; restaurant without pickup point → fallback notice; engine stopped → fallback ₹35 with no distance; no layout overflow |
| Regression (places and GPS flows, distance off) | none | All steps pass |
| **Not done** | **No real OSRM / real road data**, no VPS, no real phones or payments | Real road distances must be checked after OSRM is set up (compare a few "Try it" results with Google Maps). |
