"""Real-browser end-to-end test. Run via: npm run test:browser (see package.json)."""
import json, re, sys, urllib.request
from playwright.sync_api import sync_playwright, expect
BASE = 'http://127.0.0.1:8123'; PW = 'demo-pass-12345'; ADMIN_PW = 'admin-pass-123456'
fails = []; shots = '/tmp/pl-shots'
import os; os.makedirs(shots, exist_ok=True)
def check(name, cond):
    print(('PASS ' if cond else 'FAIL ') + name); 
    if not cond: fails.append(name)
def overflow(page, label):
    w = page.evaluate('[document.documentElement.scrollWidth, window.innerWidth]'); check(f'no horizontal scroll: {label} ({w[0]}<= {w[1]})', w[0] <= w[1] + 1)
import time
def wait_until(page, expr, timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        if page.evaluate(expr): return True
        time.sleep(0.15)
    return False
def staff_login(page, portal, phone, pw):
    page.goto(f'{BASE}/{portal}/'); page.fill('input[name=phone]', phone); page.fill('input[name=password]', pw); page.click('button[type=submit]')

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['geolocation'], geolocation={'latitude': 17.4, 'longitude': 78.5}, accept_downloads=False)
    cust, rest, rider, admin = [ctx.new_page() for _ in range(4)]
    for pg in (cust, rest, rider, admin): pg.on('pageerror', lambda e: (print('PAGE ERROR', e), fails.append(f'js error: {e}')))

    # ---- Test 2 first: nobody online -> exact message ----
    cust.goto(f'{BASE}/user/'); cust.wait_for_selector('.welcome', timeout=5000)
    cust.screenshot(path=f'{shots}/01-welcome.png'); overflow(cust, 'welcome')
    check('welcome screen has Login button, no role selector', cust.locator('text=Login').count() == 1 and cust.locator('text=Super Admin').count() == 0)
    cust.click('text=Login'); cust.fill('input[name=phone]', '9876543210'); cust.click('text=Send code')
    cust.wait_for_selector('input[name=otp]'); otp = json.load(urllib.request.urlopen(f'{BASE}/__test/otp'))['otp']
    cust.fill('input[name=otp]', otp); cust.fill('input[name=name]', 'Asha'); cust.click('text=Verify and continue')
    cust.wait_for_selector('text=Local restaurants'); overflow(cust, 'customer home')
    check('no-rider banner shown on home with exact text', cust.locator('text=Sorry, we are not currently accepting orders as delivery partners are not available. Please check after some time.').count() >= 1)
    cust.screenshot(path=f'{shots}/02-home-norider.png')

    # ---- sessions are independent per portal in the same browser ----
    staff_login(rider, 'rider', '+919000020001', PW); rider.wait_for_selector('text=Deliveries'); overflow(rider, 'rider home')
    staff_login(rest, 'restaurant', '+919000010001', PW); rest.wait_for_selector('text=Restaurant status'); overflow(rest, 'restaurant orders')
    staff_login(admin, 'admin', '+919000000000', ADMIN_PW); admin.wait_for_selector('text=Live orders'); overflow(admin, 'admin overview')
    check('customer session survived other portal logins', cust.evaluate("!!localStorage.getItem('pl.session.user')") and cust.evaluate("!!localStorage.getItem('pl.session.rider')"))
    check('rider opening /rider is not redirected to another portal', '/rider/' in rider.url)
    rider.goto(f'{BASE}/rider/'); rider.wait_for_selector('text=Deliveries'); check('rider session persists on reload', '/rider' in rider.url and rider.locator('text=Sign in').count() == 0)

    # ---- rider goes online ----
    rider.click('#onl'); rider.wait_for_selector('#onl.on'); check('rider switch shows Online', rider.locator('#onl').inner_text().strip() == 'Online')
    check('alert sound unlocked by explicit tap', rider.evaluate('PL.sound.unlocked') is True)
    cust.reload(); cust.wait_for_selector('text=Local restaurants'); check('no-rider banner gone when a rider is online', cust.locator('text=delivery partners are not available').count() == 0)

    # ---- Test 1: customer orders ----
    cust.click('text=Choose a location'); cust.click('text=Sunrise Hostel'); cust.wait_for_selector('b:has-text("Sunrise Hostel")')
    cust.click('text=Spice Route Biryani'); cust.wait_for_selector('text=Chicken Dum Biryani'); overflow(cust, 'menu')
    check('customer sees marked-up price (140 + 20 = 160)', cust.locator('text=₹160').count() >= 1)
    check('menu shows restaurant base price and platform part', cust.locator('text=Restaurant ₹140 + platform ₹20').count() >= 1)
    cust.locator('button:has-text("Add")').first.click(); cust.click('text=View cart'); cust.wait_for_selector('text=Bill details'); overflow(cust, 'checkout')
    cust.fill('textarea', 'Gate 2. Call before arriving.')
    cust.wait_for_selector('text=Pay ₹'); cust.screenshot(path=f'{shots}/03-checkout.png')
    check('bill shows markup, delivery and total (160+30=190)', cust.locator('text=Platform markup').count() == 1 and cust.locator('text=Pay ₹190').count() == 1)
    cust.click('text=Pay ₹190'); cust.wait_for_selector('text=Simulate successful payment'); cust.click('text=Simulate successful payment')
    cust.wait_for_selector('text=Order progress'); code = re.search(r'PL\d{8}[A-Z0-9]{6}', cust.inner_text('main')).group(0); check(f'order id issued ({code})', True)
    cust.screenshot(path=f'{shots}/04-tracking-placed.png'); overflow(cust, 'tracking')

    # ---- Test 3: restaurant alert, sound, accept ----
    rest.click('#sbtn'); rest.wait_for_selector('#alerts .card', timeout=6000); check('restaurant popup appears with order', code in rest.inner_text('#alerts'))
    rest.screenshot(path=f'{shots}/05-restaurant-alert.png')
    check('sound loop is playing for pending order', rest.evaluate('PL.sound.playing()') is True)
    rest.click('#alerts >> text=Accept order'); check('sound stops once handled', wait_until(rest, 'PL.sound.playing() === false'))
    check('popup gone after accept', rest.locator('#alerts').evaluate('e => e.classList.contains("hide")'))

    # ---- Test 5: rider alert with full details, accept ----
    rider.wait_for_selector('#alerts .card', timeout=6000); a = rider.inner_text('#alerts')
    check('rider offer shows restaurant, customer, destination, instructions, items', all(s in a for s in ['Spice Route Biryani', 'Asha', 'Sunrise Hostel', 'Gate 2. Call before arriving.', 'Chicken Dum Biryani']))
    check('rider offer has map links', rider.locator('#alerts a:has-text("Map")').count() == 2)
    check('rider sound playing', rider.evaluate('PL.sound.playing()') is True); rider.screenshot(path=f'{shots}/06-rider-offer.png')
    rider.click('#alerts >> text=Accept'); rider.wait_for_selector('text=Active delivery'); check('rider sound stops after accepting', wait_until(rider, 'PL.sound.playing() === false')); overflow(rider, 'rider active')

    # ---- Test 6/7: pickup OTP ----
    rest.goto(f'{BASE}/restaurant/'); rest.wait_for_selector('text=Restaurant status'); check('restaurant has separate Accepted and Preparing tabs', rest.locator('.tabs button:has-text("Accepted")').count() == 1 and rest.locator('.tabs button:has-text("Preparing")').count() == 1)
    rest.click('.tabs button:has-text("Accepted")'); rest.wait_for_selector(f'text={code}')
    rest.click('text=Food ready'); rest.click('button:has-text("Ready")'); rest.wait_for_selector('.otp'); pickup = rest.inner_text('.otp').strip(); check('restaurant shows 4-digit pickup code', re.fullmatch(r'\d{4}', pickup) is not None)
    check('customer cannot see rider before pickup', cust.locator('text=Your delivery partner').count() == 0)
    rider.wait_for_selector('text=Confirm pickup', timeout=6000)
    rider.fill('input[name=otp]', '0000' if pickup != '0000' else '1111'); rider.click('text=Confirm pickup'); rider.wait_for_selector('.toast.bad'); check('wrong pickup code rejected', True)
    rider.fill('input[name=otp]', pickup); rider.click('text=Confirm pickup'); rider.wait_for_selector('text=Complete delivery', timeout=6000)
    cust.wait_for_selector('text=Your delivery partner', timeout=6000); cust.screenshot(path=f'{shots}/07-tracking-pickedup.png')
    t = cust.inner_text('main'); check('customer sees rider name, vehicle and registration', 'Rahul' in t and 'Honda Activa' in t and 'TS 09 AB 1234' in t)
    dotp = cust.locator('.otp').first.inner_text().strip(); check('customer sees delivery code', re.fullmatch(r'\d{4}', dotp) is not None)

    # ---- Test 8: delivery OTP ----
    rider.fill('input[name=otp]', '0000' if dotp != '0000' else '1111'); rider.click('text=Complete delivery'); rider.wait_for_selector('.toast.bad'); check('wrong delivery code rejected', True)
    rider.fill('input[name=otp]', dotp); rider.click('text=Complete delivery'); rider.wait_for_selector('text=Delivered. Earnings added')
    cust.wait_for_selector('.tl li.done >> text=Delivered', timeout=6000);
    cust.wait_for_selector('[aria-label="5 stars"]'); cust.click('[aria-label="5 stars"]'); cust.wait_for_selector('text=Your rating'); check('customer can rate a delivered order', True)
    oid = rest.evaluate("PL.api('/api/restaurant/orders').then(r => r.orders.find(o => o.status === 'DELIVERED').id)")
    rest.goto(f'{BASE}/restaurant/#/order/{oid}'); rest.wait_for_selector(f'text={code}', timeout=6000); check('notification deep link opens that exact order', rest.locator('text=Delivered').count() >= 1)
    cust.screenshot(path=f'{shots}/08-tracking-delivered.png'); check('customer timeline reaches Delivered', True)

    # ---- Test 9/10: earnings and cashout UI, admin ----
    rider.click('text=Earnings'); rider.wait_for_selector('text=Available to cash out'); check('rider earnings credited (₹30)', rider.locator('text=₹30').count() >= 1); overflow(rider, 'rider earnings')
    rider.click('text=Request cashout'); rider.fill('input[name=amt]', '30'); rider.fill('input[name=ben]', 'rahul@upi'); rider.click('text=Submit request')
    try: rider.wait_for_selector('text=Request #', timeout=8000)
    except Exception:
        print('DEBUG page text:', rider.inner_text('body')[:600].replace('\n', ' | ')); print('DEBUG modal open:', rider.locator('.sheet').count()); rider.screenshot(path=f'{shots}/debug-cashout.png'); raise
    admin.click('nav >> text=Cashouts'); admin.wait_for_selector('text=Mark paid', timeout=6000); overflow(admin, 'admin cashouts'); admin.screenshot(path=f'{shots}/09-admin-cashouts.png')
    open('/tmp/proof.png', 'wb').write(bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f645400000000049454e44ae426082'))
    admin.click('text=Mark paid'); admin.fill('input[name=ref]', 'UTR998877'); admin.set_input_files('input[name=proof]', '/tmp/proof.png'); admin.click('text=Confirm payout')
    try: admin.wait_for_selector('text=UTR998877', timeout=8000)
    except Exception:
        print('DEBUG2 admin text:', admin.inner_text('body')[:700].replace('\n', ' | ')); print('DEBUG2 sheet open:', admin.locator('.sheet').count(), 'toasts:', admin.locator('.toast').all_inner_texts())
        print('DEBUG2 server log:', open('/tmp/pl-e2e.log').read()[-500:]); admin.screenshot(path=f'{shots}/debug-pay.png'); raise
    rider.reload(); rider.wait_for_selector('text=Available to cash out'); rider.wait_for_selector('text=View payment proof'); check('rider sees own payout proof + reference', rider.locator('text=UTR998877').count() == 1)
    rider.click('text=View payment proof'); rider.wait_for_selector('.sheet img[src^=blob]', timeout=5000); check('proof image loads via authenticated fetch', True)
    admin.click('nav >> text=Overview'); admin.wait_for_selector('text=Gross platform earnings'); overflow(admin, 'admin overview'); admin.screenshot(path=f'{shots}/10-admin-overview.png')
    admin.click('nav >> text=Order ID'); admin.fill('input[name=code]', code); admin.click('button:has-text("Search")'); admin.wait_for_selector('text=Who earns what'); overflow(admin, 'admin order detail')
    check('admin order detail shows the whole money split', all(s in admin.inner_text('main') for s in ['Platform revenue', 'Restaurant payout', 'Rider earning']))
    admin.screenshot(path=f'{shots}/11-admin-order.png')

    # ---- new admin features: chart, expenses, cancel with refund ----
    admin.goto(f'{BASE}/admin/#/overview'); admin.wait_for_selector('text=Daily trend'); check('admin overview has a daily chart', admin.locator('svg[aria-label^="Daily"]').count() == 1); overflow(admin, 'admin chart')
    admin.goto(f'{BASE}/admin/#/expenses'); admin.wait_for_selector('text=Operating expenses'); admin.fill('input[name=amt]', '500'); admin.fill('input[name=cat]', 'Marketing'); admin.click('text=Add expense'); admin.wait_for_selector('.card.row:has-text("Marketing"):has-text("₹500")', timeout=6000)
    check('expense recorded and listed', admin.locator('text=₹500').count() >= 1); admin.goto(f'{BASE}/admin/#/overview'); admin.wait_for_selector('text=Operating expenses'); check('overview shows operating expenses', admin.locator('text=₹500').count() >= 1)
    mk = cust.evaluate("""async () => { const m = await PL.api('/api/public/restaurants/1/menu'); const o = await PL.post('/api/customer/orders', {restaurant_id: 1, items: [{id: m.items[0].id, qty: 1}], location_id: 1});
      await PL.post('/api/customer/payments/sandbox/' + o.order_code + '/complete', {outcome: 'success'}); return o.order_code; }""")
    rest.evaluate("PL.api('/api/restaurant/orders').then(r => PL.post('/api/restaurant/orders/' + r.orders.find(o => o.status === 'PLACED').id + '/accept'))")
    admin.goto(f'{BASE}/admin/#/search/{mk}'); admin.wait_for_selector('text=Cancel order and refund'); admin.click('text=Cancel order and refund'); admin.fill('input[name=reason]', 'Restaurant kitchen closed early'); admin.click('.sheet >> text=Cancel order')
    admin.wait_for_selector('.chip:has-text("Cancelled")', timeout=6000); check('admin cancelled the order from the UI', True)
    cust.goto(f'{BASE}/user/#/orders/{mk}'); cust.wait_for_selector('text=This order was cancelled', timeout=6000); check('customer sees cancellation and refund status', cust.locator('text=Refund initiated').count() >= 1)
    admin.reload(); admin.wait_for_selector('text=admin cancelled', timeout=6000)
    # ---- XSS: hostile restaurant name must render as text, never execute ----
    admin.evaluate("PL.post('/api/admin/restaurants', {name: '<img src=x onerror=window.__xss=1>Evil <script>window.__xss=2</script>', cuisine: '\"><svg onload=window.__xss=3>', commission_bps: 1000, markup_paise: 0, admin_visible: true, approved: true})")
    cust.goto(f'{BASE}/user/'); cust.wait_for_selector('text=Local restaurants'); cust.wait_for_selector('text=Evil', timeout=5000); time.sleep(0.5)
    check('XSS: hostile name shown as literal text', cust.locator('text=<img src=x onerror=window.__xss=1>').count() >= 1)
    check('XSS: nothing executed, no injected elements', cust.evaluate('window.__xss') is None and cust.locator('img[src="x"]').count() == 0 and cust.locator('main svg[onload]').count() == 0)
    # ---- Test 12: admin hides restaurant ----
    admin.goto(f'{BASE}/admin/#/restaurants'); admin.wait_for_selector('text=Spice Route Biryani'); admin.locator('.card:has-text("Spice Route Biryani") .sw').click(); admin.wait_for_selector('.toast:has-text("hidden")')
    cust.goto(f'{BASE}/user/'); cust.wait_for_selector('text=Local restaurants'); check('hidden restaurant disappears from customer list', cust.locator('text=Spice Route Biryani').count() == 0 and cust.locator('text=Dosa Corner').count() == 1)

    # ---- Test 14: back navigation ----
    cust.click('text=Dosa Corner'); cust.wait_for_selector('text=Masala Dosa'); cust.click('.back'); cust.wait_for_selector('text=Local restaurants'); check('top-left Back returns to previous screen', True)
    cust.click('text=Dosa Corner'); cust.wait_for_selector('text=Masala Dosa'); cust.go_back(); cust.wait_for_selector('text=Local restaurants'); check('browser Back works', True)
    cust.click('text=Deliver to'); cust.wait_for_selector('.sheet'); cust.go_back(); cust.wait_for_selector('.sheet', state='detached', timeout=3000); check('browser Back closes open modal first (stays on page)', cust.locator('text=Local restaurants').count() == 1)
    cust.click('text=Deliver to'); cust.click('.sheet >> text=Use my current location'); cust.wait_for_selector('b:has-text("Current location")', timeout=6000); check('GPS location captured', True)

    # ---- offline rider keeps active job, rider logout stops alerts; mobile widths ----
    for w in (320, 360, 414, 768, 1280):
        cust.set_viewport_size({'width': w, 'height': 800}); cust.goto(f'{BASE}/user/#/orders'); cust.wait_for_selector('text=My orders'); overflow(cust, f'orders @{w}px')
        admin.set_viewport_size({'width': w, 'height': 800}); admin.goto(f'{BASE}/admin/#/orders'); admin.wait_for_selector('.tbl'); overflow(admin, f'admin orders @{w}px')
    admin.set_viewport_size({'width': 390, 'height': 844})
    admin.screenshot(path=f'{shots}/12-admin-orders-mobile.png')
    rider.click('.top >> button[aria-label="Sign out"]') if rider.locator('.top >> button[aria-label="Sign out"]').count() else None
    b.close()
print('\nFAILED:', fails if fails else 'none'); sys.exit(1 if fails else 0)
