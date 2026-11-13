# Pakka Local – consolidated changes (agent verification, dashboards, safety)

Built on the Priority 2 r3 working copy (branch `p2-ui-fixes-and-map`, commit 681c0e9) on branch
`consolidated-verification-ui`. A full backup of the working copy (with the local test database) was taken first:
`backups/pakka-local-before-consolidated-20261113-1300.tar.gz`. The original archives and the Phase 1 copy were not
touched (the Phase 1 copy is not on this machine), and nothing from Phase 1 was merged.

## 1. What the project is (inspected, not assumed)

Node 20/22 + Express API with SQLite (`better-sqlite3`, WAL, one process), four static PWA portals (customer `/user`,
`/restaurant`, `/rider`, `/admin`) using one shared script (`shared/pl.js`) and stylesheet (`shared/pl.css`), JWT staff
logins (password, optional admin TOTP), customer WhatsApp/test-code OTP, Web Push, Leaflet maps, migrations in
`backend/src/db/migrations.js` applied at start. No new dependency, service, process or paid API was added.

## 2. Database migration `p3_001_rider_verification`

| Change | Detail |
| --- | --- |
| `riders` rebuilt | Only to widen the status CHECK (SQLite cannot alter one). Every column and row is copied. New states: `draft` (not submitted), `reverification_required`. `pending` is the PENDING_VERIFICATION state. |
| New `riders` columns | `legal_name, date_of_birth, phone_verified_at, id_type, id_last4, id_front_path, id_back_path, licence_expiry, payout_method, payout_upi_enc, payout_upi_hint, bank_holder, bank_account_enc, bank_account_last4, bank_ifsc, consent_at, submitted_at, decided_at, decided_by, decision_note, correction_fields, application_updated_at` |
| Existing agents | `approved` → `reverification_required` (their deliveries in progress continue; no new ones), `pending` → `draft`. A history row explains it. Rejected, suspended and corrections-requested keep their state. |
| `rider_verification_history` | New columns `action`, `fields`. Triggers make it append-only (no UPDATE/DELETE). |
| `audit_logs` | Triggers make it append-only. |
| `rider_phone_otps` | New table for agent phone-verification codes (separate from customer login codes). |

Checked on a copy of the local database and on the live local database: orders, payments, ledger, earnings,
commissions, cashouts, refunds, users, restaurants and menu rows are byte-for-byte unchanged; integrity and foreign-key
checks pass. Rollback: restore the backup; the old code cannot read the new rider states.

**Operational impact to decide before deploying:** every currently approved agent becomes `reverification_required`
at the first start and cannot receive new orders until they complete the new application and an admin approves it.
If no agent is approved, customers see the existing "no delivery partners available" message and cannot order.

## 3. Features completed

**Delivery-agent application and verification**
- Agents are still created by an admin (no public sign-up). New agents start in `draft`; there is no way to approve
  without a complete application (`approve_now` is ignored).
- Five-step application in the rider app (personal, identity, vehicle and licence, payout, review). Each field saves to
  the server when it changes; agents can leave, sign out and resume. Missing items are listed per step and in total.
  Incomplete applications cannot be submitted (server-checked). Under-18 and expired licences are refused.
- Collected: legal name, date of birth, verified mobile (code through the configured OTP provider), address, emergency
  contact, profile photo, ID type + last 4 characters only + front/back upload (masked Aadhaar requested), vehicle type,
  make/model, registration, RC, vehicle photo, licence number/expiry/document (not required for a bicycle), optional
  insurance, UPI ID or bank account (holder, number, IFSC), consent. Full ID numbers are not collected.
- Bank account number and UPI ID are AES-256-GCM encrypted at rest; agents and the review screen see masked values. The
  full details are shown only after the admin re-enters their password, and each view is audited.
- Documents are stored privately (never in the public upload folder), checked by file content (JPG/PNG/WebP, PDF for
  documents, 5 MB), served only to the agent and admins with `Cache-Control: private, no-store`; each admin view of an
  identity document is audited.
- Admin queue with tabs (pending, corrections requested, re-verification, not submitted, approved, rejected, suspended,
  all) and counts; review screen with all details, documents, missing items, deliveries in progress and the permanent
  decision history. Approve (complete applications only, password confirmation), request corrections (choose the
  fields + reason), reject (reason), suspend (reason + password). Decision, admin and timestamp are recorded.
- Eligibility is enforced on the server: only `approved` + online agents receive offers or can accept; going online is
  refused otherwise. Agents in any other state keep and can finish deliveries already assigned (pickup, delivery code,
  location sharing). Suspended/rejected agents cannot share location.

**Safety and security**
- Delivery offers no longer reveal the customer's phone, exact address, GPS pin, map link or instructions before an
  agent accepts (they see only the location name/area); full details appear after acceptance. This was a leak in r3.
