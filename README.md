# Pakka Local — Your neighbourhood, delivered.

Four mobile-first portals (Customer `/user`, Restaurant `/restaurant`, Rider `/rider`, Admin `/admin`) on one Node/Express + SQLite backend.

## What works today (test build)
Everything in the order loop runs against the real backend and database: OTP login, discovery, server-priced checkout, payment (**sandbox**), restaurant alerts + ringing sound, accept/reject + refund tracking, atomic rider claim, pickup OTP, delivery OTP, ledger, earnings, cashouts with payment proof, open/close with server-side auto-reopen, surge rules, rider verification, order-ID search, audit log, installable PWAs.

**Latest additions:** restaurant price + platform part shown on every menu item; menu categories; delivery rules per restaurant (minimum order, free delivery above ₹X); admin order cancel with refund and admin reassigning a rider (both logged as admin interventions); per-restaurant orders and login on/off for admin; operating expenses feeding net profit; daily revenue chart; ratings after delivery; admin-configurable payout methods; cashout "linked records"; broadcast drafts and restaurant deep links; rider offers expire after 15 minutes; notification taps open the exact order; rider email; restaurant operating information; ETA and rating on restaurant cards.

**Also built:** Web Push for all roles (server-triggered, VAPID) with per-device subscriptions, retries, expired-subscription cleanup, stale-offer suppression and a customer notification inbox; admin broadcasts (audiences, preview, schedule, cancel, per-user daily cap, opt-out, click stats).

**Not connected yet (by design, for later):** PhonePe (payments are simulated; a banner says TEST MODE), WhatsApp OTP (code written, untested against Meta), FCM/Capacitor/Tauri wrappers. See "Remaining work".

## Run locally (5 minutes)
    cd backend
    cp ../.env.example .env            # set JWT_SECRET to 32+ random characters
    npm install
    npm run migrate
    ADMIN_PHONE=+91XXXXXXXXXX ADMIN_NAME="Owner" ADMIN_PASSWORD='a-long-passphrase' npm run create-admin
    DEMO_PASSWORD='any-10+-chars' npm run seed-demo      # optional: sample restaurants, menu, hostels, 2 riders
    npm start                          # open http://localhost:8080  (the backend also serves the 4 portals in dev)

**Customer login before WhatsApp is connected (pilot testing only):** set `OTP_PROVIDER=testcode`, `TEST_OTP_CODE=<6 digits>`, `TEST_OTP_PHONES=<your testers' numbers, comma separated>` (and `ALLOW_TEST_OTP=1` on Render). Only those numbers can sign in, with that code; nothing is sent and the code is never returned by any API. Remove these variables and switch to `OTP_PROVIDER=whatsapp` before real customers use it.

## Tests
    cd backend && npm test             # 52 API tests: roles, IDOR, lockout, OTP, race condition, money split, refunds, cashouts, proofs, push, broadcasts, security (forged tokens, SQL injection, uploads, rate limits, CORS, MFA)
    npm run test:browser               # real Chromium run of all four portals (needs: pip install playwright && playwright install chromium)
    bash test/run-browser-push.sh      # service-worker push behaviour (foreground vs closed app) in real Chromium

## Deploy
**Simplest (one URL for everything, recommended for testing):** Render only.
1. Push to GitHub. Render > New > Blueprint > select repo (uses `render.yaml`; needs a paid instance for the persistent disk; keep 1 instance).
2. Open the Render Shell, run `npm run create-admin` (with the env vars above) and optionally `npm run seed-demo` (set `ALLOW_DEMO_SEED=1`).
3. Visit `https://<your-service>.onrender.com/user/`, `/restaurant/`, `/rider/`, `/admin/`.

**Split hosting (Vercel frontend + Render API):** Import the repo in Vercel with *Root Directory* = `frontend`. Edit `frontend/public/config.js` → `API_BASE: "https://<your-render-url>"`, and set `ALLOWED_ORIGINS=https://<your-vercel-url>` on Render.

## Turning on notifications
1. `cd backend && npm run vapid` prints a key pair. Put `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:you@domain`) in Render's environment (never in frontend files).
2. Restaurants, riders and customers tap **Enable notifications** (permission is only asked on a tap). Up to 8 devices per account.
3. iPhone: notifications only work from the installed app (Safari > Share > Add to Home Screen, iOS 16.4+). The app explains this on screen.
4. Split hosting only: set `PUBLIC_API_URL` so notification clicks can be reported to the API.

## Admin two-factor sign-in
Admin > More > Settings > *Two-factor sign-in* > Set up. Add the key to an authenticator app, enter a code to confirm. After that, admin login asks for a fresh 6-digit code (a used code cannot be replayed; wrong codes count toward lockout). Secrets are encrypted at rest. It is optional, so turn it on for your own admin account. Keep a note of the setup key: there is no recovery email, and if you lose the app an admin with database access must reset it.

## Accounts
Nobody can self-register as staff. **Admin creates restaurant and rider accounts** (Admin → More → Restaurants / Rider verification) and shares the login. Riders add vehicle details and documents after logging in; admin verifies. Customers sign up through WhatsApp OTP.

## Money model (all computed server-side, snapshot per order)
Customer pays = restaurant price + markup + delivery + surge + tax. At verified delivery the ledger records: restaurant payout (price − commission), rider earning, and platform revenue (markup + commission + delivery margin + surge). Tax is tracked as a liability, never profit. Example ₹140 + ₹20 markup + ₹40 delivery: platform ₹34 + delivery margin; restaurant ₹126.

## Security implemented
bcrypt passwords; role re-checked from the DB on every request; portal-matched login; tenant scoping from session (IDOR-safe); login lockout; rate limits; hashed single-use OTPs; magic-byte upload validation; private files served only to owner/admin; strict CSP, HSTS, no inline scripts; CORS allow-list; parameterised SQL; no stack traces to clients; audit log of admin actions; DB-level uniqueness for one-rider-per-order, one-open-cashout, one-earning-per-order, unique order IDs.

## Remaining work / honest limitations
- **PhonePe**: adapter point is `routes/customer.js` + `services/core.js` (`settlePayment`, `startRefund`, `expireStalePayments`). Build against PhonePe's current UAT docs; the webhook route is stubbed (501). Sandbox payment/refund endpoints are disabled unless `PAYMENT_PROVIDER=sandbox`.
- **WhatsApp OTP**: provider written (`otpProviders.js`), needs your approved template and is untested against Meta. SMS fallback and the admin switch are not built.
- **Push is tested up to the browser boundary.** The server queue, dedupe, retries, cleanup and the service-worker handler are tested (fake push service + real Chromium). Delivery through Google/Apple/Mozilla push services, the permission prompt on real phones, and behaviour under battery saver are NOT verified. A closed PWA can still be delayed or killed by the OS; for guaranteed alerts plan the Android app (FCM). Custom MP3 plays only while the app is open; background alerts use the system sound.
- Not built: a screen for managing multiple delivery areas (areas exist only as a text field on each location), restaurant-facing view of rating comments, mandatory MFA enforcement, FCM/Capacitor/Tauri wrappers, real-map ETA (ETAs are approximations), SMS fallback for OTP.
- Fixed delivery code mode is a security risk (anyone who knows it can complete deliveries). Per-order mode is the default.
- Backups are written to the same disk; copy them off-box. SQLite means exactly one backend instance.
- Not yet verified: deployment on Vercel/Render, persistence across Render restarts, iOS/Safari and real-device testing, third-party security scan. The full browser suite passed 12 consecutive runs after fixing a navigation race; an independent penetration test has not been done.
