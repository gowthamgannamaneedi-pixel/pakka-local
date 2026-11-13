# Priority 2 – Live rider tracking and restaurant background notifications

Revision 2 (after independent review). Built on a separate copy of `pakka-local-test-build.tar.gz`.
The original archive and the Phase 1 working copy were not touched, and nothing here is merged with Phase 1.

## 1. What this build does

- **Rider tracking (foreground MVP).** The rider portal shares GPS only while a delivery is assigned. The server keeps
  only the latest position per rider. The customer sees it for their own order between pickup and delivery; admins see
  all active deliveries on a "Live deliveries" screen.
- **Restaurant notifications.** The existing Web Push system (service worker, VAPID, per-device subscriptions, retry
  queue, expired-subscription removal, de-duplication, deep link to the order) is reused. Additions: no push to a
  deactivated login or to a login moved to another restaurant, sign-out removes the device's subscription, and a
  "Test" button sends a real push to your own device.
- **Payment safety.** A production deployment cannot run simulated payments. No payment gateway is integrated:
  PhonePe is **not** implemented, and its webhook route still returns 501.

## 2. Review corrections in this revision

| Finding | What changed |
| --- | --- |
| T1 cleanup | Database trigger `trg_rider_location_cleanup` deletes a rider's position the moment they have no active delivery (delivered, cancelled, unassigned, reassigned), whatever code changed the order. A 60-second background job is a backstop and also removes positions of suspended or deactivated riders. New `POST /api/tracking/rider/stop` deletes the caller's own position only (rider id from the session; any id in the body is ignored). Cleanup no longer depends on the admin page. |
| T2 privacy | Every `/api/tracking/*` response, including 401/403/404, carries `Cache-Control: no-store, private`. Tests confirm customer-own-order only, admin-only map, and no coordinates for anonymous or wrong-role callers. |
| T3 map setup | `MAP_TILE_URL` and `MAP_TILE_ATTRIBUTION` are unchanged. With no tile URL or no map library, customers see a plain "map not available" note with the live status still shown, and admins see the exact reason. A notice also appears if tile images fail to load. The server logs a warning at start. **Leaflet is still not inside the ZIP** – see section 6. |
| T4 GPS wording | Rider notice now states sharing works only while the screen is open and on. Returning after more than 20 s in the background shows "Location sharing was paused…". No background GPS is claimed anywhere. |
| T5 payments | `render.yaml` now sets `APP_ENV=production`, `PAYMENT_PROVIDER=disabled`. The server refuses to start with `sandbox` on production (no override). Staging needs `SANDBOX_PAYMENT_PHONES`. With payments disabled, `POST /api/customer/orders` returns 503 before creating any row. The manual "refund settled" route exists only in sandbox environments. |
| T6 real tests | Could not be done in the build environment – see section 5. |
| T7 hosting | Requirements listed in section 8. No VPS or paid service is recommended. |

## 3. Exact list of changed files (against the original archive)

Modified (20):
`.env.example`, `.env.production.example`, `render.yaml`,
`backend/package.json` (scripts only; `package-lock.json` untouched),
`backend/src/app.js`, `backend/src/config.js`, `backend/src/jobs.js`, `backend/src/db/migrations.js`,
`backend/src/routes/admin.js`, `backend/src/routes/customer.js`, `backend/src/routes/push.js`, `backend/src/services/push.js`,
`frontend/public/sw.js`, `frontend/public/shared/pl.js`, `frontend/public/shared/push.js`,
`frontend/public/admin/app.js`, `frontend/public/admin/index.html`,
`frontend/public/rider/app.js`, `frontend/public/rider/index.html`,
`frontend/public/user/app.js`, `frontend/public/user/index.html`

(21 paths are listed because both env examples changed; `diff` reports 21 modified files.)

Added (11):
`backend/src/routes/tracking.js`, `backend/src/services/tracking.js`,
`backend/test/p2-tracking.test.js`, `backend/test/p2-payments.test.js`, `backend/test/p2-browser.py`, `backend/test/run-p2-browser.sh`,
`frontend/public/shared/track.js`, `frontend/public/admin/map.js`, `frontend/public/vendor/leaflet/README.md`,
`scripts/vendor-leaflet.sh`, `docs/PRIORITY2.md`

Not touched: `routes/rider.js`, `routes/restaurant.js`, `routes/auth.js`, `routes/files.js`, `services/core.js`,
`restaurant/app.js`, all existing tests, `package-lock.json`.

## 4. Database migrations