- Admin order cancellation and taking a rider off an order now need password re-entry (and the authenticator code when
  MFA is on) and a mandatory reason; failed attempts are audited. A wrong confirmation password no longer signs the
  admin out.
- Verification history and the audit log cannot be edited or deleted (database triggers).

**Restaurant dashboard**
- One new-order alert at a time with a queue (from r3). New: a response timer. The limit is the admin setting
  "Restaurant response time" (1–120 minutes); it is **empty by default**, in which case only the waiting time is shown.
  Nothing is rejected automatically. Uses the server clock.
- Earnings: today, yesterday and the last 14 days (India time), from the commission records written at delivery; totals
  match the per-order records.
- Surge-charge requests removed (restaurant screen and API, admin review). Past request rows are kept untouched; surge
  pricing rules set by the admin are unchanged.
- Suggested categories (18) added with one tap; custom categories still work.
- A dish cannot be shown to customers without a photo (create or publish). Dishes published before this change keep
  working and are flagged "Photo needed"; photo-less drafts are hidden from customers. Uploads are content-checked
  (JPG/PNG/WebP, 3 MB).

**Customer app**
- Home shows orders in progress (status, progress bar, arrival time) and recent orders above restaurants.
- Tracking page: clear status header with progress and arrival time; scooter marker for the delivery partner (green
  live, amber last seen, grey offline) and a home pin for the drop-off; live/last-seen/offline wording unchanged.
- Account: profile, order counts, settings list. The long notification feed and its unread badge (it showed "72") were
  removed from Account; the notification prompt is no longer at the top of the tracking page.

**Admin dashboard**
- "Needs attention" panel computed live: applications to review, re-verifications, no approved agent online, orders
  waiting past the response time (or waiting at all when no time is set), accepted orders without an agent, payouts,
  unconfirmed refunds, failed/expired payments today, closed restaurants, dishes without photos. Each opens the right
  screen. Tabs: Overview, Orders, Agents, Payouts, More, with badges.

**Design (all four portals, shared stylesheet)**: warm page background with white cards, consistent section headers,
focus rings, desktop hover states, loading placeholders, empty states, tables, reduced-motion support.

## 4. Not done / not decided

- **Service area (about 10 km around HTC Road) and multi-order batching: not implemented**, as instructed. Nothing in
  pricing, earnings or assignment changed. Delivery locations already carry latitude/longitude and the order keeps the
  drop-off coordinates, so a configurable zone check and route planning can be added later.
- Restaurant response timeout value: not set (owner/admin decision).
- Agent self-registration: not added (accounts are created by admins, as before).
- Customer "account-update features": there was no profile editing to remove; the update feed and badge were removed.
- No real payment gateway; ordering stays closed on production; simulated payments stay disabled there.
- Restaurant and admin dashboards were improved within the existing screens, not rebuilt page by page.

## 5. Tests actually run

| Run | Result |
| --- | --- |
| `node --test test/*.test.js`, Node 22.23.5, real dependencies | 96 tests, 96 passed (75 existing, updated where the rules changed, + 13 verification + 8 restaurant/admin) |
| Migration on a copy of the local database | Financial and order data unchanged; history/audit triggers block edits; integrity ok |
| End-to-end in real Google Chrome (headless): agent fills the application through the form at 390 px (typing, date fields, uploads of PNG and PDF), signs in again and resumes, submits; admin at 1280 px opens the queue, the review and an ID document, requests a photo correction; agent replaces it and resubmits; admin approves with a wrong then right password; agent sees the Online switch and goes online | All steps passed; only console error was the deliberate wrong-password 401 |
| Chrome sweep of all four portals at 390 px and 1280 px (36 page checks) | Service worker active, no horizontal overflow, maps with scooter and home markers and attribution; console errors only `favicon.ico` 404 and the rider-photo 404 for a test agent without a photo |
| Desktop-app browser pane | Rider re-verification view, autosave and resume, phone code verification; customer home and tracking; admin live map with live and offline agents |
| Not run | Real phones, real GPS, real push delivery, real WhatsApp OTP delivery, real payment gateway, Hostinger deployment |

## 6. Hosting (Hostinger) and setup

Nothing new needs a separate process or service. The same requirements apply as before (see `PRIORITY2.md` section 8):
one long-running Node 20/22 process, persistent disk for the SQLite database and **private uploads** (identity
documents now live there: keep `UPLOAD_DIR` outside the web root and back it up), HTTPS, outbound HTTPS for WhatsApp
OTP (now also used for agent phone verification). Check in hPanel whether the plan can run a persistent Node app with
native modules before deciding.

Manual setup: set the restaurant response time if wanted (Admin → More → Settings); tell existing agents to complete
the application before the upgrade goes live; review and approve them in Admin → Agents.

Important: `JWT_SECRET` is also the basis of the encryption keys for payout details and admin MFA. Changing it makes
stored payout details unreadable (agents would re-enter them).
