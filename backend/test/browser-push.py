"""Service-worker push behaviour in real Chromium (events injected via DevTools; real FCM is unreachable from CI)."""
import json, sys, time, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:8123'; fails = []
def check(n, c):
    print(('PASS ' if c else 'FAIL ') + n); (not c) and fails.append(n)
def notifs(page): return page.evaluate("navigator.serviceWorker.ready.then(r => r.getNotifications()).then(l => l.map(n => ({title: n.title, tag: n.tag, body: n.body, interaction: n.requireInteraction, data: n.data})))")
with sync_playwright() as p:
    b = p.chromium.launch(channel='chromium'); ctx = b.new_context(viewport={'width': 390, 'height': 844}); ctx.grant_permissions(['notifications'], origin=BASE); page = ctx.new_page(); other = ctx.new_page()
    regs = {}; cdp = ctx.new_cdp_session(page); cdp.send('ServiceWorker.enable')
    cdp.on('ServiceWorker.workerRegistrationUpdated', lambda e: [regs.update({r['scopeURL']: r['registrationId']}) for r in e['registrations']])
    page.goto(f'{BASE}/rider/'); page.wait_for_selector('input[name=phone]'); page.evaluate("navigator.serviceWorker.ready"); time.sleep(0.5)
    rid = next(iter(regs.values())); check('service worker registered', bool(rid))
    deliver = lambda d: cdp.send('ServiceWorker.deliverPushMessage', {'origin': BASE, 'registrationId': rid, 'data': json.dumps(d)})
    offer = {'title': 'New delivery offer', 'body': 'A delivery is available. Open the app to view details.', 'url': '/rider/#/jobs', 'tag': 'offer:1:9', 'nid': 1, 't': 'x' * 24, 'kind': 'rider_offer', 'urgent': True, 'click': '/api/push/click'}
    # 1) app FOREGROUND on the rider portal -> no system notification (the in-app popup + ringing handle it)
    deliver(offer); time.sleep(0.8); check('foreground: system notification suppressed (in-app alert handles it)', len(notifs(page)) == 0)
    # 2) app CLOSED (no rider portal tab open) -> real system notification is shown
    page.goto(f'{BASE}/healthz'); time.sleep(0.4); deliver(offer); time.sleep(0.8); n = notifs(page)
    check('closed app: notification shown by service worker', len(n) == 1 and n[0]['title'] == 'New delivery offer')
    check('urgent offers stay on screen until acted on', n and n[0]['interaction'] is True)
    check('payload carries only a generic message + deep link', n and 'rider/#/jobs' in n[0]['data']['url'] and all(x not in json.dumps(n[0]['data']) for x in ['+91', 'Hostel', 'otp']))
    deliver(offer); time.sleep(0.6); check('same event tag replaces rather than duplicates', len(notifs(page)) == 1)
    # 3) a customer tab being open must NOT suppress a rider alert (different portal)
    other.goto(f'{BASE}/user/'); other.wait_for_selector('.welcome, .splash'); deliver({**offer, 'tag': 'offer:2:9', 'nid': 2}); time.sleep(0.8)
    check('another portal being open does not swallow the alert', len(notifs(page)) == 2)
    # 4) order status push for a customer shows (non-urgent) and then foreground customer tab suppresses next one
    deliver({'title': 'Order picked up', 'body': 'PL1 is on its way.', 'url': '/user/orders/PL1', 'tag': 'st:1:PICKED_UP', 'nid': 3, 't': 'y' * 24, 'kind': 'order_status', 'click': '/api/push/click'}); time.sleep(0.5)
    check('foreground customer tab suppresses duplicate status push', all(x['title'] != 'Order picked up' for x in notifs(page)))
    # 5) push enable button (needs a signed-in staff session)
    other.goto(f'{BASE}/rider/'); other.wait_for_selector('input[name=phone]')
    print('\nFAILED:', fails or 'none'); b.close(); sys.exit(1 if fails else 0)
