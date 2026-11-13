# Priority 2, revision 3: UI fixes and map setup

Built on `pakka-local-priority2-r2`. The original archive and the Phase 1 copy were not touched; nothing is merged
with Phase 1. No business rule, price, commission or payment behaviour was changed.

## 1. What changed

| Task | Change |
| --- | --- |
| Restaurant order alerts | One alert card at a time instead of a stack. With several pending orders it shows "1 of 3", previous/next buttons and a scrollable row of order chips (oldest first). Each card shows order ID, order time (and how long ago), items, order amount and payout, plus Reject and Accept. A minimise button shrinks it to a "3 new orders waiting · Show" bar; the sound and the "New" tab keep every pending order. Mobile: the card sits above the bottom navigation and the page gets matching bottom padding, so every control can be scrolled clear. Desktop (900 px+): it is a side panel on the right and the page keeps a right-hand gutter, so no order card or button is underneath it. |
| Admin Daily trend | Cause of the "₹1" chart: with no revenue the axis fell back to a hard-coded ₹1 maximum, and the default "Today" range has a single day. The server aggregation was checked and is correct (IST day buckets, DELIVERED orders only, platform ledger rows only, totals equal the sum of the days); new tests prove it. The chart now shows a clear empty state ("No delivered orders in this range"), rounded axis labels (₹0 / ₹1k / ₹2k), range totals, per-bar tooltips, zero days as gaps, and a hint to choose 7 or 30 days when one day is shown. Nothing is estimated or filled in. |
| Leaflet | Leaflet 1.9.4 (BSD-2-Clause) is now inside the project: `frontend/public/vendor/leaflet/` holds `leaflet.js`, `leaflet.js.map`, `leaflet.css`, `images/` (marker and layer icons) and `LICENSE`. Nothing is downloaded at runtime. The refresh script is now Node (`scripts/vendor-leaflet.mjs`, also `npm run vendor:leaflet`), so it runs on Windows too. |
| Map tiles | `MAP_TILE_URL` / `MAP_TILE_ATTRIBUTION` unchanged. New value `MAP_TILE_URL=none` switches the map off on any environment (useful to check the fallback locally). Production still has no map unless a provider is set; development still falls back to the public OSM tile server for light local use only. No paid provider or key is hard-coded. |
| Service worker | Cache name `pl-static-v4` so browsers pick up the new CSS/JS. |
| Test isolation | `test/p2-payments.test.js` no longer reads a developer's `backend/.env` (it made 2 tests fail on a machine with a local `.env`). |

## 2. Exact changed files (against `pakka-local-priority2-r2.zip`)

Modified (12): `.env.example`, `docs/PRIORITY2.md` (pointer to this file), `backend/package.json` (vendor script only), `backend/src/config.js` (`MAP_TILE_URL=none`),
`backend/test/p2-payments.test.js`, `frontend/public/admin/app.js`, `frontend/public/restaurant/app.js`,
`frontend/public/shared/pl.css`, `frontend/public/shared/track.js` (fallback message text), `frontend/public/sw.js`,
`frontend/public/vendor/leaflet/README.md`, `scripts/vendor-leaflet.sh`

Added (13 files): `docs/PRIORITY2-R3.md`, `backend/test/p2-dashboard.test.js`, `backend/scripts/local-test-scenario.js`,
`scripts/vendor-leaflet.mjs`, `frontend/public/vendor/leaflet/{leaflet.js, leaflet.js.map, leaflet.css, LICENSE}`,
`frontend/public/vendor/leaflet/images/{marker-icon.png, marker-icon-2x.png, marker-shadow.png, layers.png, layers-2x.png}`

## 3. Run it locally (Windows, macOS, Linux)

Use **Node 20 or 22**. Node 24 is not supported by the pinned `better-sqlite3` 11.x (see section 5).

```
cd backend
npm ci
copy ..\.env.example .env          (macOS/Linux: cp ../.env.example .env)
```

Edit `backend/.env` for local testing: `NODE_ENV=development`, `APP_ENV=development`, `PAYMENT_PROVIDER=sandbox`,
a random `JWT_SECRET` (32+ characters), `ALLOWED_ORIGINS=http://localhost:8080`, `OTP_PROVIDER=testcode`,
`TEST_OTP_CODE=<6 digits>`, `TEST_OTP_PHONES=<your test number>`. Then:

```
set DEMO_PASSWORD=<10+ characters>  &&  npm run seed-demo
set ADMIN_PHONE=+91...  &&  set ADMIN_NAME=Admin  &&  set ADMIN_PASSWORD=<12+ characters>  &&  npm run create-admin
npm start
```

Open http://localhost:8080/user/ , /restaurant/ , /rider/ , /admin/ .
Optional test orders (local only, refuses non-localhost and production): `node scripts/local-test-scenario.js history 7 tracking pending 3`
(it reads `backend/data/LOCAL-TEST-LOGINS.txt`; see the script header).

## 4. Test results (this revision, real dependencies)

| Run | Result |
| --- | --- |
| `node --test test/*.test.js`, Node 22.23.5, real `npm ci` | **75 tests, 75 passed, 0 failed** (71 existing + 4 new dashboard tests), with and without a local `.env` |
| Same, Node 24.21.0 | Process crashes on exit inside `better-sqlite3` 11.10 (`Assertion failed: (env) != nullptr`); runner reports 1 passed, 9 failed at file level. Not a code failure; see section 5. |
| Browser sweep, real Google Chrome (headless, Playwright) at 390 px and 1280 px | 36 page checks (4 portals): service worker active everywhere, 0 page errors, 0 failed requests, 0 broken images, 0 horizontal overflow. Restaurant re-check with 3 pending orders: 8 page checks, exactly 1 alert card, never over the bottom navigation, 0 controls covered on desktop. |
| Desktop app browser pane (manual) | Restaurant queue (next, chip pick, minimise, expand, Reject with reason, Accept), admin chart empty and 7-day, admin and customer maps with markers, no-tile fallback on both maps. |

Expected console noise in the sweep: one 404 for the rider photo when a test rider has no photo (existing behaviour),
and 429 "too frequent" on rider location because the test GPS simulator and the open rider page shared one rider.

## 5. Known limitations

- **Node 24**: `better-sqlite3` 11.x crashes on process exit under Node 24. Use Node 20/22 (Render's default is fine),
  or upgrade `better-sqlite3` to 12.x in a separate, tested change. `engines` still says `>=20`.
- **Rider portal alerts still stack** (several delivery offers overlap each other and the bottom navigation). This
  revision fixed the restaurant portal only, as asked.
- Notifications and service worker cannot be tested inside the Claude desktop browser pane (it denies notification
  permission and refuses service-worker registration). In real Chrome the service worker registers. Real push delivery
  was **not** tested; real Android GPS was **not** tested (positions came from a local simulator).
- Map tiles in the screenshots come from the public OSM server (development fallback, light use only). Production needs
  a provider whose terms allow your use, set in `MAP_TILE_URL`.
- The admin chart shows at most 62 days; a longer custom range is cut off in the chart while the totals cover the full range (unchanged behaviour).
- Admin "collected" uses the time a delivered order was last updated, which equals delivery time today because
  DELIVERED is final; if a later change ever edits delivered orders, the day bucket would move (unchanged behaviour).