| Id | Content |
| --- | --- |
| `p2_001_rider_locations` | Table `rider_locations` (one row per rider: order, lat, lng, accuracy, heading, speed, device time, server time). |
| `p2_002_rider_location_cleanup` | Trigger on `orders` (status or rider change) that deletes positions of riders with no active delivery. |

Both are additive and apply automatically at start. Rollback: redeploy the previous build; the extra table and trigger are ignored by old code.

## 5. Test report

**None of these ran against the real npm dependencies, and none ran on a real phone.** Package installation is blocked
in the build environment, so `npm ci` could not be run. The API and browser tests below executed against small stand-in
modules written for `express`, `better-sqlite3` (backed by Node's built-in `node:sqlite`), `jsonwebtoken`, `bcryptjs`,
`helmet`, `cors`, `express-rate-limit` and `web-push`. Only `zod` was the real package.

| Run | Environment | Result |
| --- | --- | --- |
| `node --test "test/*.test.js"` | Node 22, stand-in packages | 71 tests, 71 passed, 0 failed (52 original + 16 tracking/push + 3 payment safety) |
| `test/run-p2-browser.sh` | Real headless Chromium (desktop), mocked GPS, Leaflet replaced by a recording stub, stand-in server packages | 24 checks, 24 passed |
| `test/run-browser.sh` (original suite) | Real headless Chromium, stand-in server packages | 70 checks, 70 passed |
| Real dependencies (`npm ci && npm test`) | – | **Not run** |
| Real push delivery (Google/Apple/Mozilla push services) | – | **Not run** (sender is mocked in tests) |
| Real map tiles and real Leaflet rendering | – | **Not run** |
| Real Android / iPhone / Windows / macOS devices | – | **Not run** |

What the stand-ins cannot prove: behaviour of the real SQLite driver (the cleanup trigger is plain SQL and is expected
to behave the same), real security headers from `helmet`, real rate-limit behaviour, real Web Push encryption.

Run on a machine with internet access:

```
cd backend
npm ci
npm test                      # expect 71 tests
npx playwright install chromium   # only if you want the browser suites; needs Python + playwright
npm run test:browser && npm run test:browser:p2
```

Please send back the output; any failure there outranks the results above.

## 6. Deployment instructions

1. **Map library (one time, needs internet):** `cd backend && npm run vendor:leaflet`. This copies `leaflet.js` and
   `leaflet.css` (Leaflet 1.9.4, BSD-2-Clause) into `frontend/public/vendor/leaflet/`. Commit those two files; after
   that no deployment downloads anything. The files are missing from this ZIP only because the build machine had no
   internet access. Until they are added, tracking works and shows status text instead of a map.
2. **Environment variables** (in addition to the existing ones):
   - `APP_ENV=production` and `PAYMENT_PROVIDER=disabled` on production. Ordering stays closed until a real gateway exists.
   - Test deployment only: `APP_ENV=staging`, `PAYMENT_PROVIDER=sandbox`, `SANDBOX_PAYMENT_PHONES=+91…,+91…`.
   - `MAP_TILE_URL` and `MAP_TILE_ATTRIBUTION` from a tile provider whose terms allow your use. Leave empty to run without a map.
     The public `tile.openstreetmap.org` server is the development fallback only; its policy forbids heavy use and it may block without notice.
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` for push (`npm run vapid` prints a pair).
3. **HTTPS is mandatory.** Browsers refuse geolocation, service workers and push on plain HTTP.
4. Start as before (`npm ci --omit=dev && npm start`). Migrations run at start. Check the log for the two map warnings.
5. After deploy: open each portal once so the new service worker (cache `pl-static-v3`) takes over.

## 7. Real Android testing checklist

Use two phones (rider, customer) and one restaurant device, on mobile data and on Wi-Fi. Record pass/fail and the phone model and Chrome version.

Rider (Android Chrome):
1. Sign in, go Online, accept a delivery. Chrome asks for location: Allow. Notice "Sharing live location" appears.
2. Customer phone: after pickup, order page shows the tracking card and "Live" within about 15 seconds.
3. Walk or ride 200 m: the marker follows within about 10 seconds.
4. Lock the rider phone for 2 minutes: customer shows "Last seen … ago", never "Live".
5. Unlock: rider sees "Location sharing was paused…"; customer returns to "Live".
6. Switch to another app for 1 minute, return: same as 4–5.
7. Turn on battery saver and repeat 2–3.
8. Deny location permission: rider sees "Location is blocked"; customer sees "Location not available yet".
9. Complete the delivery: the notice disappears; admin "Live deliveries" no longer lists the rider.
10. Admin cancels a second delivery after pickup: the rider's position disappears from the admin screen at once.

Restaurant notifications (repeat on Android Chrome, Windows Chrome and Edge, macOS Safari, iPhone/iPad Home Screen app):
1. Sign in, enable notifications, tap **Test**: a notification appears.
2. Lock the screen or close the app, tap **Test** from a second device signed in to the same account, then place a real test order: the notification arrives; tapping it opens that order.
3. Sign out, place another order: no notification on that device.
4. Note the delay in seconds for each case.

## 8. Hosting requirements (what any host must provide)

Taken from the code; nothing here assumes what the Hostinger plan includes.

| Requirement | Why (source) | If it is missing |
| --- | --- | --- |
| Node.js 20 or newer | `backend/package.json` engines | App does not start. |
| A long-running Node process | In-process timers in `src/jobs.js`: reopen restaurants (15 s), expire unpaid orders (60 s), send queued push notifications (2 s), location cleanup (60 s), database backup (6 h). Rate limits and login throttles are held in memory. | If the host stops the process when idle, queued notifications wait until the next visitor wakes it, timers do not run, and limits reset. |
| Native module support | `better-sqlite3` is a compiled add-on: it needs a matching prebuilt binary or a compiler at install time. | `npm ci` fails. |
| Persistent local disk with file locking | SQLite database in WAL mode (`DB_PATH`), uploads (`UPLOAD_DIR`), backups (`BACKUP_DIR`). One writer process only. | Data loss on redeploy, or corruption on network filesystems. |
| Exactly one app instance | SQLite single writer, in-process timers. | Duplicate jobs and lock errors if the host runs several workers. |
| HTTPS on your domain | Geolocation, service worker, push. | Tracking and notifications do not work. |
| Outbound HTTPS | Web Push services (Google, Apple, Mozilla), WhatsApp Graph API for OTP, tile provider is contacted by browsers only. | No push, no OTP. |
| Request volume | Portals poll: restaurant every 1–2 s, rider every 1 s, customer order page every 2 s, tracking every 5–7 s. | Shared-hosting process or request limits may throttle. |
| Scheduled jobs (optional alternative) | If no long-running process is possible, the timers could be moved behind an authenticated endpoint called by the host's cron. This is **not built**. | – |

To check in hPanel before any hosting decision: plan type; whether a Node.js application can be created and which Node
versions; whether the app stays running when idle; process, memory, CPU and inode limits; SSH access; cron jobs and
their minimum interval; whether native modules can be built; where persistent files may be stored.

## 9. Known limitations

- Rider GPS works only while the rider page is open with the screen on. Locking the phone, switching apps or closing
  Chrome pauses it. A screen wake lock is requested where the browser supports it. Continuous background tracking is not provided.
- Updates target every 7 seconds; phones may deliver fixes less often. Indoor accuracy can be poor. Speed and heading are stored but not shown.
- If the browser is killed during a delivery, the last position stays (shown as old, then offline) until the delivery ends.
- Location history is not kept. Restaurants are not on the map because they have no coordinates yet.
- Push depends on the browser vendor and operating system. Expected, **unverified**: Android Chrome delivers with the
  browser closed but battery saver can delay it; Windows Chrome/Edge deliver while the browser or its background process
  runs; macOS Safari 16+ supports web push; iPhone/iPad only for a web app added to the Home Screen on iOS/iPadOS 16.4+.
  The custom ring sound plays only while the app is open.
- If a browser rotates a push subscription while the app is closed, alerts stop until the app is next opened.
- Sign-out now also ends this account's sessions on other devices (existing behaviour) and removes push only from the device used to sign out.
- Ordering is closed on production until a real payment gateway is integrated and verified.

## 10. Overlap with Phase 1 (for a later, separate merge)

| File | Note |
| --- | --- |
| `config.js`, `routes/customer.js`, `routes/admin.js`, `render.yaml`, env examples | The payment guard here mirrors Phase 1 task T1 (same variable names: `APP_ENV`, `PAYMENT_PROVIDER=disabled`, `SANDBOX_PAYMENT_PHONES`, `config.sandboxPayments`). Keep the Phase 1 version at merge. |
| `db/migrations.js` | Both append; ids differ (`005_phase1_safety` vs `p2_001`, `p2_002`). |
| `jobs.js`, `services/push.js` | Independent one-line additions. |
| `rider/app.js`, `user/app.js`, `admin/app.js`, `shared/pl.js`, `sw.js` | Small edits; re-apply by hand. Keep the higher service-worker cache version. |
| `services/core.js`, `routes/rider.js` | Not touched here. The cleanup trigger also covers the new Phase 1 paths (manual delivery confirmation, admin rider assignment). |
