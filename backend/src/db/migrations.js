// Append-only migration list. Never edit a shipped migration; add a new one.
// All money is stored as integer paise. All timestamps are ISO-8601 UTC text.
export const migrations = [
  {
    id: '001_initial',
    sql: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('customer','restaurant','rider','admin')),
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  name TEXT NOT NULL,
  password_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE customers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  default_location_id INTEGER,
  promo_opt_in INTEGER NOT NULL DEFAULT 1,
  txn_push_opt_in INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE restaurants (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT, address TEXT, phone TEXT, cuisine TEXT,
  logo_path TEXT, image_path TEXT, maps_link TEXT,
  admin_visible INTEGER NOT NULL DEFAULT 0,      -- admin Show/Hide; takes priority
  approved INTEGER NOT NULL DEFAULT 0,
  commission_bps INTEGER NOT NULL DEFAULT 1000,  -- 1000 = 10.00%
  markup_paise INTEGER NOT NULL DEFAULT 0,       -- per-item markup
  packing_buffer_min INTEGER NOT NULL DEFAULT 5,
  rating REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE restaurant_users (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id)
);
CREATE INDEX idx_ru_rest ON restaurant_users(restaurant_id);

CREATE TABLE restaurant_operating_status (
  restaurant_id INTEGER PRIMARY KEY REFERENCES restaurants(id),
  is_open INTEGER NOT NULL DEFAULT 0,
  reopen_mode TEXT CHECK (reopen_mode IN ('auto','manual')),
  reopen_at TEXT,
  updated_at TEXT
);
CREATE INDEX idx_ros_reopen ON restaurant_operating_status(is_open, reopen_at);

CREATE TABLE riders (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','approved','rejected','corrections_requested','suspended')),
  is_online INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  photo_path TEXT, address TEXT, emergency_phone TEXT,
  vehicle_category TEXT, vehicle_make TEXT, vehicle_model TEXT, vehicle_reg_no TEXT,
  vehicle_photo_path TEXT, rc_path TEXT, licence_no TEXT, licence_path TEXT,
  insurance_no TEXT, insurance_path TEXT
);
CREATE INDEX idx_riders_avail ON riders(verification_status, is_online);

CREATE TABLE food_categories (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE food_items (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  category_id INTEGER REFERENCES food_categories(id),
  name TEXT NOT NULL, description TEXT, image_path TEXT,
  base_price_paise INTEGER NOT NULL CHECK (base_price_paise >= 0),
  prep_time_min INTEGER NOT NULL DEFAULT 15,
  available INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_food_rest ON food_items(restaurant_id, deleted);

CREATE TABLE delivery_locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, kind TEXT, address TEXT NOT NULL, area TEXT, contact TEXT,
  delivery_fee_paise INTEGER NOT NULL DEFAULT 0, distance_km REAL,
  maps_link TEXT, lat REAL, lng REAL, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  order_code TEXT NOT NULL UNIQUE,               -- PL20261104A1B2C3
  customer_id INTEGER NOT NULL REFERENCES users(id),
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  status TEXT NOT NULL CHECK (status IN ('PAYMENT_PENDING','PAYMENT_FAILED','EXPIRED','PLACED','ACCEPTED',
    'PREPARING','READY','PICKED_UP','DELIVERED','REJECTED','CANCELLED')),
  delivery_location_id INTEGER REFERENCES delivery_locations(id),
  dest_text TEXT, dest_lat REAL, dest_lng REAL, dest_maps_link TEXT,
  instructions TEXT,
  customer_name TEXT, customer_phone TEXT,
  -- immutable price snapshot (paise)
  items_base_paise INTEGER NOT NULL, markup_paise INTEGER NOT NULL,
  delivery_paise INTEGER NOT NULL, surge_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0, total_paise INTEGER NOT NULL,
  commission_bps INTEGER NOT NULL, commission_paise INTEGER NOT NULL,
  restaurant_payout_paise INTEGER NOT NULL, rider_payout_paise INTEGER NOT NULL DEFAULT 0,
  rejection_reason TEXT, rejection_note TEXT,
  rider_id INTEGER REFERENCES users(id),
  eta_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);
CREATE INDEX idx_orders_rest ON orders(restaurant_id, status);
CREATE INDEX idx_orders_cust ON orders(customer_id, created_at);
CREATE INDEX idx_orders_rider ON orders(rider_id, status);
CREATE INDEX idx_orders_status ON orders(status, created_at);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  food_item_id INTEGER REFERENCES food_items(id),
  name TEXT NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0),
  base_price_paise INTEGER NOT NULL, customer_price_paise INTEGER NOT NULL, prep_time_min INTEGER
);
CREATE INDEX idx_oi_order ON order_items(order_id);

