# Background notifications: setup

Pakka Local sends every notification through one queue (`push_deliveries`) to two kinds of device:

| Device | Channel | Works when the app is closed? |
|---|---|---|
| Pakka Rider Android app (1.4+) | Firebase Cloud Messaging (FCM) | Yes, once Firebase is set up (below). Also, while the rider is online, the app's own foreground service keeps ringing for offers. |
| Browsers / installed web apps (customer, restaurant, rider, admin) | Web Push (VAPID) | Yes on Android Chrome/Edge/Firefox and desktop browsers while the browser is allowed to run. iPhone: only for the web app added to the Home Screen, iOS 16.4+. |

Every event has a unique ID, so a notification is never stored or sent twice. Dead device tokens / browser subscriptions are removed automatically (HTTP 404/410 or FCM `UNREGISTERED`).

## 1. Web Push (already working)

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` on the server (already done on staging). Users turn notifications on from the bell / Account screen.

## 2. Firebase for the Pakka Rider app (one-time, by the project owner)

The code is in place but stays switched off until both files below exist. Nothing breaks without them.

1. Go to <https://console.firebase.google.com> → **Add project** (Google Analytics not needed).
2. In the project: **Add app → Android**. Package name: `com.pakkalocal.rider.staging`. Register.
3. Download **google-services.json** and put it at `mobile/rider-android/android/app/google-services.json`. (It contains no secret key, but keep it out of public repositories anyway; it is git-ignored.)
4. Rebuild the APK (`gradlew assembleDebug` or `assembleRelease`). The build applies Firebase only when that file exists.
5. In Firebase: **Project settings → Service accounts → Generate new private key**. This JSON file **is a secret**.
6. Upload it to the server, never to GitHub and never into chat:
   - Put it in the server's secrets folder as `fcm-service-account.json` (same folder as the other secret files), **or**
   - set the environment variable `FCM_SERVICE_ACCOUNT_FILE` to its full path.
7. Restart / redeploy the backend. `GET /api/push/key` then reports `"fcm": true`.
8. Open the rider app, sign in, go online. The app registers its device token (`POST /api/push/fcm`); signing out removes it.

## Environment variables

| Name | Purpose |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push |
| `FCM_SERVICE_ACCOUNT_FILE` | Optional path to the Firebase service-account JSON (default: `<secrets dir>/fcm-service-account.json`) |

## Which events notify whom

| Event | Customer | Restaurant | Rider |
|---|---|---|---|
| Order placed (paid) | ✓ | ✓ new order (rings) | |
| Accepted / preparing / ready | ✓ | | |
| Rejected / cancelled | ✓ (+ refund started) | ✓ cancelled | ✓ cancelled |
| Delivery offer | | | ✓ (rings) |
| Rider assigned | ✓ | | |
| Picked up | ✓ | ✓ | |
| Arriving (rider within ~300 m) | ✓ once | | |
| Delivered | ✓ | | |
| Refund stages (UPI asked, approved, paid with UTR, rejected, failed) | ✓ | | |
| Chat message | ✓ from rider | | ✓ from customer |

Tapping a notification opens the right screen (order tracking, delivery, restaurant order).

## Honest limits

- **Force stop**: if someone taps *Force stop* in Android settings, Android blocks all of that app's notifications (FCM included) until the app is opened again. Nothing an app can do changes this.
- **Phone makers' battery savers** (Xiaomi/Redmi/POCO, OPPO, realme, vivo, OnePlus, Huawei/Honor, some Samsung): may delay or drop background work. The rider app's *Background check* shows what to allow (battery unrestricted, auto-launch, notifications, location).
- **Browsers** decide when web push is delivered; a browser that is fully closed or killed by the phone may deliver late. There is no guaranteed delivery on the web.
- **iPhone**: web push only for the Home-Screen web app on iOS 16.4+, and no custom ringing sound. There is no iOS rider app.
- **Data-saver / Doze**: high-priority FCM messages usually arrive within seconds; Android can still delay them in deep Doze if the app is used rarely.
