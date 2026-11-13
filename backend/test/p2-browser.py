"""Priority 2 browser check (real Chromium, mocked GPS). Run via: bash test/run-p2-browser.sh
Leaflet itself is replaced by a tiny recording stub here, so this verifies OUR tracking code and data flow, not map rendering or tiles."""
import json, re, time, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:8123'; PW = 'demo-pass-12345'; fails = []; PUMP = [None]
def check(name, cond):
    print(('PASS ' if cond else 'FAIL ') + name)
    if not cond: fails.append(name)
def api(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
def wait(fn, timeout=12):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if fn(): return True
        except Exception: pass
        (PUMP[0].wait_for_timeout(250) if PUMP[0] else time.sleep(0.25))
    return False
STUB = """window.__L={maps:0,tiles:[],marks:{}};window.L={map:(el)=>{__L.maps++;el.setAttribute('data-map','1');const m={setView:()=>m,panTo:()=>m,fitBounds:()=>m,removeLayer:(x)=>{x.gone=true}};return m},
 tileLayer:(u,o)=>{__L.tiles.push(u);return{addTo:()=>{}}},latLngBounds:(p)=>({pad:()=>p}),
 circleMarker:(ll)=>{const k={ll,style:{},gone:false,addTo:()=>{(__L.list=__L.list||[]).push(k);return k},setLatLng:(x)=>{k.ll=x},setStyle:(s)=>{k.style=s},bindTooltip:(t)=>{k.tip=t},getLatLng:()=>k.ll};return k}};"""
def session(ctx, portal, sess):
    ctx.add_init_script(f"localStorage.setItem('pl.session.{portal}', {json.dumps(json.dumps(sess))});")

_, admin = api('POST', '/api/auth/login', {'portal': 'admin', 'phone': '+919000000000', 'password': 'admin-pass-123456'})
_, rest = api('POST', '/api/auth/login', {'portal': 'restaurant', 'phone': '+919000010001', 'password': PW})
_, rider = api('POST', '/api/auth/login', {'portal': 'rider', 'phone': '+919000020001', 'password': PW})
api('POST', '/api/rider/online', {'online': True}, rider['token'])
api('POST', '/api/auth/customer/otp/request', {'phone': '+919811111111'}); otp = json.loads(urllib.request.urlopen(BASE + '/__test/otp').read())['otp']
_, cust = api('POST', '/api/auth/customer/otp/verify', {'phone': '+919811111111', 'otp': otp})
_, rs = api('GET', '/api/public/restaurants'); rid = [x for x in rs['restaurants'] if x['name'].startswith('Spice')][0]['id']; _, menu = api('GET', f'/api/public/restaurants/{rid}/menu')
st, o = api('POST', '/api/customer/orders', {'restaurant_id': rid, 'items': [{'id': menu['items'][0]['id'], 'qty': 1}], 'lat': 17.41, 'lng': 78.51}, cust['token']); code = o['order_code']
api('POST', f'/api/customer/payments/sandbox/{code}/complete', {'outcome': 'success'}, cust['token'])
_, ro = api('GET', '/api/restaurant/orders', None, rest['token']); oid = [x for x in ro['orders'] if x['order_code'] == code][0]['id']
api('POST', f'/api/restaurant/orders/{oid}/accept', {}, rest['token'])

with sync_playwright() as p:
    b = p.chromium.launch()
    def ctx_for(portal, sess, **kw):
        c = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block', **kw); session(c, portal, sess)
        c.route('**/vendor/leaflet/leaflet.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body=STUB)); c.route('**/vendor/leaflet/leaflet.css', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
        c.route(re.compile(r'^https?://(?!127\.0\.0\.1)'), lambda r: r.abort())        # no internet in CI: fonts and map tiles are not fetched
        pg = c.new_page(); pg.on('pageerror', lambda e: (print('PAGE ERROR', e), fails.append(f'js error: {e}'))); return c, pg
    rc, rpage = ctx_for('rider', rider, permissions=['geolocation'], geolocation={'latitude': 17.385, 'longitude': 78.4867})
    rpage.goto(f'{BASE}/rider/'); rpage.wait_for_selector('#nav'); PUMP[0] = rpage
    rpage.wait_for_timeout(3000)
    check('rider with no assigned delivery sends no location', api('GET', '/api/tracking/admin/active', None, admin['token'])[1]['deliveries'] == [])
    check('rider claims the order', api('POST', f'/api/rider/orders/{oid}/accept', {}, rider['token'])[0] == 200)
    loc = lambda: api('GET', '/api/tracking/admin/active', None, admin['token'])[1]['deliveries'][0]['location']
    check('rider page starts sharing once a delivery is assigned (position reaches the server)', wait(lambda: loc() and abs(loc()['lat'] - 17.385) < 1e-6))
    check('rider sees the "Sharing live location" notice', wait(lambda: 'Sharing live location' in rpage.inner_text('#view')))
    t0 = time.time(); rc.set_geolocation({'latitude': 17.39, 'longitude': 78.49})
    check('a new position is sent within ~10 s of the phone moving', wait(lambda: abs(loc()['lat'] - 17.39) < 1e-6, 14)); print(f'   (update arrived after {time.time() - t0:.1f}s)')
    api('POST', f'/api/restaurant/orders/{oid}/ready', {}, rest['token']); pk = [x for x in api('GET', '/api/restaurant/orders', None, rest['token'])[1]['orders'] if x['id'] == oid][0]['pickup_otp']
    check('customer cannot see the rider before pickup', api('GET', f'/api/tracking/orders/{code}', None, cust['token'])[1]['tracking'] is False)
    api('POST', f'/api/rider/orders/{oid}/pickup', {'otp': pk}, rider['token'])

    cc, cpage = ctx_for('user', cust); PUMP[0] = cpage; cpage.goto(f'{BASE}/user/#/orders/{code}')
    check('customer order page shows the tracking card', wait(lambda: cpage.query_selector('#trkmap') is not None))
    check('customer sees status "Live"', wait(lambda: cpage.inner_text('#trkst').strip() == 'Live'))
    check('map is created once with the configured tiles, rider + destination markers placed', wait(lambda: cpage.evaluate("__L.maps===1 && __L.tiles.length===1 && (__L.list||[]).filter(k=>!k.gone).length===2")))
    rc.set_geolocation({'latitude': 17.4, 'longitude': 78.5})
    check('customer marker follows the rider', wait(lambda: cpage.evaluate("(__L.list||[]).some(k=>Math.abs((k.ll[0]??k.ll.lat)-17.4)<1e-6)"), 20))
    check('the 2-second page refresh does not rebuild the map', cpage.evaluate('__L.maps') == 1)

    ac, apage = ctx_for('admin', admin); apage.goto(f'{BASE}/admin/#/map')
    check('admin live-deliveries screen lists the order with a Live chip', wait(lambda: code in apage.inner_text('#admlist') and 'Live' in apage.inner_text('#admlist')))
    check('admin map shows rider and drop-off markers', apage.evaluate("['Rahul','Drop-off'].every(t=>(__L.list||[]).some(k=>(k.tip||'').startsWith(t)))"))

    rpage.close()                                             # rider closes the browser: no more updates
    check('after the rider app closes, the customer is told the position is old (not shown as live)', wait(lambda: cpage.inner_text('#trkst').startswith('Last seen'), 50))
    rpage = rc.new_page(); rpage.goto(f'{BASE}/rider/'); rpage.wait_for_selector('#nav')
    check('tracking resumes when the rider reopens the app', wait(lambda: cpage.inner_text('#trkst').strip() == 'Live', 20))
    dcode = api('GET', f'/api/customer/orders/{code}', None, cust['token'])[1]['delivery_otp']
    check('delivery completes', api('POST', f'/api/rider/orders/{oid}/deliver', {'otp': dcode}, rider['token'])[0] == 200)
    check('rider page stops sharing after delivery (server holds no position)', wait(lambda: api('GET', '/api/tracking/admin/active', None, admin['token'])[1]['deliveries'] == []))
    rpage.wait_for_timeout(9000); check('no position is stored after delivery even though the rider app is still open', api('POST', '/api/tracking/rider/location', {'lat': 1, 'lng': 1}, rider['token'])[0] == 409)
    check('customer tracking card is removed after delivery', wait(lambda: cpage.query_selector('#trkmap') is None))

    # Leaflet not installed (no stub): a clear message instead of a broken map
    def bare(portal, sess, url):
        c = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block'); session(c, portal, sess); c.route(re.compile(r'^https?://(?!127\.0\.0\.1)'), lambda r: r.abort())
        pg = c.new_page(); pg.on('pageerror', lambda e: (print('PAGE ERROR', e), fails.append(f'js error: {e}'))); pg.goto(url); return pg
    npage = bare('admin', admin, f'{BASE}/admin/#/map'); PUMP[0] = npage
    check('admin without the map library sees the exact reason, and the delivery list still works', wait(lambda: 'Leaflet' in npage.inner_text('#admap') and 'No deliveries are in progress' in npage.inner_text('#admlist')))
    check('rider stop request left no stored position', api('GET', '/api/tracking/admin/active', None, admin['token'])[1]['deliveries'] == [])
    # permission denied
    st, o2 = api('POST', '/api/customer/orders', {'restaurant_id': rid, 'items': [{'id': menu['items'][0]['id'], 'qty': 1}], 'lat': 17.41, 'lng': 78.51}, cust['token'])
    api('POST', f"/api/customer/payments/sandbox/{o2['order_code']}/complete", {'outcome': 'success'}, cust['token'])
    oid2 = [x for x in api('GET', '/api/restaurant/orders', None, rest['token'])[1]['orders'] if x['order_code'] == o2['order_code']][0]['id']
    api('POST', f'/api/restaurant/orders/{oid2}/accept', {}, rest['token']); api('POST', f'/api/rider/orders/{oid2}/accept', {}, rider['token'])
    rpage.close(); rc.close(); dc, dpage = ctx_for('rider', rider)        # no geolocation permission granted
    PUMP[0] = dpage; dpage.goto(f'{BASE}/rider/'); dpage.wait_for_selector('#nav')
    check('with location blocked, the rider is told so (no silent failure)', wait(lambda: 'Location is blocked' in dpage.inner_text('#view'), 15))
    check('and the admin sees the delivery with no live position', api('GET', '/api/tracking/admin/active', None, admin['token'])[1]['deliveries'][0]['state'] == 'unavailable')
    kpage = bare('user', cust, f"{BASE}/user/#/orders/{o2['order_code']}"); PUMP[0] = kpage
    api('POST', f'/api/restaurant/orders/{oid2}/ready', {}, rest['token']); pk2 = [x for x in api('GET', '/api/restaurant/orders', None, rest['token'])[1]['orders'] if x['id'] == oid2][0]['pickup_otp']
    api('POST', f'/api/rider/orders/{oid2}/pickup', {'otp': pk2}, rider['token'])
    check('customer without the map library sees a plain message and an honest status (no broken map)', wait(lambda: 'map is not available' in kpage.inner_text('#trkmap') and kpage.inner_text('#trkst').strip() == 'Location not available yet', 15))
    b.close()
print('\nP2 BROWSER RESULT:', 'ALL PASSED' if not fails else f'{len(fails)} FAILED: {fails}'); raise SystemExit(1 if fails else 0)
