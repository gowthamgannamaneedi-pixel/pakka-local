# Customer login with WhatsApp OTP

Status: **code complete and tested; not live until the Meta setup below is done.** Without the WhatsApp settings the
server refuses to send (customers see “WhatsApp login is not available right now”). It never fakes or auto-accepts a code.

Only the **customer** login uses this. Restaurant, rider and Super Admin logins are unchanged (mobile/username + password).
Login codes are separate from pickup and delivery codes: different table, different checks. A login code can never
complete a delivery and a delivery code can never log anyone in (tested).

## SMS login codes now: StartMessaging (no own DLT) — status 20 Nov 2026

Set `OTP_PROVIDER=startmessaging`. StartMessaging sends through its own pre-registered DLT routes and shared approved
templates, so Pakka Local needs no DLT registration (provider's own statement). Pakka Local still makes and checks the code;
documented call (dashboard → API Docs): `POST https://api.startmessaging.com/otp/send`, header `X-API-Key`, body
`phoneNumber`, `templateId`, `variables {otp, appName, expiry}`; status: `GET /messages/:id`.

Customers receive: *"Your Pakka Local OTP is 123456, valid for 5 minutes. Do not share this code with anyone. Powered by Start Messaging."*

| Step | Status |
|---|---|
| Account + KYC (Udyam) | Approved; ₹10 balance |
| App code | Done and tested with a simulated StartMessaging (not deployed) |
| Real SMS on a phone | Pending: needs the API key in hPanel and a deploy |

| Setting (hPanel, server only) | Value |
|---|---|
| `OTP_PROVIDER` | `startmessaging` |
| `STARTMESSAGING_API_KEY` | StartMessaging → API Keys (secret: never in chat, GitHub or the app) |
| `STARTMESSAGING_TEMPLATE_ID` | optional; default `6990f1b1-6a28-4cb4-a8ed-35a450a6b59d` (app name + validity) |
| `STARTMESSAGING_APP_NAME` | optional; default `Pakka Local` |

Cost: ₹0.25 per SMS (provider's price; check GST on their invoice). Top up in StartMessaging → Add Money.
The login screens switch their wording to SMS automatically (`/api/public/config` → `loginChannel`).
When WhatsApp (Fast2SMS) is approved, switch `OTP_PROVIDER` to `fast2sms`.

## Chosen provider: Fast2SMS (WhatsApp) — status 20 Nov 2026

Set `OTP_PROVIDER=fast2sms`. Fast2SMS is an official Meta WhatsApp provider; Pakka Local still makes and checks the code,
Fast2SMS only delivers it with Meta's approved authentication template (documented route
`POST https://www.fast2sms.com/dev/whatsapp/v26.0/{phone_number_id}/messages`, API key in the `Authorization` header).

| Step | Status |
|---|---|
| Fast2SMS account | Created (₹50 free credit) |
| WhatsApp number +91 89771 02457 | Connected in Fast2SMS (moved from MSG91) — business shown as *Unverified* |
| Login-code template `pakka_login_code` | **Blocked by Meta**: "This WhatsApp Business account does not have permission to create message template" — Meta allows authentication templates only after **business verification** |
| App code | Done and tested with a simulated Fast2SMS (not yet deployed) |

To finish: complete Meta business verification (business.facebook.com → Settings → Security Centre → Start verification),
then submit the template again (Fast2SMS → WhatsApp Manager → Templates → Add Template → Authentication → Copy code,
name `pakka_login_code`, security line on, expiry 5 min). When it shows **APPROVED**, add the settings below.

| Setting (hPanel, server only) | Value |
|---|---|
| `OTP_PROVIDER` | `fast2sms` |
| `FAST2SMS_API_KEY` | Fast2SMS → API Key (secret: never in chat, GitHub or the app) |
| `FAST2SMS_WA_PHONE_NUMBER_ID` | Fast2SMS → WhatsApp Manager → Numbers → *Phone Number ID* |
| `FAST2SMS_WA_TEMPLATE_NAME` | `pakka_login_code` |
| `FAST2SMS_WA_TEMPLATE_LANG` | `en` (as shown for the template) |
| `FAST2SMS_WA_API_VERSION` | optional, default `v26.0` |
| `FAST2SMS_WA_COPY_BUTTON` | `1` (default; template has a Copy code button) |

Then remove `TEST_OTP_CODE`, `TEST_OTP_PHONES`, `ALLOW_TEST_OTP`, redeploy, and test with a real phone.
Cost (Fast2SMS dashboard): Authentication ₹0.25 per delivered message, no monthly/setup fee; ₹100 minimum top-up + 18% GST.

## Alternative provider: MSG91 (WhatsApp)

Set `OTP_PROVIDER=msg91`. MSG91 sends the same WhatsApp authentication template from the WhatsApp number you connect in
your MSG91 account (the code is generated, checked and limited by Pakka Local's server, exactly as described below).

### What you need
1. **MSG91 account** at <https://msg91.com> (sign up, complete KYC for Pakka Local).
2. **A phone number for WhatsApp Business** that is not already registered in the WhatsApp or WhatsApp Business app.
3. In MSG91 → **WhatsApp** → connect that number. MSG91 walks you through Meta's sign-up (Facebook Business Manager
   login and number verification); you don't need to build anything in Meta's developer site yourself.
4. In MSG91 → WhatsApp → **Templates** → create a template with category **Authentication** and a **Copy code** button
   (e.g. name `pakka_login_code`, language English). Wait until it shows *Approved*.
5. In MSG91 → **API / Authkey** → create an authkey (restrict it to your server's IP if MSG91 offers that).

### Settings in hPanel (server only; never in chat, GitHub or the app)
| Name | Value |
|---|---|
| `OTP_PROVIDER` | `msg91` |
| `MSG91_AUTH_KEY` | your MSG91 authkey |
| `MSG91_WHATSAPP_NUMBER` | the connected WhatsApp number with country code, e.g. `919876543210` |
| `MSG91_WHATSAPP_TEMPLATE` | the approved template name, e.g. `pakka_login_code` |
| `MSG91_WHATSAPP_TEMPLATE_LANG` | template language code shown in MSG91 (default `en`) |
| `MSG91_WHATSAPP_NAMESPACE` | only if MSG91 shows a namespace for the template |
| `MSG91_WHATSAPP_COPY_BUTTON` | `1` (default) with a Copy code button, `0` without |

Then remove `TEST_OTP_CODE`, `TEST_OTP_PHONES`, `ALLOW_TEST_OTP`, and redeploy.

### Cost (check MSG91's current price list before you start)
- Meta's charge for each authentication (login code) message in India, about ₹0.12–0.15 per code, plus GST.
- MSG91's platform fee per WhatsApp number (reported around ₹500/month; MSG91 has offered free first months).
- MSG91 says it passes Meta's message rates through without markup.

### Testing
- After the settings are in place, log in on `/user/` with your own WhatsApp number; the code should arrive on WhatsApp.
- MSG91's dashboard shows each message's delivery. (The app's code screen shows “Sent on WhatsApp”; live
  delivered/failed status on the code screen is available with the direct Meta setup below, not with MSG91 yet.)
- Authentication messages can't be tested from one WhatsApp Business account to another: use a normal WhatsApp account.
- MSG91's help page notes Meta limits authentication templates for some low-tier accounts. If the template can't be
  sent, ask MSG91 support to confirm your account is eligible.

The direct Meta setup below (`OTP_PROVIDER=whatsapp`) stays available as an alternative.

## How it works

1. Customer enters their WhatsApp number (+91, 10 digits, must start with 6–9) and taps **Send WhatsApp OTP**.
2. The server makes a random 6-digit code (`crypto.randomInt`), stores only a keyed hash of it, cancels any older code
   for that number, and sends it on WhatsApp (through MSG91, or Meta's Cloud API directly) using your approved
   **authentication template**.
3. The code screen shows the number with **Edit**, a resend countdown, and the delivery state from Meta
   (sent → delivered, or “WhatsApp could not deliver the code”).
4. The 6th digit submits automatically. A right code logs in; the code is used up at once.
5. New number → a new customer account, then “What should we call you?” (name required). Existing number → the same
   account (no duplicates).

| Rule | Default | Setting |
|---|---|---|
| Code expiry | 5 min | `OTP_TTL_SEC` (60–900) |
| Wrong tries per code | 5, then the code is cancelled | `OTP_MAX_ATTEMPTS` (3–10) |
| Wait before resend | 45 s | `OTP_RESEND_SEC` (30–300) |
| Codes per number per hour | 5 | `OTP_MAX_PER_HOUR` (3–20) |
| Temporary block | after 10 wrong codes in an hour, 30 min | `OTP_BLOCK_AFTER_FAILS`, `OTP_BLOCK_MIN` |
| Per network address | 10 code requests / 20 checks per 15 min | fixed |

Codes are never logged or returned by the API. Send failures are logged with Meta's error code only.

## Environment variables (server only, hPanel → Environment variables; never in the frontend, GitHub or chat)

| Name | Value |
|---|---|
| `OTP_PROVIDER` | `whatsapp` |
| `WHATSAPP_ACCESS_TOKEN` | permanent System User token (see step 5) |
| `WHATSAPP_PHONE_NUMBER_ID` | the *Phone number ID* (not the phone number) from WhatsApp → API Setup |
| `WHATSAPP_OTP_TEMPLATE_NAME` | e.g. `pakka_login_code` |
| `WHATSAPP_OTP_TEMPLATE_LANG` | the template's language code, e.g. `en_US` (or `en` if you chose “English”) |
| `WHATSAPP_OTP_COPY_BUTTON` | `1` (default) if the template has a *Copy code* button, `0` if not |
| `WHATSAPP_API_VERSION` | optional, default `v21.0` |
| `WHATSAPP_APP_SECRET` | App settings → Basic → App secret (checks delivery reports are really from Meta) |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | any long random text you choose; type the same in Meta's webhook setup |

Remove `TEST_OTP_CODE`, `TEST_OTP_PHONES` and `ALLOW_TEST_OTP` when you switch. With `APP_ENV=production` the server
refuses to start with the fixed test code at all.

## Setup in Meta (one time, by the business owner)

1. **Meta developer account**: <https://developers.facebook.com> → log in with Facebook → register as a developer.
2. **App**: My Apps → Create app → use case “Other” → type **Business** → connect it to your Meta Business portfolio
   (create one at <https://business.facebook.com> if you don't have it). Add the **WhatsApp** product.
3. **Test setup (free, for staging)**: WhatsApp → API Setup gives a **test phone number** and a temporary token (24 h).
   Under *To*, add up to **5 tester numbers**; each tester confirms with a code Meta sends them. Only these numbers can
   receive messages from the test number (others get “not added as a WhatsApp test recipient”).
4. **Authentication template**: WhatsApp Manager → Message templates → Create → category **Authentication** →
   “Copy code” button → name it (e.g. `pakka_login_code`), choose the language, optionally add the security
   recommendation and “expires in 5 minutes” footer → submit. Authentication templates are usually approved quickly.
5. **Permanent token**: Business settings → Users → System users → add an admin system user → Assign assets: your app
   (full control) and your WhatsApp account → Generate token for the app with `whatsapp_business_messaging` and
   `whatsapp_business_management`, expiry *Never*. Put it in `WHATSAPP_ACCESS_TOKEN` in hPanel.
6. **Delivery reports (webhook)**: WhatsApp → Configuration → Webhook → Callback URL
   `https://<your site>/api/whatsapp/webhook`, Verify token = your `WHATSAPP_WEBHOOK_VERIFY_TOKEN` → Verify and save →
   subscribe to the **messages** field. (Set the two webhook variables and redeploy first, or Meta's check fails.)

## Testing on staging

1. Do steps 1–6 with the test number. Add your testers' real WhatsApp numbers as test recipients.
2. In hPanel set the variables above and `OTP_PROVIDER=whatsapp`, put the same real numbers in
   `SANDBOX_PAYMENT_PHONES` (so they can place test orders), remove the fixed test-code variables, redeploy.
3. Log in on `/user/` with a tester number: the code arrives on WhatsApp; the screen shows “Delivered”.
   Try: a wrong code (tries left), resend before the countdown (refused), the old code after a resend (refused),
   a number that is not a test recipient (clear message).
4. The seeded staging test accounts (`+915…`) are not real WhatsApp numbers and cannot use WhatsApp login. Approved
   testers can keep using the staging email login, which stays staging-only.

## Production activation

1. **Business verification** of your Meta Business portfolio (documents for Pakka Local).
2. Add a **real business phone number** to the WhatsApp account (one that is not already used in the WhatsApp app),
   verify it, and get the display name approved.
3. Add a **payment method** in WhatsApp Manager: Meta charges per authentication message (see Meta's current pricing
   for India). New accounts start with a daily messaging limit that rises as you send good-quality messages.
4. Make sure the template is approved for that account, use the permanent token, the real number's Phone number ID,
   `APP_ENV=production`, `OTP_PROVIDER=whatsapp`, and the webhook pointing at the production site.
5. Test with your own number before announcing.

## Errors customers can see

| Situation | Message |
|---|---|
| Not a 10-digit Indian mobile | Enter a valid 10-digit mobile number |
| Meta says the number can't get WhatsApp messages | We couldn't send a WhatsApp message to this number… |
| Test number, recipient not added | This number is not added as a WhatsApp test recipient yet |
| Meta busy / limits | WhatsApp is busy right now. Please try again in a minute |
| Not configured / token expired / template missing | WhatsApp login is not available right now |
| Delivery failed after sending (webhook) | WhatsApp could not deliver the code to this number… |
| Expired / replaced / too many tries / blocked | shown with what to do next |
