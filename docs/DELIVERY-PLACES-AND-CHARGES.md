# Delivery places (PG / hostel / college list) and delivery charges

Branch `location-list-and-charges`, built on the GPS-address work (commit fb380fb). Backup taken first:
`backups/pakka-local-before-location-list-20261113-1514.tar.gz`. Nothing was deployed and no live data was changed.

## 1. What customers see

At checkout, two clearly separate choices (switchable until the order is confirmed):

- **Select PG / hostel / college**: a searchable list of the places Pakka Local delivers to (active places only),
  each showing its delivery charge. After choosing a place the customer adds block, floor, room, building, gate,
  landmark and instructions. Adding their own GPS point is optional; without it, the place's map point is used for the
  delivery partner's navigation. If the customer already saved that place, it is reused instead of duplicated.
- **Use my GPS location**: the existing GPS flow, unchanged (stand at the spot, capture, confirm, details). The screen
  shows the fixed charge for places not on the list.

The bill shows which charge applies ("Stanza Living Launceston House ₹25" or "Fixed charge for places not on the list
₹35") before payment. The order still needs the "Deliver to this point" confirmation.

## 2. How charges are calculated (server only)

- The browser sends only the saved address id. The server loads the customer's own address and decides:
  - **listed address** → that place must still be active → **the place's own charge** (`delivery_locations.delivery_fee_paise`).
  - **GPS address** → **the fixed GPS charge** (setting `gps_delivery_fee_paise`). A GPS address can never be linked to a
    listed place, so it can never be charged as one.
- Existing rules still apply on top: a restaurant's free-delivery threshold, surge rules (per place, or all-area).
- Any charge, total, place id or type sent by the browser is ignored or refused (tested).
- The order stores its own copy: `delivery_paise` (the charge actually applied), `delivery_location_id`, `dest_kind`
  (listed/gps), `dest_location_name` (the name at the time), `dest_coord_source` (customer_gps/location). The database
  refuses changes to these once payment has started. Changing a charge later affects new orders only.

## 3. Admin: Delivery places and charges (More → Delivery places and charges)

- **Charge for GPS addresses not on the list**: shown at the top with a Change button.
- **Places table**: search (name, area, address, reference), filter Active/Inactive, charge with a Change button,
  map point yes/no, how many saved addresses and orders use it, an on/off switch, Edit and History.
- **Add / Edit**: name, type, address, area, contact, charge (₹), road distance (km, for time estimates), map point
  (latitude/longitude, both or neither), Google Maps link (https), sheet reference, active.
- **Validation**: charge ₹0–₹1,000 in whole paise, never negative; duplicate names refused (case and punctuation
  ignored); duplicate sheet references refused; coordinates in range; (0,0) refused.
- **Deactivate** instead of delete: the place disappears for customers, saved addresses stay, new orders to it are
  refused with a clear message; past orders are untouched.
- **Audit**: every create, edit and charge change is logged with the admin, time and the exact old → new values
  (History button). Changes to the GPS charge and other settings now also log old → new values.

### Importing the owner's spreadsheet

More → Delivery places and charges → **Import from spreadsheet (CSV)**. In Google Sheets: File → Download → CSV.
Columns used: `Location_ID` (required, used to match rows on re-import), `Place_Name` (required), `Full_Address`
(required), `Category`, `Area_Locality`, `Latitude`, `Longitude`, `Est_Road_Dist_km`, `Google_Maps_Link`, and the
**charge column you choose** (the sheet has `Fee_Straight_10_INR` and `Fee_Road_10_INR`; the app does not pick one).
A preview shows new / updated / unchanged / problem rows before anything is saved. Re-importing updates places by
`Location_ID` and never duplicates them; charges of existing places change only if "Also change the charge…" is ticked.

## 4. Database migration `p5_001_listed_locations_and_charges`

- `customer_addresses` rebuilt (all rows copied) to add `kind` ('gps' | 'listed') and allow empty GPS for listed
  addresses. Rules enforced by the database: a GPS address must have coordinates and no place; a listed address must
  have a place. Existing addresses linked to a place became 'listed', the rest 'gps'.
- `delivery_locations`: `external_ref` (unique when set) and `updated_at`.
- `orders`: `dest_kind`, `dest_location_name`, `dest_coord_source`; existing orders got `dest_kind` derived from what
  they already stored; nothing else rewritten. The destination freeze trigger now also covers these and `delivery_paise`.

## 5. Tests

| Run | Result |
| --- | --- |
| `node --test test/*.test.js`, Node 22, real dependencies | **116 tests, 116 passed** (11 new for this feature) |
| Local database before/after | 33 of 33 existing orders keep charge, total, place and destination; ledger, earnings, payments, users, restaurants, menu unchanged |
| Real Chrome (headless), 390 px and 1280 px, simulated GPS | Admin imports the owner's sheet via the screen (preview → 100 places created; re-import → 100 unchanged), search, GPS charge ₹35, place charge changed (negative refused), history; customer finds a PG by search, adds room details, sees ₹25, pays; switches to GPS and sees ₹35; switches back; paid order keeps ₹25 after the admin raises the place to ₹45; rider sees the place name and navigates to the place's map point. No console errors. |
| GPS regression (earlier end-to-end script, unchanged) | All steps pass |
| Not done | Real phones, production data, real payments |

Charges used in tests (₹20/₹25/₹15/₹35, and the sheet's road-fee column in the local database) are test values only.