CREATE TABLE order_events (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  event_type TEXT NOT NULL,
  actor_user_id INTEGER, actor_role TEXT, metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_oe_order ON order_events(order_id, created_at);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL DEFAULT 'phonepe',
  merchant_order_id TEXT NOT NULL UNIQUE,
  provider_txn_id TEXT,
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUCCESS','FAILED','EXPIRED')),
  raw_response TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);
CREATE INDEX idx_pay_status ON payments(status, created_at);
CREATE TABLE refunds (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  merchant_refund_id TEXT NOT NULL UNIQUE,
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'REFUND_INITIATED'
    CHECK (status IN ('REFUND_INITIATED','REFUND_COMPLETED','REFUND_FAILED')),
  reason TEXT, raw_response TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT
);

CREATE TABLE pickup_otps (
  order_id INTEGER PRIMARY KEY REFERENCES orders(id),
  otp_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE delivery_verifications (
  order_id INTEGER PRIMARY KEY REFERENCES orders(id),
  mode TEXT NOT NULL CHECK (mode IN ('fixed','per_order')),
  otp_hash TEXT, attempts INTEGER NOT NULL DEFAULT 0, verified_at TEXT
);
CREATE TABLE rider_assignments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  rider_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('OFFERED','ACCEPTED','DISMISSED','EXPIRED')),
  offered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), responded_at TEXT
);
-- Database-level guarantee: at most one accepted rider per order.
CREATE UNIQUE INDEX uq_assign_one_accepted ON rider_assignments(order_id) WHERE status='ACCEPTED';
CREATE UNIQUE INDEX uq_assign_offer ON rider_assignments(order_id, rider_id);

