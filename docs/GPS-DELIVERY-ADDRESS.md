# GPS-based customer delivery address and rider Google Maps navigation

Branch `gps-delivery-address`, built on the latest working copy (r2 → r3 → consolidated verification work, commit c080c87).
That copy is newer than `pakka-local-priority2-r2.zip` and contains the approved verification and safety changes, so it
was used instead of the older ZIP. Backup taken first: `backups/pakka-local-before-gps-address-20261113-1352.tar.gz`.
The original ZIPs were not touched. Nothing was deployed.

## 1. How it works

**Customer (phone browser, no Google account, no map search)**
1. Account → Delivery addresses → Add, or from the cart. The screen says: *"Please stand at your actual delivery
   location before capturing your GPS location. Our delivery partner will use these coordinates to reach you."*
2. **USE MY CURRENT LOCATION** calls the browser Geolocation API with `enableHighAccuracy: true`, `maximumAge: 0` and a
   timeout from the admin setting (default 20 s). The phone asks for permission.
3. Shown on success: "Location captured", accuracy "about ±N m", time, coordinates. Never called exact.
4. Clear messages with **Try again** for: permission blocked (with how to allow it), GPS off / no fix, timeout, browser
   without location support, non-HTTPS page, invalid coordinates, and a reading older than 2 minutes (a cached old
   position is refused, not used).
5. The customer ticks **"I am standing at my delivery location right now."** Saving is refused without it.
6. If the admin has set an accuracy limit and the reading is worse, a warning shows the reported accuracy and the limit;
   the customer captures again or ticks "Use this location anyway". The server enforces the same rule.
7. Details: place type (Home, Hostel, PG, College, Other), PG/hostel/college name, building, block, floor, room, main gate
   or entrance, landmark, instructions, and optionally one of Pakka Local's existing delivery areas. Required: a place or
   building name, plus a room, gate or landmark. No college or PG names are suggested (the official list comes later).
8. Up to 10 addresses; one default; edit (new GPS needs a new capture and confirmation); remove (deactivated, kept for
   the records). Coordinates are kept only on the server; the browser stores just which saved address is selected.

**Checkout**: the customer picks a saved address (the GPS accuracy and capture time are shown), can tap "I've moved:
update GPS", and must tick "Deliver to this point…" before Pay is enabled. The server refuses an order without an own,
active saved address and `confirm_destination: true`.

**Order snapshot**: the order copies the destination (coordinates, accuracy, capture time, confirmation time, label,
place, building, block, floor, room, gate, landmark, instructions, address id). A database trigger refuses any change to
these fields once the order has left `PAYMENT_PENDING`, so editing or removing a saved address never moves a paid or
active order, and completed orders keep their history.

**Delivery partner**: open offers still show only the area ("Customer pinned location" or the delivery-area name); no
coordinates, room, phone or link. After accepting, the delivery card shows place, building, block/floor/room tiles,
gate, landmark, instructions, the GPS point and accuracy, **NAVIGATE IN GOOGLE MAPS**, Copy GPS and Copy link (with a
manual-copy fallback for older Android browsers). The link is built on the server for the assigned rider only:

`https://www.google.com/maps/dir/?api=1&destination=<lat>%2C<lng>&travelmode=two-wheeler&dir_action=navigate`

It opens the Google Maps app when installed (Android hands Google Maps URLs to the app) or the browser otherwise. No API
key, no Directions/Geocoding/Places call. Missing or invalid coordinates show a warning instead of a broken link.

## 2. Database migration `p4_001_gps_delivery_addresses`

- `customer_addresses`: id, customer_id, label, place_name, building, block, floor, room, entrance, landmark, instructions,
  delivery_location_id (optional), lat (CHECK −90..90, NOT NULL), lng (CHECK −180..180, NOT NULL), accuracy_m, captured_at,
  accuracy_acknowledged, is_default, active, created_at, updated_at.
- `orders`: dest_address_id, dest_label, dest_place_name, dest_building, dest_block, dest_floor, dest_room, dest_entrance,
  dest_landmark, dest_accuracy_m, dest_captured_at, dest_confirmed_at (existing dest_text/dest_lat/dest_lng/instructions
  reused). Trigger `trg_order_destination_frozen`.
