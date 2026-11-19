# Pakka Local update (P9): notifications, refunds, coupons, chat, checkout

Status: built and tested locally. **Not committed, not deployed.** Rider app 1.4 built, not installed on a phone.

## 1. Features

| Area | What changed |
|---|---|
| Background notifications | One queue for browsers (Web Push) and the rider Android app (Firebase Cloud Messaging, HTTP v1, no extra libraries). New events: rider assigned, picked up (customer + restaurant), arriving (rider within 300 m, sent once), refund stages, chat messages. Every event has a unique ID (no duplicates); dead tokens are removed. FCM stays off until Firebase files are added (see `docs/PUSH-SETUP.md`). |
| Rider app 1.4 | Receives FCM pushes (offers ring even when the app process was killed), registers its token on sign-in, removes it on sign-out. Can't go online without Location on + permission; if location is lost while online with no active delivery, it goes offline and explains why. |
| Restaurant portal | Mute/sound icon removed (an old “muted” choice is cleared, so the ring can't stay silently off). Opening and closing time in Restaurant profile. |
| Refunds (manual UPI) | Still started only by the system (rejected / cancelled). “Order not accepted” card asks for a UPI ID. Stages: awaiting details → requested → approved → completed (UTR required, password re-entry) / rejected / failed (reason required, customer can fix the UPI ID). Full history with times. Never shown as paid without a UTR. |
| Admin payouts | UPI IDs shown in full in Payouts (bank numbers stay masked). New Refunds page. |
| Coupons | Super Admin page: code, description, % or ₹, value, minimum bill, max discount, total uses, uses per customer, start/expiry, active, one restaurant or all, stats (uses, customers, discount given, in payment). Server checks everything; uses are reserved inside the order transaction (two people can't take the last use), released on failed/expired payment. Pakka Local pays: restaurant payout and rider earnings unchanged; the discount is a negative platform ledger entry. |
| Customer app | Checkout redesigned: compact “Deliver to” card with Change, items, coupon box with offers, bill with saving, “Continue to payment”. Tracking: Refresh button (one request at a time, no reload), chat with the delivery partner with unread count. Opening hours on cards and the menu page. Landing photo collage faded. “What should we call you?” after login when there is no real name; never asked again once saved. |
| Order chat | Only the order's customer and its assigned rider; open while the delivery is active; 500 characters; 20 messages / 10 min per person; read receipts; push to the other side. Customer sees “Delivery partner” (identity still only after pickup). |
| Admin | Sign in with username or mobile number (username set in Settings with password re-entry; existing lockout, rate limits, 2-step codes and role checks unchanged). Order radius lookup: for a place or GPS point, each restaurant's straight-line and road distance, charge and inside/outside the maximum distance. |

## 2. Files

New: `backend/src/services/{fcm,refunds,coupons,chat}.js`, `backend/test/{push-events,refunds,coupons,p9-features}.test.js`, `backend/test/helpers/world.js`, `PakkaFcmService.java`, `docs/PUSH-SETUP.md`, this report.
Changed: backend `config.js`, `db/migrations.js`, routes `admin, auth, customer, push, restaurant, rider`, services `core, push, tracking`, `test/lifecycle.test.js` (now expects full UPI IDs for admins); frontend `user/app.js`, `user/user.css`, `restaurant/app.js`, `rider/app.js`, `admin/app.js`, `shared/pl.js`, `shared/pl.css`, `sw.js` (cache v22); Android `build.gradle` (1.4, versionCode 5, firebase-messaging), `AndroidManifest.xml`, `RiderService.java`, `RiderNativePlugin.java`; `.gitignore` (Firebase files).

## 3. Database changes (run automatically on start)

- `p9_001_refund_workflow`: `refunds` + stage, upi_id, upi_name, upi_submitted_at, utr (unique), admin_note, reviewed_by, processed_at; existing rows back-filled; new `refund_events`.
- `p9_002_coupons_chat_hours_username`: `coupons`, `coupon_redemptions` (one per order), `orders.discount_paise`, `orders.coupon_code`, `order_messages`, `restaurants.opens_at/closes_at`, `users.username` (unique, case-insensitive).

## 4. Endpoints

- Push: `POST /api/push/fcm`, `POST /api/push/fcm/remove`; `GET /api/push/key` now reports `fcm`.
- Refunds: `POST /api/customer/orders/:code/refund-upi`; `GET /api/admin/refunds?stage=`; `POST /api/admin/refunds/:id/{approve|reject|failed}`; `POST /api/admin/refunds/:id/paid` (password).
- Coupons: `GET /api/customer/coupons?restaurant_id=`; `coupon` field on `POST /api/customer/quote` and `/orders`; `GET|POST /api/admin/coupons`, `PUT|DELETE /api/admin/coupons/:id`.
- Chat: `GET|POST /api/customer/orders/:code/messages`, `GET|POST /api/rider/orders/:id/messages`.
- Name: `POST /api/auth/name`; `needs_name` in login and `/api/auth/me`.
- Admin: `username` on `POST /api/auth/login` (admin portal only); `GET|POST /api/admin/username`; `POST /api/admin/distance-pricing/radius`.
- Restaurant: `opens_at`, `closes_at` on `PUT /api/restaurant/me`; returned by the public restaurant list and menu.

## 5. Environment variables

New, optional: `FCM_SERVICE_ACCOUNT_FILE` (default `<secrets dir>/fcm-service-account.json`). Existing VAPID variables unchanged.

## 6. Push setup

See `docs/PUSH-SETUP.md`: create a Firebase project, add Android app `com.pakkalocal.rider.staging`, put `google-services.json` in `mobile/rider-android/android/app/`, rebuild the APK, upload the service-account key to the server only.

## 7. Android configuration

`com.google.firebase:firebase-messaging:24.1.2`; Firebase plugin applied only when `google-services.json` exists; `PakkaFcmService` registered for `MESSAGING_EVENT`; new notification channel “rider_updates”; offers use the existing ringing channel. Build: `PakkaRider-staging-debug-v1.4.apk` (versionCode 5), checked with aapt2 and the dex contains `PakkaFcmService`.

## 8. Notification test results

- Automated: 176 backend tests, 174 pass, 0 fail, 2 skipped (skips are older and unrelated). New tests cover token ownership, FCM + Web Push routing, dead-token removal, no duplicates, rider assigned / pickup / arriving-once, refund notifications, chat notifications.
- Local browser (localhost): order with coupon, chat both ways, unread badge, refresh, coupon errors, admin coupons and radius pages, name screen, landing page.
- **Not tested:** real FCM delivery (needs your Firebase project) and Web Push on a physical phone this round.

## 9. Android background test results

Not run this round: the 1.4 APK was built and inspected but not installed on the emulator or a real phone. The 1.3 background behaviour (foreground service, restart after kill, background check) was tested on the emulator earlier. Real-device testing (your phones, different makers) is still needed.

## 10. Limitations (honest)

- Force-stopped apps get no notifications until opened again (Android rule).
- Some phone makers' battery savers delay or block background work; the rider app's Background check shows what to allow.
- Browsers can't guarantee web push delivery; iPhone web push only for the Home-Screen app on iOS 16.4+.
- Opening hours are shown to customers; the Open/Closed switch still decides ordering (no automatic closing).
- The location rule is enforced by the rider app; the server does not yet require a recent location to count a rider as available.
- Restaurant and rider screens were checked in code and tests, not visually in the browser this round (no signed-in session there).