CREATE TABLE rider_earnings (
  id INTEGER PRIMARY KEY,
  rider_id INTEGER NOT NULL REFERENCES users(id),
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),   -- credited exactly once
  amount_paise INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE restaurant_commissions (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  base_paise INTEGER NOT NULL, commission_bps INTEGER NOT NULL,
  commission_paise INTEGER NOT NULL, payout_paise INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Append-only ledger. balance = SUM(amount) per (account_type, account_id).
CREATE TABLE platform_transactions (
  id INTEGER PRIMARY KEY,
  account_type TEXT NOT NULL CHECK (account_type IN ('platform','restaurant','rider')),
  account_id INTEGER,
  kind TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  order_id INTEGER REFERENCES orders(id), ref_id INTEGER, note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_ptx_acct ON platform_transactions(account_type, account_id);
CREATE UNIQUE INDEX uq_ptx_order_kind ON platform_transactions(order_id, account_type, account_id, kind)
  WHERE order_id IS NOT NULL;

CREATE TABLE surge_charge_rules (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fixed','percent')),
  value INTEGER NOT NULL,                      -- paise, or basis points
  location_id INTEGER REFERENCES delivery_locations(id),
  starts_at TEXT, ends_at TEXT, active INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE surge_charge_requests (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  reason TEXT NOT NULL, requested_paise INTEGER,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  decided_by INTEGER REFERENCES users(id), decided_at TEXT, decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE cashout_requests (
  id INTEGER PRIMARY KEY,
  account_type TEXT NOT NULL CHECK (account_type IN ('restaurant','rider')),
  account_id INTEGER NOT NULL,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  payout_method TEXT NOT NULL, beneficiary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','PAID')),
  reject_reason TEXT, decided_by INTEGER REFERENCES users(id), decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Prevent duplicate open requests per account
CREATE UNIQUE INDEX uq_cashout_open ON cashout_requests(account_type, account_id)
  WHERE status IN ('PENDING','APPROVED');
CREATE TABLE cashout_proofs (
  id INTEGER PRIMARY KEY,
  cashout_id INTEGER NOT NULL UNIQUE REFERENCES cashout_requests(id),
  txn_reference TEXT NOT NULL, proof_path TEXT NOT NULL,
  amount_paise INTEGER NOT NULL, paid_at TEXT NOT NULL, uploaded_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE restaurant_payouts (
  id INTEGER PRIMARY KEY, restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  cashout_id INTEGER NOT NULL UNIQUE REFERENCES cashout_requests(id),
  amount_paise INTEGER NOT NULL, paid_at TEXT NOT NULL
);
CREATE TABLE rider_payouts (
  id INTEGER PRIMARY KEY, rider_id INTEGER NOT NULL REFERENCES users(id),
  cashout_id INTEGER NOT NULL UNIQUE REFERENCES cashout_requests(id),
  amount_paise INTEGER NOT NULL, paid_at TEXT NOT NULL
);

CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,    -- dedupe key
  user_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK (category IN ('transactional','promotional')),
  title TEXT NOT NULL, body TEXT NOT NULL, deep_link TEXT, order_id INTEGER,
  read_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_notif_user ON notifications(user_id, created_at);
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL DEFAULT 'webpush', endpoint TEXT NOT NULL UNIQUE,
  keys_json TEXT NOT NULL, device_label TEXT, failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY, actor_user_id INTEGER, actor_role TEXT,
  action TEXT NOT NULL, target_type TEXT, target_id TEXT, metadata TEXT, ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_actor ON audit_logs(actor_user_id, created_at);

CREATE TABLE otp_challenges (                 -- customer LOGIN otp only
  id INTEGER PRIMARY KEY, phone TEXT NOT NULL, otp_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_otp_phone ON otp_challenges(phone, created_at);
CREATE TABLE rider_verification_history (
  id INTEGER PRIMARY KEY, rider_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL, note TEXT, admin_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`
  },
  {
    id: '002_push_and_campaigns',
    sql: `
ALTER TABLE notifications ADD COLUMN kind TEXT NOT NULL DEFAULT 'order_status';
ALTER TABLE notifications ADD COLUMN push_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE notifications ADD COLUMN campaign_id INTEGER;
ALTER TABLE notifications ADD COLUMN clicked_at TEXT;
UPDATE notifications SET push_state = 'done';                 -- never re-push historical rows
CREATE INDEX idx_notif_push ON notifications(push_state, id);
CREATE INDEX idx_notif_campaign ON notifications(campaign_id);
CREATE TABLE push_deliveries (
  id INTEGER PRIMARY KEY,
  notification_id INTEGER NOT NULL REFERENCES notifications(id),
  subscription_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','gone','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, next_attempt_at TEXT, sent_at TEXT,
  UNIQUE (notification_id, subscription_id)
);
CREATE INDEX idx_pd_status ON push_deliveries(status, next_attempt_at);
CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, deep_link TEXT, image_path TEXT,
  audience_type TEXT NOT NULL, audience_param TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','scheduled','sending','completed','cancelled')),
  scheduled_at TEXT, targeted INTEGER NOT NULL DEFAULT 0, capped INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), completed_at TEXT
);
CREATE INDEX idx_campaign_status ON campaigns(status, scheduled_at);`
  },
  {
    id: '003_admin_mfa',
    sql: `
ALTER TABLE users ADD COLUMN mfa_secret TEXT;
ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa_last_step INTEGER NOT NULL DEFAULT 0;`
  },
  {
    id: '004_feature_gaps',
    sql: `
ALTER TABLE restaurants ADD COLUMN min_order_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE restaurants ADD COLUMN free_delivery_above_paise INTEGER;
ALTER TABLE restaurants ADD COLUMN operating_info TEXT;
ALTER TABLE restaurants ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0;
CREATE TABLE operating_expenses (
  id INTEGER PRIMARY KEY, spent_on TEXT NOT NULL, category TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0), note TEXT,
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_exp_date ON operating_expenses(spent_on);
CREATE TABLE order_ratings (
  order_id INTEGER PRIMARY KEY REFERENCES orders(id), restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  customer_id INTEGER NOT NULL REFERENCES users(id), stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5), comment TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`
  },
  {
    id: 'p2_001_rider_locations',
    sql: `
-- Priority 2: live tracking. ONE row per rider = the latest fix only (no location history is kept).
CREATE TABLE rider_locations (
  rider_id INTEGER PRIMARY KEY REFERENCES users(id),
  order_id INTEGER REFERENCES orders(id),          -- the active delivery the fix was reported for
  lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m REAL, heading REAL, speed_mps REAL,
  recorded_at TEXT NOT NULL,                       -- device time of the fix
  received_at TEXT NOT NULL                        -- server time; freshness (live / stale / offline) is judged on this
);`
  },
  {
    id: 'p2_002_rider_location_cleanup',
    sql: `
-- A rider's last position is deleted the moment they stop having an active delivery (delivered, cancelled, unassigned,
-- reassigned), whichever code path changed the order. Nothing depends on any screen being open.
CREATE TRIGGER trg_rider_location_cleanup AFTER UPDATE OF status, rider_id ON orders
BEGIN
  DELETE FROM rider_locations
   WHERE rider_id IN (OLD.rider_id, NEW.rider_id)
     AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.rider_id = rider_locations.rider_id AND o.status IN ('ACCEPTED','PREPARING','READY','PICKED_UP'));
END;`
  },
  {
    // Delivery-agent application and verification. The riders table is rebuilt only to widen the status CHECK
    // (SQLite cannot alter a CHECK); every existing column and row is copied unchanged.
    //   draft                    application started, not submitted (never eligible)
    //   pending                  = PENDING_VERIFICATION: submitted and complete, waiting for an admin (never eligible)
    //   approved                 admin approved: the only state that can go online and receive orders
    //   corrections_requested    admin asked for changes; the agent edits and resubmits
    //   rejected / suspended     not eligible
    //   reverification_required  previously approved, but the record lacks information now mandatory; may finish
    //                            deliveries already assigned, cannot go online or receive new ones until re-approved
    id: 'p3_001_rider_verification',
    sql: `
CREATE TABLE riders_new (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  verification_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (verification_status IN ('draft','pending','approved','rejected','corrections_requested','suspended','reverification_required')),
  is_online INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  photo_path TEXT, address TEXT, emergency_phone TEXT,
  vehicle_category TEXT, vehicle_make TEXT, vehicle_model TEXT, vehicle_reg_no TEXT,
  vehicle_photo_path TEXT, rc_path TEXT, licence_no TEXT, licence_path TEXT,
  insurance_no TEXT, insurance_path TEXT,
  legal_name TEXT, date_of_birth TEXT, phone_verified_at TEXT,
  id_type TEXT CHECK (id_type IS NULL OR id_type IN ('aadhaar','voter_id','passport','pan')),
  id_last4 TEXT, id_front_path TEXT, id_back_path TEXT,
  licence_expiry TEXT,
  payout_method TEXT CHECK (payout_method IS NULL OR payout_method IN ('upi','bank')),
  payout_upi_enc TEXT, payout_upi_hint TEXT,
  bank_holder TEXT, bank_account_enc TEXT, bank_account_last4 TEXT, bank_ifsc TEXT,
  consent_at TEXT, submitted_at TEXT, decided_at TEXT, decided_by INTEGER REFERENCES users(id), decision_note TEXT,
  correction_fields TEXT, application_updated_at TEXT
);
INSERT INTO riders_new (user_id, verification_status, is_online, last_seen_at, photo_path, address, emergency_phone, vehicle_category, vehicle_make,
  vehicle_model, vehicle_reg_no, vehicle_photo_path, rc_path, licence_no, licence_path, insurance_no, insurance_path)
SELECT user_id, verification_status, is_online, last_seen_at, photo_path, address, emergency_phone, vehicle_category, vehicle_make,
  vehicle_model, vehicle_reg_no, vehicle_photo_path, rc_path, licence_no, licence_path, insurance_no, insurance_path FROM riders;
DROP TABLE riders;
ALTER TABLE riders_new RENAME TO riders;
CREATE INDEX idx_riders_avail ON riders(verification_status, is_online);

-- Existing records lack the identity, phone-verification and payout details that are now mandatory, so:
-- approved -> reverification_required (active deliveries continue; no new ones), pending (never reviewed) -> draft.
-- Rejected, suspended and corrections_requested keep their status. Nothing is deleted.
INSERT INTO rider_verification_history (rider_id, status, note)
  SELECT user_id, 'reverification_required', 'System upgrade: identity, phone and payout details are now required. Please complete your application.' FROM riders WHERE verification_status = 'approved';
INSERT INTO rider_verification_history (rider_id, status, note)
  SELECT user_id, 'draft', 'System upgrade: please complete and submit your application.' FROM riders WHERE verification_status = 'pending';
UPDATE riders SET verification_status = 'reverification_required', is_online = 0 WHERE verification_status = 'approved';
UPDATE riders SET verification_status = 'draft' WHERE verification_status = 'pending';

ALTER TABLE rider_verification_history ADD COLUMN action TEXT;
ALTER TABLE rider_verification_history ADD COLUMN fields TEXT;

-- Verification decisions and the admin audit log are append-only.
CREATE TRIGGER trg_rvh_no_update BEFORE UPDATE ON rider_verification_history BEGIN SELECT RAISE(ABORT, 'verification history is append-only'); END;
CREATE TRIGGER trg_rvh_no_delete BEFORE DELETE ON rider_verification_history BEGIN SELECT RAISE(ABORT, 'verification history is append-only'); END;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;

-- Phone verification codes for delivery agents (separate from customer login codes so one can never be used as the other).
CREATE TABLE rider_phone_otps (
  id INTEGER PRIMARY KEY, rider_id INTEGER NOT NULL REFERENCES users(id), phone TEXT NOT NULL, otp_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_rpo_rider ON rider_phone_otps(rider_id, created_at);`
  },
  {
    // GPS-first delivery addresses. A customer's saved address always carries GPS coordinates the customer captured on the
    // phone while standing at the delivery point, plus the written details a delivery partner needs (PG/college, building,
    // block, floor, room, gate, landmark). Each order keeps its own copy of the destination (a snapshot), which the database
    // refuses to change once payment has started, so editing or deleting a saved address never moves an existing order.
    // reference_places is an EMPTY, admin-only directory for the official PG/college list the owner will supply later;
    // it is kept separate from customer coordinates and nothing substitutes one for the other.
    id: 'p4_001_gps_delivery_addresses',
    sql: `
CREATE TABLE customer_addresses (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT NOT NULL CHECK (label IN ('home','hostel','pg','college','other')),
  place_name TEXT, building TEXT, block TEXT, floor TEXT, room TEXT, entrance TEXT, landmark TEXT, instructions TEXT,
  delivery_location_id INTEGER REFERENCES delivery_locations(id),      -- optional link to an admin delivery area (keeps that area's fee)
  lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m REAL CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  captured_at TEXT NOT NULL,                                          -- when the phone produced the fix
  accuracy_acknowledged INTEGER NOT NULL DEFAULT 0,                   -- customer confirmed a reading worse than the configured limit
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_caddr_customer ON customer_addresses(customer_id, active);

-- order destination snapshot (dest_text, dest_lat, dest_lng, dest_maps_link, instructions already exist)
ALTER TABLE orders ADD COLUMN dest_address_id INTEGER;
ALTER TABLE orders ADD COLUMN dest_label TEXT;
ALTER TABLE orders ADD COLUMN dest_place_name TEXT;
ALTER TABLE orders ADD COLUMN dest_building TEXT;
ALTER TABLE orders ADD COLUMN dest_block TEXT;
ALTER TABLE orders ADD COLUMN dest_floor TEXT;
ALTER TABLE orders ADD COLUMN dest_room TEXT;
ALTER TABLE orders ADD COLUMN dest_entrance TEXT;
ALTER TABLE orders ADD COLUMN dest_landmark TEXT;
ALTER TABLE orders ADD COLUMN dest_accuracy_m REAL;
ALTER TABLE orders ADD COLUMN dest_captured_at TEXT;
ALTER TABLE orders ADD COLUMN dest_confirmed_at TEXT;
CREATE TRIGGER trg_order_destination_frozen BEFORE UPDATE OF dest_text, dest_lat, dest_lng, dest_maps_link, instructions, dest_address_id, dest_label,
  dest_place_name, dest_building, dest_block, dest_floor, dest_room, dest_entrance, dest_landmark, dest_accuracy_m, dest_captured_at, dest_confirmed_at, delivery_location_id ON orders
  WHEN OLD.status <> 'PAYMENT_PENDING'
BEGIN SELECT RAISE(ABORT, 'order destination is fixed once payment has started'); END;

CREATE TABLE reference_places (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pg','college','hostel','other')),
  address TEXT,
  lat REAL CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng REAL CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  entrance_notes TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','rejected')),
  verified_by INTEGER REFERENCES users(id), verified_at TEXT, source TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`
  },
  {
    // Two ways to choose where food goes:
    //   listed  = a PG, hostel or college from the admin-managed list (delivery_locations); its own delivery charge applies.
    //             The customer's own GPS point is optional (if missing, the location's map point is used).
    //   gps     = the existing GPS flow for places not on the list; the configurable fixed GPS charge applies.
    //             A gps address can never carry a list location, so it is never charged as a listed place.
    // customer_addresses is rebuilt only to allow lat/lng to be empty for listed addresses; every row is copied.
    id: 'p5_001_listed_locations_and_charges',
    sql: `
CREATE TABLE customer_addresses_new (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'gps' CHECK (kind IN ('gps','listed')),
  label TEXT NOT NULL CHECK (label IN ('home','hostel','pg','college','other')),
  place_name TEXT, building TEXT, block TEXT, floor TEXT, room TEXT, entrance TEXT, landmark TEXT, instructions TEXT,
  delivery_location_id INTEGER REFERENCES delivery_locations(id),
  lat REAL CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng REAL CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  accuracy_m REAL CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  captured_at TEXT,
  accuracy_acknowledged INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (kind <> 'gps' OR (lat IS NOT NULL AND lng IS NOT NULL AND captured_at IS NOT NULL AND delivery_location_id IS NULL)),
  CHECK (kind <> 'listed' OR delivery_location_id IS NOT NULL),
  CHECK ((lat IS NULL) = (lng IS NULL))
);
INSERT INTO customer_addresses_new (id, customer_id, kind, label, place_name, building, block, floor, room, entrance, landmark, instructions, delivery_location_id,
  lat, lng, accuracy_m, captured_at, accuracy_acknowledged, is_default, active, created_at, updated_at)
SELECT id, customer_id, CASE WHEN delivery_location_id IS NULL THEN 'gps' ELSE 'listed' END, label, place_name, building, block, floor, room, entrance, landmark, instructions,
  delivery_location_id, lat, lng, accuracy_m, captured_at, accuracy_acknowledged, is_default, active, created_at, updated_at FROM customer_addresses;
DROP TABLE customer_addresses;
ALTER TABLE customer_addresses_new RENAME TO customer_addresses;
CREATE INDEX idx_caddr_customer ON customer_addresses(customer_id, active);

-- managed list: stable reference from the owner's sheet (e.g. LOC_001) so re-imports update instead of duplicating
ALTER TABLE delivery_locations ADD COLUMN external_ref TEXT;
ALTER TABLE delivery_locations ADD COLUMN updated_at TEXT;
CREATE UNIQUE INDEX uq_delivery_locations_ref ON delivery_locations(external_ref) WHERE external_ref IS NOT NULL;

-- order snapshot additions: how the place was chosen, the list name at the time, and where the map point came from
ALTER TABLE orders ADD COLUMN dest_kind TEXT;
ALTER TABLE orders ADD COLUMN dest_location_name TEXT;
ALTER TABLE orders ADD COLUMN dest_coord_source TEXT;
DROP TRIGGER trg_order_destination_frozen;
-- earlier orders: the type is derived exactly from what they already store (nothing else is rewritten)
UPDATE orders SET dest_kind = CASE WHEN delivery_location_id IS NOT NULL THEN 'listed' WHEN dest_address_id IS NOT NULL THEN 'gps' END WHERE dest_kind IS NULL;
CREATE TRIGGER trg_order_destination_frozen BEFORE UPDATE OF dest_text, dest_lat, dest_lng, dest_maps_link, instructions, dest_address_id, dest_label,
  dest_place_name, dest_building, dest_block, dest_floor, dest_room, dest_entrance, dest_landmark, dest_accuracy_m, dest_captured_at, dest_confirmed_at, delivery_location_id,
  dest_kind, dest_location_name, dest_coord_source, delivery_paise ON orders
  WHEN OLD.status <> 'PAYMENT_PENDING'
BEGIN SELECT RAISE(ABORT, 'order destination is fixed once payment has started'); END;`
  }
];