- `reference_places`: empty directory for the official PG/college list (name, kind pg/college/hostel/other, address,
  lat, lng, entrance_notes, active (off by default), verification_status unverified/verified/rejected, verified_by,
  verified_at, source). Separate from customer coordinates; nothing reads it yet and nothing substitutes it.
- Settings (Admin → Settings → Customer GPS location): `gps_accuracy_warn_m` (empty = no limit; 5–5000),
  `gps_capture_timeout_sec` (default 20; 5–120), `gps_fix_max_age_min` (default 10; 1–120).

Existing orders are unchanged. Old orders made with a delivery area and no customer GPS keep what they had.

## 3. Prices and fees

Unchanged. If a saved address is linked to an existing delivery area, that area's fee and surge rules apply exactly as
before; otherwise the existing GPS delivery fee applies. No service-area radius, batching or earnings change was added.
The coordinates are stored so a configurable service-area check and multi-drop planning can use them later.

## 4. Security

- Address endpoints are scoped to the signed-in customer (`customer_id = session user`): another customer's address id
  returns 404 for read, edit, delete, quote and order. Responses carry `Cache-Control: no-store, private`.
- Coordinates, room and the navigation link reach a rider only for an order assigned to that rider (server-side check);
  other riders get 404/403. Restaurants never receive the destination. Public endpoints, notifications, order events
  and the audit log contain no customer coordinates (tested).
- Input validation: finite numbers in range, (0,0) refused, accuracy required, capture time required and not in the
  future or older than the limit, label from a fixed list, length limits, control characters and `<` `>` removed,
  unknown fields rejected on address requests.
- Geolocation only works on HTTPS (and localhost for testing): production must use HTTPS.

## 5. Tests

| Run | Result |
| --- | --- |
| `node --test test/*.test.js` (Node 22, real dependencies) | 105 tests, 105 passed. New: 9 GPS-address tests (validation, freshness, accuracy policy, multiple/edit/default/remove, ownership, fees, frozen snapshot, rider-only coordinates and link, no leaks to restaurants/public/notifications/logs, OTP delivery still works). Older tests use a small documented adapter to the new order contract. |
| Migration on the local test database | All existing orders keep destination and total; ledger, earnings, commissions, payouts, refunds, users, restaurants, menu and delivery areas unchanged. |
| Chrome (real browser, headless) with **simulated GPS** at 390 px and 1280 px | Capture with permission; permission denied; GPS off (scripted error); timeout (scripted error); old cached reading refused; poor accuracy with a 50 m limit (refused, then accepted with "use anyway"); save, multiple addresses, edit, remove; checkout blocked until the point is confirmed; order paid; saved address moved afterwards, order unchanged; rider offer without coordinates; rider accepts; destination card; link parameters; tapping opens a new tab at exactly that link (Google itself was blocked in the test); Copy GPS and Copy link; no horizontal overflow. Only console error: the intended refused save. |
| **Not done** | No real Android phone, real GPS, real Google Maps app hand-off, iPhone, or production HTTPS test. These must be checked on a device (checklist below). |

Real-device checklist (Android Chrome, HTTPS test server): allow / deny location; GPS off; indoors vs outdoors accuracy;
save an address in a hostel room; order; on a second phone as the rider, accept and tap Navigate (Maps app should open
in two-wheeler navigation to the pin); Copy GPS / Copy link; repeat with Google Maps uninstalled (browser should open).

## 6. Hosting

No new service, process, dependency or paid API. Google Maps is only a link. HTTPS is mandatory (browsers block GPS on
plain HTTP). Map tiles for the existing live-tracking map are unchanged and still need a provider set in `MAP_TILE_URL`.

## 7. Limitations

- Phone GPS indoors can be off by tens of metres; the written details (block, floor, room, gate) are what close the gap.
- Riders always see the accuracy; set an accuracy limit in Settings once you have seen real readings from your area.
- `travelmode=two-wheeler` is honoured by Google Maps where two-wheeler mode exists (India); elsewhere Maps chooses a mode.
- The official PG/college directory has no screens yet (table only), by design until the list is supplied and verified.
- Customers who ordered before this change must add a GPS address before their next order.
