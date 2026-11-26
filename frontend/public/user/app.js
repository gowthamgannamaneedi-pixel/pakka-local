(function () { const m = /^\/user\/orders\/([A-Z0-9]+)/.exec(location.pathname); if (m && !location.hash) history.replaceState(null, '', '/user/#/orders/' + m[1]); })();
/* Pakka Local customer app v5. Screens are rebuilt; ordering, address, GPS, payment and tracking rules are unchanged.
   Everything shown comes from the server: no invented offers, ratings, statuses or rider movement. */
(function () {
  const e = PL.esc, rs = PL.rs, S = PL.state, I = PL.icon;
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  S.cart = load('pl.cart', { rid: null, rname: '', items: {} }); S.addrId = load('pl.addr', null); S.instr = ''; try { localStorage.removeItem('pl.dest'); } catch {}      // the server is the source of truth for addresses
  const saveCart = () => localStorage.setItem('pl.cart', JSON.stringify(S.cart));
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };      // only small preferences (e.g. which saved address is chosen); never coordinates
  const cartCount = () => Object.values(S.cart.items).reduce((a, i) => a + i.qty, 0);
  const cartTotal = () => Object.values(S.cart.items).reduce((a, i) => a + i.qty * i.price, 0);
  document.addEventListener('input', (ev) => { const k = ev.target.dataset?.bind; if (k) S[k] = ev.target.value; });
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- food categories: our own photos (free licence), matched against restaurant names, cuisines and dish names ----------
  const CATS = [['biryani', 'Biryani', /biry?ani|pulao|mandi|\bdum\b/i], ['dosa', 'Dosa', /dosa|uttapam|south indian|tiffin/i], ['idli', 'Idli & Vada', /idli|vada|tiffin/i], ['pizza', 'Pizza', /pizza|margherita/i],
    ['burger', 'Burgers', /burger/i], ['noodles', 'Chinese', /noodle|chow|hakka|chinese|fried rice|manchurian/i], ['curry', 'North Indian', /north indian|curry|butter chicken|paneer|dal |kadai|tikka masala/i], ['thali', 'Thali', /thali|\bmeals?\b/i],
    ['rolls', 'Rolls', /\broll|wrap|shawarma|kathi|frankie/i], ['momos', 'Momos', /momo|dumpling/i], ['sweets', 'Sweets', /jamun|sweet|halwa|rasmalai|kheer|mithai|dessert/i], ['cakes', 'Cakes', /cake|brownie|pastr|bake/i],
    ['chai', 'Chai & Coffee', /chai|\btea\b|coffee|cafe/i], ['shakes', 'Shakes & Juice', /shake|cold coffee|juice|smoothie|lassi|beverage/i]];
  const catPic = (k) => `/assets/food/${k}.jpg`;
  // a dish without its own photo: the closest photo of that kind of dish (most specific first), else its cuisine photo
  const DISH = [['lollipop', /lollipop/i], ['biryani', /biry?ani|pulao|mandi|\bdum\b/i], ['fried_rice', /fried rice/i], ['curd_rice', /curd rice/i], ['jeera_rice', /jeera rice|plain rice|tomato rice|ghee rice|steamed rice/i],
    ['paratha', /paratha|parotta/i], ['naan', /naan|roti|kulcha|chapat|phulka/i], ['chicken_fry', /chicken (fry|pakod|65)/i], ['chilli_chicken', /chilli chicken|chicken (manchuria|majestic|555)|pepper chicken|dragon chicken/i],
    ['chicken_leg', /leg piece|drumstick|extra piece|kodi roast|tandoori chicken|roast chicken/i], ['omelette', /omelet|bhurji/i], ['boiled_egg', /boiled egg/i], ['pakoda', /pakod|pakora|bajji|bhaji/i], ['egg_curry', /\begg\b/i],
    ['paneer_starter', /chilli paneer|paneer (65|majestic|555|manchuria)/i], ['paneer_curry', /paneer/i], ['mushroom', /mushroom/i], ['corn', /corn/i], ['dal', /\bdal\b|tadka/i], ['chicken_curry', /chicken/i],
    ['curry', /masala|kadai|sabji|kurma|korma|curry/i]];
  const dishKey = (name) => (DISH.find(([, re]) => re.test(name || '')) || [])[0];
  // dishes with their own photo of that exact dish name (free-licence real photos, one per dish, never repeated)
  const DPIC = new Set('afghani-chicken-curry aloo-paratha andhra-chicken-curry baby-corn-555 baby-corn-65 baby-corn-curry baby-corn-kadai baby-corn-masala boiled-egg butter-chicken-curry butter-naan butter-roti chicken-555 chicken-65 chicken-biryani-family chicken-biryani-handi chicken-biryani-jumbo chicken-biryani-single chicken-curry chicken-fried-rice chicken-fry chicken-handi-curry chicken-leg-piece chicken-lollipop-dry chicken-lollipop-wet chicken-majestic chicken-manchuria chicken-masala chicken-moghlai-curry chicken-pakoda chicken-tikka-masala chilli-chicken chilli-mushroom chilli-paneer crispy-baby-corn crispy-corn curd-rice dal-fry dal-tadka egg-65 egg-bhurji egg-biryani-family egg-biryani-handi egg-biryani-single egg-chilli egg-curry egg-fried-rice egg-fry egg-manchuria egg-masala egg-pakoda extra-piece-chicken fry-piece-biryani-family fry-piece-biryani-handi fry-piece-biryani-jumbo fry-piece-biryani-single garlic-naan ginger-chicken-curry half-boiled-egg handi-biryani-rice jeera-rice kadai-chicken-curry-bone kadai-chicken-curry-boneless kadai-mushroom kadai-paneer-curry kadai-sabji kadai-tomato-curry kaju-biryani-family kaju-biryani-handi kaju-biryani-jumbo kaju-curry kaju-fried-rice kaju-masala kaju-paneer kaju-roast kaju-tomato-curry kodi-roast-full kodi-roast-half mushroom-555 mushroom-65 mushroom-biryani-family mushroom-biryani-handi mushroom-biryani-jumbo mushroom-biryani-single mushroom-curry mushroom-manchuria mushroom-masala omelette onion-pakoda paneer-555 paneer-65 paneer-biryani-family paneer-biryani-handi paneer-biryani-jumbo paneer-biryani-single paneer-butter-masala paneer-do-pyaza paneer-fried-rice paneer-majestic paneer-manchuria paneer-paratha paneer-pyaz paneer-tikka-masala pepper-chicken pepper-mushroom plain-naan plain-rice punjabi-chicken-curry single-biryani-rice special-biryani-family special-biryani-handi special-biryani-jumbo special-biryani-single special-chicken-fried-rice special-veg-fried-rice tandoori-roti telangana-chicken-curry tomato-masala tomato-rice veg-biryani-family veg-biryani-handi veg-biryani-single veg-fried-rice veg-mix-curry'.split(' '));
  const slugOf = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const dishPic = (name) => { const k = slugOf(name); if (DPIC.has(k)) return `/assets/food/dish/${k}.jpg`; const c = dishKey(name) || catsOf(name)[0]; return c ? catPic(c) : ''; };
  const catsOf = (txt) => CATS.filter(([, , re]) => re.test(txt)).map(([k]) => k);
  const textOf = (x) => [x.name, x.cuisine, x.description, x.dish_names].filter(Boolean).join(' | ');
  // a restaurant without its own photo shows a photo of its cuisine (labelled by the cuisine, never as their dish)
  // photo for a restaurant shown from an order: its own photo, else a photo of what was ordered (cuisine), never blank
  const restPic = (name, image, text) => (image ? pubImg(image) : catPic(catsOf([name, text].filter(Boolean).join(' '))[0] || 'thali'));
  const coverOf = (x) => (x.image_path ? `/api/files/public/${encodeURIComponent(x.image_path)}` : catPic(catsOf(textOf(x))[0] || 'thali'));
  const img = (src, cls = '', alt = '') => `<img src="${e(src)}" class="${cls}" alt="${e(alt)}" loading="lazy" decoding="async">`;
  const pubImg = (p) => (p ? `/api/files/public/${encodeURIComponent(p)}` : '');
  const star = '<svg viewBox="0 0 24 24"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/></svg>';
  const kfmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K+` : String(n));
  const rateBadge = (x) => (x.rating ? `<span class="u-rate">${star}${Number(x.rating).toFixed(1)}</span>` : '<span class="u-rate new">New</span>');
  const etaOf = (x) => (x.eta_min ? `${x.eta_min} mins` : '');
  const dietMark = (d) => (d ? `<span class="diet ${e(d)}" role="img" aria-label="${{ veg: 'Veg', nonveg: 'Non-veg', egg: 'Contains egg' }[d] || ''}"></span>` : '');
  const offerOf = (x) => (x.free_delivery_above_paise ? `<span class="of"><small>Free delivery</small>above ${rs(x.free_delivery_above_paise)}</span>` : '');
  const hm = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; };
  // today's opening hours (India time) from the server; '' when the restaurant has not set any
  const hoursOf = (x) => (x.today_hours ? (x.today_hours.closed ? 'Closed today' : `${hm(x.today_hours.open)} – ${hm(x.today_hours.close)}`) : '');
  const opensTxt = (iso) => { if (!iso) return ''; const d = new Date(iso), day = (t) => t.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), tm = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    return `Opens ${day(d) === day(new Date()) ? '' : day(d) === day(new Date(Date.now() + 864e5)) ? 'tomorrow ' : d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }) + ' '}${tm}`; };
  // why a restaurant is closed, in customer words (the server decides; this only explains it)
  const whyClosed = (x) => ({ no_location: 'Not taking orders yet', paused: 'Closed by the restaurant', outside_hours: 'Outside opening hours' }[x.closed_reason] || 'Closed right now');
  const greet = () => { const h = new Date().getHours(); return h < 11 ? 'Good morning' : h < 16 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Late-night cravings?'; };
  const ART = {      // simple original illustrations for empty states (no emoji, no downloaded art)
    bowl: '<svg class="art" viewBox="0 0 160 110" fill="none"><ellipse cx="80" cy="98" rx="58" ry="7" fill="#f1ece6"/><path d="M22 52h116c0 28-26 44-58 44S22 80 22 52z" fill="#ffd9c2"/><path d="M22 52h116" stroke="#d0450b" stroke-width="4" stroke-linecap="round"/><path d="M58 40c0-8 6-8 6-16M80 40c0-8 6-8 6-16M102 40c0-8 6-8 6-16" stroke="#f2a375" stroke-width="3.5" stroke-linecap="round"/></svg>',
    bag: '<svg class="art" viewBox="0 0 160 110" fill="none"><ellipse cx="80" cy="100" rx="52" ry="6" fill="#f1ece6"/><rect x="44" y="34" width="72" height="62" rx="10" fill="#ffe3d1"/><path d="M60 34v-6a20 20 0 0140 0v6" stroke="#d0450b" stroke-width="4" stroke-linecap="round"/><path d="M66 62l10 10 20-20" stroke="#0f8a4f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    search: '<svg class="art" viewBox="0 0 160 110" fill="none"><ellipse cx="80" cy="100" rx="50" ry="6" fill="#f1ece6"/><circle cx="72" cy="50" r="30" fill="#fff3ec" stroke="#d0450b" stroke-width="5"/><path d="M94 72l22 22" stroke="#d0450b" stroke-width="7" stroke-linecap="round"/><path d="M60 50h24" stroke="#f2a375" stroke-width="4" stroke-linecap="round"/></svg>' };
  const WA = '<svg class="wa-ic" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>';
  const empty = (art, title, text, btn = '') => `<div class="u-empty">${ART[art] || ''}<b>${title}</b><div>${text}</div>${btn}</div>`;

  // ---------- login: photo welcome -> mobile number -> code ----------
  // The server says how login codes are sent right now: 'whatsapp', 'sms' or 'test' (staging fixed code). Wording follows it.
  const isSms = () => S.loginChannel === 'sms';
  const via = () => (isSms() ? 'by SMS' : 'on WhatsApp');
  const startLabel = () => (isSms() ? `${I('phone')} Continue with mobile number` : `${WA} Continue with WhatsApp`);
  const loadChannel = () => PL.api('/api/public/config').then((c) => { S.loginChannel = c?.loginChannel || 'whatsapp'; const b = PL.$('[data-act="to-login"].btn'); if (b) b.innerHTML = startLabel(); return c; }).catch(() => null);
  // business details and policies at the bottom of Home (visible to everyone, logged in or not)
  const bizFoot = (b) => !b ? '' : `<footer class="u-biz"><div class="bz"><img src="/assets/logo.png" alt="" width="34" height="34"><span><b>${e(b.name)}</b><small>Food delivery from local kitchens to your PG, hostel or college</small></span></div>
      <div class="ct">${b.address ? `<span>${I('pin')} ${e(b.address)}</span>` : ''}<a href="tel:${e(b.phone.replace(/\s/g, ''))}">${I('phone')} ${e(b.phone)}</a><a href="mailto:${e(b.email)}">${I('chat')} ${e(b.email)}</a></div>
      <nav class="lg"><a href="/contact">Contact us</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/refund-policy">Refunds &amp; cancellation</a><a href="/delivery-policy">Delivery policy</a></nav>
      <small class="cp">© ${new Date().getFullYear()} ${e(b.name)}</small></footer>`;
  // guests (not logged in) browse Home, Search and menus; anything personal asks them to log in first
  const GUEST_ASK = { '/cart': ['Log in to place your order', 'Your cart is saved. Log in with your mobile number to check out.'], '/orders': ['Log in to see your orders', 'Track live orders and order again in one tap.'],
    '/me': ['Log in to your account', 'Manage addresses, notifications and help.'], '/addresses': ['Log in to set your delivery location', 'Save your PG, hostel or college once and order in a tap.'],
    '/places': ['Log in to set your delivery location', 'Save your PG, hostel or college once and order in a tap.'] };
  const guestPrompt = (path) => { const k = Object.keys(GUEST_ASK).find((p) => path === p || path.startsWith(p + '/')); const [t, s] = GUEST_ASK[k] || ['Log in to continue', 'Use your mobile number. It takes less than a minute.'];
    return `<div class="u-pg"><div class="u-guest">${I(k === '/cart' ? 'cart' : k === '/orders' ? 'orders' : k === '/addresses' || k === '/places' ? 'pin' : 'user')}<h2>${t}</h2><p>${s}</p>${k === '/cart' && cartCount() ? `<p class="small"><b>${cartCount()} item${cartCount() > 1 ? 's' : ''} · ${rs(cartTotal())}</b> from ${e(S.cart.rname || '')}</p>` : ''}
      <button class="btn block lg" data-act="to-login">Log in or sign up</button><button class="btn ghost block mt2" data-act="go" data-path="/home">Browse restaurants</button></div></div>`; };
  PL.actions['guest-back'] = () => PL.boot();
  function loginView(root) {
    const pics = ['biryani', 'dosa', 'pizza', 'momos', 'curry', 'burger', 'thali', 'noodles', 'rolls', 'cakes', 'idli', 'chai'];
    root.innerHTML = `<div class="splash" id="splash"><img src="/assets/logo.png" alt="Pakka Local"><div class="bar"></div></div>
      <div class="u-login"><div class="u-collage" aria-hidden="true"><div class="grid">${pics.map((k, i) => `<img src="${catPic(k)}" alt="" style="animation-delay:${i * 50}ms">`).join('')}</div>
        <div class="brand"><span class="lg"><img src="/assets/logo.png" alt=""></span><p>Your neighbourhood, delivered.</p><span>Hot food from kitchens near your PG, hostel or college</span></div></div>
      <div class="u-lsheet" id="u-lsheet"><h2>Hungry? Let’s get started</h2><p class="s">Log in or sign up with your mobile number.</p><button class="btn block lg" data-act="to-login">${startLabel()}</button>
        <p class="fine">Online payment only · Live order tracking</p><button class="btn ghost block mt2" data-act="guest-back">Browse restaurants first</button>
        <p class="u-legal"><a href="/contact">Contact</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/refund-policy">Refunds</a> · <a href="/delivery-policy">Delivery</a></p></div></div>`;
    loadChannel(); setTimeout(() => PL.$('#splash')?.classList.add('out'), 1100); setTimeout(() => PL.$('#splash')?.remove(), 1600);
  }
  const sheet = (html) => { const s = PL.$('#u-lsheet'); if (s) { s.innerHTML = html; s.style.animation = 'none'; void s.offsetWidth; s.style.animation = ''; return; } loginView(PL.$('#root')); PL.$('#splash')?.remove(); PL.$('#u-lsheet').innerHTML = html; };
  PL.actions['to-login'] = async () => { if (PL.$('#view')) history.pushState({ idx: (history.state?.idx || 0) + 1 }, '', location.hash);      // from browsing: the back button returns to it
    if (!S.loginChannel) await loadChannel();
    sheet(`<h2>Log in or sign up</h2><p class="s">${isSms() ? 'Enter your mobile number. We’ll send a 6-digit code by SMS.' : 'Enter your WhatsApp number. We’ll send a 6-digit code on WhatsApp.'}</p>
      <form data-form="otp-request"><label for="c-ph" class="small mute">${isSms() ? 'Mobile number' : 'WhatsApp mobile number'}</label><div class="field pre"><span>+91</span><input id="c-ph" name="phone" inputmode="numeric" autocomplete="tel-national" maxlength="14" placeholder="98765 43210" value="${e(S.lastPhone ? S.lastPhone.slice(3) : '')}" required autofocus></div>
        <div class="u-lerr" id="lg-err" role="alert"></div>${isSms() ? '<button class="btn block lg mt" type="submit">Send OTP by SMS</button>' : `<button class="btn block lg mt wa" type="submit">${WA} Send WhatsApp OTP</button>`}</form><div id="email-login"></div>
      <p class="fine">${isSms() ? 'By continuing you agree to receive your login code by SMS.' : 'By continuing you agree to receive your login code and order updates on WhatsApp.'}</p>
      <button class="btn ghost block mt2" data-act="guest-back">Continue browsing</button>`);
    // STAGING ONLY: the server says whether allow-listed testers may sign in by e-mail (never on production)
    PL.api('/api/public/config').then((c) => { const el = PL.$('#email-login'); if (el && c?.emailLogin) el.innerHTML = `<div class="u-note info small">${I('info')}<span>Staging test login: approved testers can get the code by email instead.</span></div><button class="btn ghost block" data-act="to-email-login">Use a test email</button>`; }).catch(() => {});
  };
  // ---------- STAGING-ONLY e-mail login for allow-listed testers ----------
  PL.actions['to-email-login'] = () => {
    sheet(`<h2>Staging test login</h2><p class="s">Only approved test emails work. We’ll email you a 6-digit code.</p>
      <form data-form="email-otp-request"><label class="small mute">Test email</label><input name="email" type="email" inputmode="email" autocomplete="email" placeholder="tester@example.com" required><button class="btn block lg mt" type="submit">Email me a code</button></form>
      <button class="btn ghost block mt2" data-act="to-login">Use mobile number instead</button>`);
  };
  PL.forms['email-otp-request'] = async (f) => { const email = PL.form(f).email.trim().toLowerCase(); const r = await PL.run(() => PL.post('/api/auth/customer/email-otp/request', { email })); if (r) emailOtpView(email, r.resendAfterSec); };
  // six separate digit boxes; the hidden "otp" field holds the full code that is sent to the server
  const otpBoxes = () => `<div class="u-otp6" role="group" aria-label="6-digit code">${[0, 1, 2, 3, 4, 5].map((i) => `<input class="u-d" inputmode="numeric" pattern="[0-9]*" maxlength="${i ? 1 : 6}" ${i ? '' : 'autocomplete="one-time-code" autofocus'} aria-label="Digit ${i + 1}" data-i="${i}">`).join('')}</div><input type="hidden" name="otp">`;
  const otpSync = (box) => { const f = box.closest('form'), ds = [...f.querySelectorAll('.u-d')], v = ds.map((d) => d.value).join(''); f.otp.value = v; ds.forEach((d) => d.classList.toggle('on', !!d.value)); if (v.length === 6) f.requestSubmit(); };
  const otpFill = (ds, from, digits) => { let k = from; for (const ch of digits) { if (k > 5) break; ds[k++].value = ch; } ds[Math.min(k, 5)].focus(); };
  document.addEventListener('input', (ev) => { const t = ev.target; if (!t.classList?.contains('u-d')) return; const ds = [...t.closest('.u-otp6').querySelectorAll('.u-d')], i = Number(t.dataset.i), v = t.value.replace(/\D/g, '');
    if (v.length > 1) { t.value = ''; otpFill(ds, i, v); } else { t.value = v; if (v && i < 5) ds[i + 1].focus(); } otpSync(t); });
  document.addEventListener('keydown', (ev) => { const t = ev.target; if (!t.classList?.contains('u-d')) return; const ds = [...t.closest('.u-otp6').querySelectorAll('.u-d')], i = Number(t.dataset.i);
    if (ev.key === 'Backspace' && !t.value && i > 0) { ev.preventDefault(); ds[i - 1].value = ''; ds[i - 1].focus(); otpSync(t); }
    else if (ev.key === 'ArrowLeft' && i > 0) ds[i - 1].focus(); else if (ev.key === 'ArrowRight' && i < 5) ds[i + 1].focus(); });
  document.addEventListener('paste', (ev) => { const t = ev.target; if (!t.classList?.contains('u-d')) return; const v = (ev.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6); if (!v) return;
    ev.preventDefault(); const ds = [...t.closest('.u-otp6').querySelectorAll('.u-d')]; ds.forEach((d) => { d.value = ''; }); otpFill(ds, 0, v); otpSync(t); });
  const otpReset = (f) => { f.querySelectorAll('.u-d').forEach((d) => { d.value = ''; d.classList.remove('on'); }); f.otp.value = ''; f.querySelector('.u-d')?.focus(); };
  const codeForm = (form, attr, sentTo, note) => `<h2>Enter the 6-digit code</h2><p class="s">Sent to <b>${e(sentTo)}</b>${note ? `. ${note}` : ''}</p>
      <form data-form="${form}" ${attr}>${otpBoxes()}
      <button class="btn block lg mt" type="submit">Verify and continue</button></form>`;
  function emailOtpView(email, wait) {
    sheet(`${codeForm('email-otp-verify', `data-email="${e(email)}"`, email, 'Check spam too. It expires in 5 minutes')}
      <button class="btn ghost block mt2" id="resend" data-act="email-resend" data-email="${e(email)}" disabled>Resend in ${wait}s</button><button class="btn ghost block mt2" data-act="to-email-login">Change email</button>`);
    countdown(wait);
  }
  const countdown = (wait) => { let t = wait; const iv = setInterval(() => { const b = PL.$('#resend'); if (!b) return clearInterval(iv); t--; if (t <= 0) { b.disabled = false; b.textContent = 'Resend code'; clearInterval(iv); } else b.textContent = `Resend in ${t}s`; }, 1000); };
  PL.actions['email-resend'] = async (el) => { const r = await PL.run(() => PL.post('/api/auth/customer/email-otp/request', { email: el.dataset.email }), 'Code sent'); if (r) emailOtpView(el.dataset.email, r.resendAfterSec); };
  PL.forms['email-otp-verify'] = async (f) => { const v = PL.form(f); const body = { email: f.dataset.email, otp: v.otp };
    const r = await PL.run(() => PL.post('/api/auth/customer/email-otp/verify', body)); if (r) { PL.setSession(r); history.replaceState({ idx: 0 }, '', location.hash || '#'); PL.boot(); } };
  // ---------- WhatsApp login: number -> code (resend countdown, delivery status, clear errors) -> portal ----------
  const normPhone = (p) => { p = String(p).replace(/[\s()-]/g, '').replace(/^\+?91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, ''); return /^\d{10}$/.test(p) ? '+91' + p : null; };
  const lerr = (msg) => { const el = PL.$('#lg-err'); if (el) { el.textContent = msg || ''; el.classList.toggle('on', !!msg); } else if (msg) PL.toast(msg, true); };
  PL.forms['otp-request'] = async (f) => { const phone = normPhone(PL.form(f).phone); lerr('');
    if (!phone) return lerr('Enter your 10-digit mobile number.');
    try { const r = await PL.post('/api/auth/customer/otp/request', { phone }); S.lastPhone = phone; if (r.channel) S.loginChannel = r.channel; otpView(phone, r.resendAfterSec, r.channel); }
    catch (x) { if (x.code === 'WAIT' && S.lastPhone === phone && PL.$('#lg-err')) { otpView(phone, x.retryAfterSec || 30); return; } lerr(x.message); } };
  const DELIVERY = { whatsapp: { sent: ['', 'Sent on WhatsApp. It usually arrives within a few seconds.'], delivered: ['ok', 'Delivered to your WhatsApp.'], read: ['ok', 'Delivered to your WhatsApp.'],
      failed: ['bad', 'WhatsApp could not deliver the code to this number. Check the number, or resend.'] },
    sms: { sent: ['', 'SMS sent. It usually arrives within a few seconds.'], delivered: ['ok', 'SMS delivered to your phone.'],
      failed: ['bad', 'The SMS could not be delivered to this number. Check the number, or resend.'] } };
  const DELIV = new Proxy({}, { get: (_, k) => DELIVERY[isSms() ? 'sms' : 'whatsapp'][k] });
  let delivT = null;
  const watchDelivery = (phone) => { clearInterval(delivT); let n = 0;
    delivT = setInterval(async () => { const el = PL.$('#lg-deliv'); if (!el || ++n > 40) return clearInterval(delivT);
      try { const { status } = await PL.api('/api/auth/customer/otp/status?phone=' + encodeURIComponent(phone)); const d = DELIV[status]; if (d) { el.className = 'u-deliv ' + d[0]; el.textContent = d[1]; if (status === 'failed') clearInterval(delivT); } } catch {} }, 3000); };
  function otpView(phone, wait, channel) {
    const pretty = phone.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2');
    sheet(`<h2>Enter the 6-digit code</h2><p class="s">${channel === 'test' ? 'Staging test login: enter your tester code for' : `We sent a code ${via()} to`} <b>${e(pretty)}</b> <button class="u-lnkbtn" data-act="to-login">Edit</button></p>
      ${channel === 'test' ? '' : `<div class="u-deliv" id="lg-deliv">${DELIV.sent[1]}</div>`}
      <form data-form="otp-verify" data-phone="${e(phone)}">${otpBoxes()}
      <div class="u-lerr" id="lg-err" role="alert"></div><button class="btn block lg mt" type="submit">Verify and continue</button></form>
      <button class="btn ghost block mt2" id="resend" data-act="resend" data-phone="${e(phone)}" disabled>Resend code in ${wait}s</button><button class="btn ghost block mt2" data-act="to-login">Change number</button>`);
    countdown(wait); if (channel !== 'test') watchDelivery(phone);
  }
  document.addEventListener('input', (ev) => { const t = ev.target; if (t.dataset?.autosubmit && t.value.replace(/\D/g, '').length === Number(t.dataset.autosubmit)) { t.value = t.value.replace(/\D/g, ''); t.form?.requestSubmit(); } });
  PL.actions.resend = async (el) => { if (el.disabled) return; el.disabled = true; lerr('');
    try { const r = await PL.post('/api/auth/customer/otp/request', { phone: el.dataset.phone }); PL.toast(`New code sent ${via()}`, 'ok'); otpView(el.dataset.phone, r.resendAfterSec, r.channel); }
    catch (x) { lerr(x.message); if (x.retryAfterSec) countdown(x.retryAfterSec); else el.disabled = false; } };
  PL.forms['otp-verify'] = async (f) => { const v = PL.form(f); lerr('');
    if (!/^\d{6}$/.test(v.otp)) return lerr(`Enter the 6-digit code ${isSms() ? 'from the SMS' : 'from WhatsApp'}.`);
    try { const r = await PL.post('/api/auth/customer/otp/verify', { phone: f.dataset.phone, otp: v.otp }); clearInterval(delivT);
      PL.toast(r.is_new ? 'Number verified. Welcome to Pakka Local!' : 'Verified. Welcome back!', 'ok');
      PL.setSession(r); history.replaceState({ idx: 0 }, '', location.hash || '#'); PL.boot(); }
    catch (x) { lerr(x.message); otpReset(f); if (['EXPIRED', 'TOO_MANY_TRIES', 'BLOCKED'].includes(x.code)) { const b = PL.$('#resend'); if (b && x.code !== 'BLOCKED' && !/in \d+s/.test(b.textContent)) b.disabled = false; } } };


  // ---------- "What should we call you?" (required once; never asked again when a real name is saved) ----------
  const nameGate = () => { if (PL.$('#u-namegate')) return; const d = document.createElement('div'); d.id = 'u-namegate'; d.className = 'u-namegate';
    d.innerHTML = `<div class="card"><img src="/assets/logo.png" alt="" class="lg"><h2>What should we call you?</h2><p class="s">Your name is shown to the restaurant and your delivery partner with your order.</p>
      <form data-form="set-name"><label for="nm-in" class="small mute">Your name</label><input id="nm-in" name="name" autocomplete="name" maxlength="60" placeholder="e.g. Priya" required><button class="btn block lg mt" type="submit">Continue</button></form></div>`;
    document.body.append(d); PL.hydrate?.(d); setTimeout(() => d.querySelector('input')?.focus(), 200); };
  PL.forms['set-name'] = async (f) => { const name = PL.form(f).name.trim(); if (name.length < 2) return PL.toast('Please enter your name.', true);
    const r = await PL.run(() => PL.post('/api/auth/name', { name })); if (!r) return;
    const s = PL.session(); if (s) { s.user = { ...s.user, ...r.user }; PL.setSession(s); } PL.$('#u-namegate')?.remove(); PL.toast(`Welcome, ${r.user.name}!`, 'ok'); PL.boot(); };
  const checkName = async () => { const s = PL.session(); if (!s) return; let need = s.user?.needs_name;
    if (need === undefined) { try { const me = (await PL.api('/api/auth/me')).user; need = me.needs_name; s.user = { ...s.user, ...me }; PL.setSession(s); } catch { return; } }
    if (need) nameGate(); };

  // ---------- order status wording (one place, used by home, orders and tracking) ----------
  const ACTIVE = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP'];
  const SAY = { PAYMENT_PENDING: ['Waiting for payment', 'Complete the payment to place this order.'], PLACED: ['Order placed', 'Waiting for the restaurant to accept.'], ACCEPTED: ['Order accepted', 'The restaurant has your order.'],
    PREPARING: ['Being prepared', 'The kitchen is cooking your food.'], READY: ['Ready for pickup', 'Packed and waiting for your delivery partner.'], PICKED_UP: ['On the way', 'Your delivery partner is heading to you.'],
    DELIVERED: ['Delivered', 'Enjoy your meal!'], REJECTED: ['Not accepted', 'The restaurant could not take this order.'], CANCELLED: ['Cancelled', 'This order was cancelled.'], PAYMENT_FAILED: ['Payment failed', 'No order was placed.'], EXPIRED: ['Payment expired', 'No order was placed.'] };
  const PROG = { PLACED: 12, ACCEPTED: 30, PREPARING: 50, READY: 68, PICKED_UP: 86, DELIVERED: 100 };
  const minsTo = (t) => { const m = Math.round((new Date(t) - Date.now()) / 60000); return m; };
  const etaText = (o) => { if (!o.eta_at) return ''; const m = minsTo(o.eta_at); return m > 1 ? `Arriving in ~${m} min` : 'Arriving soon'; };

  // ---------- home ----------
  const LBL = { home: 'Home', hostel: 'Hostel', pg: 'PG', college: 'College', other: 'Other' };
  const addrLine = (a, noPlace) => [!noPlace && a.place_name, a.building, a.block && `Block ${a.block}`, a.floor && `Floor ${a.floor}`, a.room && `Room ${a.room}`].filter(Boolean).join(', ') || 'Saved location';
  const homeMode = () => document.body.classList.toggle('c-home', /^#\/home(\?|$)|^#?$/.test(location.hash)); window.addEventListener('hashchange', homeMode); homeMode();
  // distance from the chosen delivery address to the restaurant's saved location (straight line; shown only when both are known)
  const kmAway = (x) => { const p = S.curPt; if (!p || x.lat == null || x.lng == null) return ''; const r = Math.PI / 180, h = Math.sin((x.lat - p.lat) * r / 2) ** 2 + Math.cos(p.lat * r) * Math.cos(x.lat * r) * Math.sin((x.lng - p.lng) * r / 2) ** 2, km = 12742 * Math.asin(Math.sqrt(h));
    return km < 1 ? `${Math.max(100, Math.round(km * 10) * 100)} m away` : `${km.toFixed(1)} km away`; };
  const card = (x, i) => { const cats = catsOf(textOf(x)), eta = etaOf(x), km = kmAway(x);
    return `<button class="u-rrow u-rc ${x.is_open ? '' : 'u-closed'}" style="--i:${Math.min(i, 8)}" data-act="go" data-path="/r/${x.id}" data-s="${e(textOf(x).toLowerCase())}" data-cats="${cats.join(' ')}" data-open="${x.is_open ? 1 : 0}" data-r="${x.rating || 0}" data-eta="${x.eta_min || 999}" data-veg="${x.veg_only ? 1 : 0}" data-o="${i}">
      <span class="im">${img(coverOf(x), '', '')}
        ${x.free_delivery_above_paise && x.is_open ? `<span class="rib">FREE DELIVERY<small>above ${rs(x.free_delivery_above_paise)}</small></span>` : ''}
        ${x.veg_only ? `<span class="vegpill">${dietMark('veg')}Pure veg</span>` : ''}
        <span class="nm"><h3>${e(x.name)}</h3><small>${e(x.cuisine || 'Local favourites')}</small></span>${rateBadge(x)}
        ${x.is_open ? '' : `<span class="cl">${x.closed_reason === 'no_location' ? 'Not taking orders yet' : `Closed${x.next_open_at ? ` · ${opensTxt(x.next_open_at)}` : ''}`}</span>`}</span>
      <span class="tx">${eta && x.is_open ? `<span class="pill">${I('clock')}${eta}</span>` : ''}${km ? `<span class="pill">${I('pin')}${km.replace(' away', '')}</span>` : ''}${hoursOf(x) ? `<span class="pill soft">${hoursOf(x)}</span>` : ''}${x.min_order_paise ? `<span class="pill soft">Min ${rs(x.min_order_paise)}</span>` : ''}</span></button>`; };
  // menus of open kitchens, cached for 5 minutes (home refreshes every few seconds; menus rarely change)
  const menusFor = async (ids) => { const c = (S.mcache ||= {}), now = Date.now();
    await Promise.all(ids.filter((id) => !c[id] || now - c[id].t > 300000).map((id) => PL.api(`/api/public/restaurants/${id}/menu`).then((m) => { c[id] = { t: now, items: m.items }; }).catch(() => { c[id] = { t: now, items: [] }; })));
    return Object.fromEntries(ids.map((id) => [id, c[id]?.items || []])); };
  const arrows = (id) => `<span class="u-arr"><button data-act="hs" data-t="${id}" data-d="-1" aria-label="Scroll left">${I('chev', 'class="flip"')}</button><button data-act="hs" data-t="${id}" data-d="1" aria-label="Scroll right">${I('chev')}</button></span>`;
  PL.actions.hs = (el) => { const t = PL.$('#' + el.dataset.t); if (t) t.scrollBy({ left: Number(el.dataset.d) * t.clientWidth * 0.8, behavior: reduce() ? 'auto' : 'smooth' }); };
  const oaCard = (o) => `<div class="u-oacard"><button class="im" data-act="go" data-path="/orders/${e(o.order_code)}" aria-label="Order from ${e(o.restaurant)}">${img(restPic(o.restaurant, o.restaurant_image, o.summary), '', o.restaurant)}<span class="rn">${e(o.restaurant)}</span></button>
      <div class="bd"><div class="it">${e(o.summary || '')}</div><div class="ft"><span><b>${rs(o.total_paise)}</b><small>${PL.dt(o.created_at)}</small></span><button class="u-reo" data-act="reorder" data-code="${e(o.order_code)}" data-rid="${o.restaurant_id}">${I('refresh')} Reorder</button></div></div></div>`;
  // Reorder: the same dishes at today's prices (only those still on the menu and available); the bill is calculated again in the cart
  PL.actions.reorder = async (el) => { if (el.disabled) return; el.disabled = true; el.classList.add('busy');
    try { const [o, m] = await Promise.all([PL.api('/api/customer/orders/' + el.dataset.code), PL.api(`/api/public/restaurants/${el.dataset.rid}/menu`)]); const r = m.restaurant;
      if (!r.is_open) return PL.toast(`${r.name}: ${whyClosed(r).toLowerCase()}.${r.next_open_at ? ' ' + opensTxt(r.next_open_at) + '.' : ''}`, true);
      const items = {}, missing = [];
      for (const it of o.items) { const d = m.items.find((x) => x.name === it.name && x.available); if (d) items[d.id] = { name: d.name, price: d.price_paise, qty: Math.min(20, (items[d.id]?.qty || 0) + it.qty), diet: d.diet, img: d.image_path }; else missing.push(it.name); }
      if (!Object.keys(items).length) return PL.toast('These dishes are not available right now.', true);
      if (cartCount() && S.cart.rid !== r.id && !(await PL.confirm(`Your cart has items from ${S.cart.rname}. Replace them with this order from ${r.name}?`, 'Replace cart'))) return;
      S.cart = { rid: r.id, rname: r.name, rimg: r.image_path || null, items }; saveCart(); S.confirmed = false;
      PL.toast(missing.length ? `Added to cart. Not available now: ${missing.join(', ')}` : 'Added to your cart', missing.length ? 'info' : undefined); PL.go('/cart'); }
    catch (x) { PL.toast(x.message || 'Could not reorder right now.', true); }
    finally { el.disabled = false; el.classList.remove('busy'); } };
  // admin offers (promotional notifications) as a banner on the home screen; opening or dismissing marks it read
  const linkPath = (u) => { if (!u) return ''; try { const x = new URL(u, location.origin); if (x.origin !== location.origin || !x.pathname.startsWith('/user')) return ''; if (x.hash.startsWith('#/')) return x.hash.slice(1); const seg = x.pathname.split('/').filter(Boolean); return seg.length > 1 ? '/' + seg.slice(1).join('/') : '/home'; } catch { return ''; } };
  const banDone = (id) => { (S.banDone ||= new Set()).add(Number(id)); if (PL.markInboxRead) PL.markInboxRead(id); PL.post(`/api/push/inbox/${id}/read`).catch(() => {}); };
  PL.actions['ban-x'] = (el) => { banDone(el.dataset.id); el.closest('.u-offerbar')?.remove(); };
  PL.actions['ban-open'] = async (el) => { banDone(el.dataset.id); if (document.querySelector('.ov .u-offerpop')) await PL.closeModalAsync(); el.dataset.path ? PL.go(el.dataset.path) : PL.rerender(); };
  // the offer itself: picture (if the admin added one), title and the whole message; tapping it opens the offer's link
  const offerCard = (o) => { const path = linkPath(o.deep_link);
    return `<div class="u-offerhero" role="region" aria-label="Offer">${o.image ? `<img src="${e(o.image)}" alt="" loading="lazy">` : `<span class="ic">${I('percent')}</span>`}
      <div class="txt"><b>${e(o.title)}</b><p>${e(o.body)}</p>${path ? `<button class="btn sm" data-act="ban-open" data-id="${o.id}" data-path="${e(path)}">Order now ${I('chev')}</button>` : ''}</div>
      <button class="x" data-act="ban-x" data-id="${o.id}" aria-label="Close offer">${I('x')}</button></div>`; };
  // when the app opens: the newest offer pops up on its own (once per opening of the app), no button needed
  const offerPop = (o) => { const k = 'pl.offer.seen.' + o.id; try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch {} if (document.querySelector('.ov')) return;
    const path = linkPath(o.deep_link);
    PL.modal(`<div class="u-offerpop">${o.image ? `<img src="${e(o.image)}" alt="">` : `<span class="ic">${I('percent')}</span>`}<h3>${e(o.title)}</h3><p>${e(o.body)}</p></div>
      <div class="row mt"><button class="btn ghost grow" data-act="close-modal">Close</button>${path ? `<button class="btn grow" data-act="ban-open" data-id="${o.id}" data-path="${e(path)}">Order now</button>` : `<button class="btn grow" data-act="ban-open" data-id="${o.id}" data-path="">Got it</button>`}</div>`, { cls: 'u-offer-ov' }); };
  // the "zero extra fees" promise at the top of Home (everyone sees it, logged in or not). Honest: the bill is the menu price
  // + a delivery charge by distance; anything else (e.g. a bad-weather surge, if admin turns one on) is shown in the bill before paying.
  const ZERO = [['Platform fee', 'platform'], ['Packaging charge', 'packing'], ['Convenience fee', 'convenience']];
  const zeroCard = () => `<section class="u-zero" aria-label="No extra fees">
      <div class="zt"><span class="ztag">no cap 🧢</span><h2>Zero extra fees.<br><em>Fr fr.</em></h2><p>Menu price + delivery by distance. That’s the whole bill. No surprises at checkout.</p></div>
      <div class="zrec" aria-hidden="true"><b class="zh">Your bill, decoded</b>
        <span class="zl ok"><i>${I('check')}</i>Food at menu price</span><span class="zl ok"><i>${I('check')}</i>Delivery by distance</span>
        ${ZERO.map(([t], k) => `<span class="zl no" style="--d:${k * 120 + 200}ms"><i>₹0</i><s>${t}</s></span>`).join('')}
        <span class="zf">${I('info')} Every rupee shows before you pay</span></div>
      <div class="zchips">${['No platform fee', 'No packaging charge', 'No convenience fee', 'No hidden charges'].map((t, k) => `<span style="--d:${k * 90}ms">${t}</span>`).join('')}</div>
    </section>`;
  // opening screen: the first thing people see when they open Pakka Local (first visit, then again after a week)
  const INTRO_KEY = 'pl.intro.seen', WEEK = 7 * 864e5;
  const introDue = () => { try { return Date.now() - Number(localStorage.getItem(INTRO_KEY) || 0) > WEEK; } catch { return true; } };
  const showIntro = () => { if (!introDue() || document.getElementById('u-intro')) return;
    const el = document.createElement('div'); el.id = 'u-intro'; el.className = 'u-intro'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Welcome to Pakka Local');
    el.innerHTML = `<div class="in"><img class="lg" src="/assets/logo.png" alt="Pakka Local" width="84" height="84">${zeroCard()}
      <button class="btn block lg go" data-act="intro-go">Let’s eat ${I('chev')}</button><p class="fine">Online payment · Live order tracking · Local kitchens</p></div>`;
    document.body.append(el); setTimeout(() => el.querySelector('.go')?.focus(), 300); };
  PL.actions['intro-go'] = () => { try { localStorage.setItem(INTRO_KEY, String(Date.now())); } catch {} const el = document.getElementById('u-intro'); if (!el) return; el.classList.add('out'); setTimeout(() => el.remove(), 350); };
  showIntro();
  async function home() {
    const [c, r, my, me, adr, ob] = await Promise.all([PL.api('/api/public/config'), PL.api('/api/public/restaurants'), PL.api('/api/customer/orders').catch(() => ({ orders: [] })), PL.api('/api/customer/me').catch(() => ({ user: {} })), PL.api('/api/customer/addresses').catch(() => ({ addresses: [] })), PL.api('/api/push/banner').catch(() => ({ banner: null }))]);
    const offer = ob.banner && !S.banDone?.has(ob.banner.id) ? ob.banner : null; S.offerNow = offer;
    const all = r.restaurants, open = all.filter((x) => x.is_open), active = my.orders.filter((o) => ACTIVE.includes(o.status)), recent = my.orders.filter((o) => o.status === 'DELIVERED').slice(0, 8);
    if (c.maintenance) return maintPage(c, active);
    const ad = adr.addresses, cur = ad.find((x) => x.id === S.addrId) || ad.find((x) => x.is_default) || ad[0];
    S.curPt = cur && cur.lat != null && cur.lng != null ? { lat: cur.lat, lng: cur.lng } : null;
    const name = (me.user?.name || '').trim().split(' ')[0];
    const counts = Object.fromEntries(CATS.map(([k]) => [k, all.filter((x) => catsOf(textOf(x)).includes(k)).length]));
    const cats = CATS.filter(([k]) => counts[k]);
    // search hints = real dishes on Pakka Local right now (open kitchens first), shuffled; restaurant names fill in if menus are short
    const seen = new Set(), dn = [];
    for (const x of [...all].sort((p, q) => q.is_open - p.is_open)) for (const d of String(x.dish_names || '').split(' | ')) { const t = d.trim(), k2 = t.toLowerCase(); if (t && t.length <= 28 && !seen.has(k2)) { seen.add(k2); dn.push(t); } }
    for (let i = dn.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [dn[i], dn[j]] = [dn[j], dn[i]]; }
    S.words = dn.length ? dn.slice(0, 14) : all.map((x) => x.name).slice(0, 8);
    const ranked = [...open].sort((p, q) => (q.rating || 0) - (p.rating || 0)), menus = await menusFor(ranked.slice(0, 6).map((x) => x.id));
    const dishes = []; for (let k = 0; k < 3; k++) for (const x of ranked.slice(0, 6)) { const i = (menus[x.id] || []).filter((d) => d.available)[k]; if (i) dishes.push({ i, x, src: i.image_path ? pubImg(i.image_path) : (dishPic(i.name) || catPic(catsOf(textOf(x))[0] || 'thali')) }); }
    const picks = [...open].sort((p, q) => (q.rating || 0) - (p.rating || 0) || (q.rating_count || 0) - (p.rating_count || 0)).slice(0, 10);
    // banners: only true statements (real free-delivery rules from restaurants, real features)
    const fd = open.filter((x) => x.free_delivery_above_paise).sort((p, q) => p.free_delivery_above_paise - q.free_delivery_above_paise)[0];
    const top = cats[0];
    const plates = [...new Set([...cats.map(([k]) => k), 'biryani', 'dosa', 'thali', 'momos', 'noodles'])].slice(0, 4).map(catPic);
    // photo slides: real dishes (with photos) from open kitchens, one per restaurant first, then more; plus real offers
    // any available dish of an open kitchen; its own photo, or the matching food photo when the restaurant has not uploaded one
    const pool = []; for (let k = 0; k < 3; k++) for (const x of ranked.slice(0, 6)) { const i = (menus[x.id] || []).filter((d) => d.available)[k]; if (i) pool.push({ i, x, src: i.image_path ? pubImg(i.image_path) : (dishPic(i.name) || catPic(catsOf(textOf(x))[0] || 'thali')) }); }
    const used = new Set(), feat = [...pool.filter(({ x }) => !used.has(x.id) && used.add(x.id)), ...pool].filter((v, k, a) => a.indexOf(v) === k).slice(0, 4);
    const photoSlide = ({ i, x, src }, k) => `<button class="u-ban u-pban" data-act="sgo" data-path="/r/${x.id}" data-mq="${e(i.name)}" aria-label="${e(i.name)} from ${e(x.name)}">
        <img class="bg" src="${e(src)}" alt="" ${k ? 'loading="lazy"' : ''}><span class="shade"></span>
        <span class="k">${k === 0 ? 'Today’s pick' : x.rating >= 4 ? `★ ${Number(x.rating).toFixed(1)} rated kitchen` : 'Fresh from the kitchen'}</span>
        <b>${e(i.name)}</b><span class="s">${e(x.name)}${etaOf(x) ? ` · ${etaOf(x)}` : ''}</span>
        <span class="glass">${dietMark(i.diet)}<span class="pr">${rs(i.price_paise)}</span><span class="cta">Order now ${I('chev')}</span></span></button>`;
    const bans = [...feat.map(photoSlide), fd && `<button class="u-ban u-pban" data-act="go" data-path="/r/${fd.id}"><img class="bg" src="${e(coverOf(fd))}" alt="" loading="lazy"><span class="shade or"></span><span class="k">Free delivery</span><b>On orders above ${rs(fd.free_delivery_above_paise)}</b><span class="s">from ${e(fd.name)}</span><span class="glass"><span class="cta">Order now ${I('chev')}</span></span></button>`,
      // three colourful feature slides with floating 3D plates (real food photos); always true statements
      fxSlide(1, top ? `data-act="cat" data-k="${top[0]}"` : `data-act="go" data-path="/search"`, top ? 'Near you' : 'Hungry?', top ? `${e(top[1])} from local kitchens` : 'Local kitchens, delivered hot',
        top ? `${counts[top[0]]} restaurant${counts[top[0]] > 1 ? 's' : ''} serving it now` : 'Fresh food from kitchens around you', 'Explore', plates.slice(0, 3)),
      fxSlide(2, `data-act="go" data-path="/orders"`, 'Live tracking', 'Watch your rider on the map', 'From the restaurant to your gate', 'My orders', plates.slice(1, 2), 'route'),
      fxSlide(3, `data-act="go" data-path="/search"`, 'Easy checkout', 'Pay online. No cash needed.', 'Every charge shown before you pay', 'Order now', plates.slice(2, 3), 'card')].filter(Boolean);
    const notes = [c.paymentsAvailable === false ? `<div class="u-pill-note">${I('info')}<span>Ordering opens soon. You can browse menus now.</span></div>` : '', !c.ridersAvailable ? `<div class="u-pill-note warn">${I('bike')}<span>${e(c.noRiderMessage)}</span></div>` : ''].join('');
    const live = active[0];
    return `<div class="u-head" id="u-head"><div class="row1"><button class="u-loc" data-act="go" data-path="/addresses"><span class="pin">${I('pin')}</span><span class="txt"><b>${cur ? e(cur.kind === 'listed' ? cur.place_name || 'Selected place' : LBL[cur.label] || 'Home') : 'Set delivery location'}${I('chev')}</b><small>${c.testPayments ? '<i class="u-test">TEST</i>' : ''}${cur ? e(addrLine(cur, cur.kind === 'listed')) : 'Choose your PG, hostel or college'}</small></span></button>${PL.isGuest() ? '<button class="u-glog" data-act="to-login">Log in</button>' : `${PL.inbox.btn()}<button class="u-av" data-act="go" data-path="/me" aria-label="Account">${e((name || 'P').charAt(0).toUpperCase())}</button>`}</div>
        <a class="u-search" href="#/search" aria-label="Search for restaurants and dishes">${I('search')}<span class="ph">Search for ‘<i id="u-word">${e(S.words[0] || 'your favourite food')}</i>’</span></a></div>
      ${notes}
      ${offer ? offerCard(offer) : ''}
      ${bans.length ? `<div class="u-bans" id="u-bans">${bans.join('')}</div><div class="u-bdots" id="u-bdots">${bans.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
      ${cats.length ? `<div class="u-sec"><h2>${name ? `${e(name)}, what’s on your mind?` : 'What’s on your mind?'}</h2>${arrows('u-cats')}</div><div class="u-cats ${cats.length < 7 ? 'one' : ''}" id="u-cats">${cats.map(([k, l]) => `<button class="u-cat ${S.cat === k ? 'on' : ''}" data-act="cat" data-k="${k}" aria-pressed="${S.cat === k}"><span class="im"><img src="${catPic(k)}" alt="" loading="lazy"></span>${e(l)}</button>`).join('')}</div>` : ''}
      ${recent.length ? `<div class="u-sec"><h2>Order again<small>Your recent orders, one tap away</small></h2>${arrows('u-oa')}</div><div class="u-hscroll" id="u-oa">${recent.map((o) => oaCard(o)).join('')}</div>` : ''}
      ${picks.length > 1 ? `<div class="u-sec"><h2>Top rated near you<small>${greet()}! These kitchens are open now</small></h2>${arrows('u-picks')}</div><div class="u-hscroll" id="u-picks">${picks.map((x) => `<button class="u-pick" data-act="go" data-path="/r/${x.id}"><span class="im" style="display:block">${img(coverOf(x))}${offerOf(x)}</span><h3>${e(x.name)}</h3><span class="mt">${rateBadge(x)}${etaOf(x) ? `<span class="u-dot"></span>${etaOf(x)}` : ''}</span><div class="cu">${e(x.cuisine || 'Local favourites')}</div></button>`).join('')}</div>` : ''}
      ${dishes.length > 1 ? `<div class="u-sec"><h2>Order in one tap<small>Dishes from kitchens open now · tap ADD</small></h2>${arrows('u-dsh')}</div><div class="u-hscroll" id="u-dsh">${dishes.slice(0, 12).map(({ i, x, src }) => { const q = (S.cart.rid === x.id && S.cart.items[i.id]?.qty) || 0;
        return `<div class="u-dcard u-dc2" data-act="sgo" data-path="/r/${x.id}" data-mq="${e(i.name)}" role="link" tabindex="0"><span class="im">${img(src, '', i.name)}${i.image_path ? '' : '<i class="rep">Representative image</i>'}</span>
          <span class="nm">${dietMark(i.diet)}<b>${e(i.name)}</b></span><small>${e(x.name)}${etaOf(x) ? ` · ${etaOf(x)}` : ''}</small>
          <span class="ft"><span class="pr">${rs(i.price_paise)}</span>${q ? `<span class="u-step sm"><button data-act="dec" data-id="${i.id}" aria-label="Remove one ${e(i.name)}">−</button><span>${q}</span><button data-act="inc" data-id="${i.id}" data-rid="${x.id}" data-rn="${e(x.name)}" data-n="${e(i.name)}" data-p="${i.price_paise}" data-dt="${e(i.diet || '')}" data-im="${e(i.image_path || '')}" aria-label="Add one ${e(i.name)}">+</button></span>` : `<button class="u-add sm" data-act="inc" data-id="${i.id}" data-rid="${x.id}" data-rn="${e(x.name)}" data-n="${e(i.name)}" data-p="${i.price_paise}" data-dt="${e(i.diet || '')}" data-im="${e(i.image_path || '')}" aria-label="Add ${e(i.name)}">ADD</button>`}</span></div>`; }).join('')}</div>` : ''}
      <div class="u-sec"><h2 id="u-count">${all.length} restaurant${all.length === 1 ? '' : 's'} to explore</h2></div>
      ${all.length > 1 ? `<div class="u-chips" id="u-chips"><button class="u-chip" data-act="sort">${I('filter')} Sort${S.sort && S.sort !== 'rel' ? ': ' + { rating: 'Rating', eta: 'Fastest' }[S.sort] : ''} ${I('chev', 'style="transform:rotate(90deg);width:14px;height:14px"')}</button>${[['open', 'Open now'], ['fast', 'Under 35 mins'], ['r4', 'Rating 4.0+'], ['veg', 'Pure veg']].filter(([k]) => k !== 'veg' || all.some((x) => x.veg_only)).map(([k, l]) => `<button class="u-chip ${S.fl?.[k] ? 'on' : ''}" data-act="fl" data-k="${k}" aria-pressed="${!!S.fl?.[k]}">${l}<span class="x">${I('x')}</span></button>`).join('')}</div>` : ''}
      ${all.length ? `<div class="u-list u-in" id="u-list">${all.map(card).join('')}</div><div id="u-none" class="hide">${empty('search', 'No restaurants match', 'Try removing a filter.', '<button class="btn ghost mt" data-act="fl-clear">Clear filters</button>')}</div>` : empty('bowl', 'No restaurants yet', 'Kitchens near you will appear here soon.')}
      ${cartCount() ? `<button class="u-cartbar u-homecart" data-act="go" data-path="/cart"><span class="l"><b>${cartCount()} item${cartCount() > 1 ? 's' : ''} · ${rs(cartTotal())}</b><small>from ${e(S.cart.rname || '')}</small></span><span class="r">View cart ${I('chev')}</span></button>` : ''}
      ${live && !cartCount() ? `<button class="u-live" data-act="go" data-path="/orders/${e(live.order_code)}"><span class="ic">${I(live.status === 'PICKED_UP' ? 'bike' : live.status === 'READY' ? 'box' : 'chef')}</span><span class="txt"><b>${e(SAY[live.status]?.[0] || live.status)}</b><small>${e(live.restaurant)}${live.eta_at ? ` · ${etaText(live)}` : ''}${active.length > 1 ? ` · +${active.length - 1} more` : ''}</small></span><span class="go">Track ${I('chev')}</span></button>` : ''}
      ${bizFoot(c.business)}`;
  }
  // filters and sort work on the cards already on screen (no re-render, no lost scroll)
  const filterHome = () => { const f = S.fl || {}, k = S.cat || ''; let n = 0, all = 0; const list = PL.$('#u-list'); if (!list) return;
    const cards = [...list.children];
    cards.forEach((c) => { all++; const d = c.dataset; const ok = (!k || d.cats.split(' ').includes(k)) && (!f.open || d.open === '1') && (!f.r4 || Number(d.r) >= 4) && (!f.fast || Number(d.eta) <= 35) && (!f.veg || d.veg === '1'); c.classList.toggle('hide', !ok); n += ok; });
    const by = { rating: (a, b) => b.dataset.r - a.dataset.r, eta: (a, b) => a.dataset.eta - b.dataset.eta, rel: (a, b) => a.dataset.o - b.dataset.o }[S.sort || 'rel'];
    cards.sort((a, b) => (b.dataset.open - a.dataset.open) || by(a, b)).forEach((c) => list.appendChild(c));
    PL.$('#u-none')?.classList.toggle('hide', n > 0);
    const h = PL.$('#u-count'); if (h) h.textContent = n === all && !k ? `${all} restaurant${all === 1 ? '' : 's'} to explore` : `${n} restaurant${n === 1 ? '' : 's'}${k ? ` for ${CATS.find((x) => x[0] === k)?.[1]}` : ''}`; };
  PL.actions.fl = (el) => { S.fl = { ...(S.fl || {}), [el.dataset.k]: !S.fl?.[el.dataset.k] }; el.classList.toggle('on', S.fl[el.dataset.k]); el.setAttribute('aria-pressed', S.fl[el.dataset.k]); filterHome(); };
  PL.actions['fl-clear'] = () => { S.fl = {}; S.cat = ''; document.querySelectorAll('#u-chips .u-chip.on,#u-cats .u-cat.on').forEach((b) => b.classList.remove('on')); filterHome(); };
  PL.actions.cat = (el) => { S.cat = S.cat === el.dataset.k ? '' : el.dataset.k; document.querySelectorAll('#u-cats .u-cat').forEach((b) => { b.classList.toggle('on', b.dataset.k === S.cat); b.setAttribute('aria-pressed', b.dataset.k === S.cat); }); filterHome();
    if (S.cat) { const t = PL.$('#u-count'); if (t) scrollTo({ top: t.getBoundingClientRect().top + scrollY - 140, behavior: reduce() ? 'auto' : 'smooth' }); } };
  PL.actions.sort = () => PL.modal(`<h3>Sort restaurants</h3><div class="u-menu" style="margin-top:12px">${[['rel', 'Relevance', 'Open kitchens first'], ['rating', 'Rating: high to low', 'Based on customer ratings'], ['eta', 'Delivery time', 'Fastest first']].map(([k, l, s]) => `<button data-act="sort-set" data-k="${k}"><span class="ic">${I(k === 'rating' ? 'star' : k === 'eta' ? 'clock' : 'filter')}</span><span><b>${l}</b><small>${s}</small></span>${(S.sort || 'rel') === k ? `<span class="chev" style="color:var(--brand)">${I('check')}</span>` : ''}</button>`).join('')}</div>`);
  PL.actions['sort-set'] = (el) => { S.sort = el.dataset.k; PL.closeModal(); const b = PL.$('[data-act=sort]'); if (b) b.firstChild && (b.innerHTML = `${I('filter')} Sort${S.sort !== 'rel' ? ': ' + { rating: 'Rating', eta: 'Fastest' }[S.sort] : ''} ${I('chev', 'style="transform:rotate(90deg);width:14px;height:14px"')}`); filterHome(); };
  // home motion: rotating search word, banner auto-advance with dots, header shadow when scrolled
  // feature slide: gradient + glow, copy on the left, a small 3D stage on the right (transform-only animation: smooth on low-end phones)
  const fxSlide = (n, act, k, title, sub, cta, imgs, extra) => `<button class="u-ban u-fx fx-${n}" ${act}><span class="glow" aria-hidden="true"></span>
      <span class="fxc"><span class="k">${k}</span><b>${title}</b><span class="s">${sub}</span><span class="cta">${cta} ${I('chev')}</span></span>
      <span class="stage" aria-hidden="true">${extra === 'route' ? `<span class="map"><svg viewBox="0 0 120 80"><path class="rt" d="M12 64 C 34 30, 58 74, 78 40 S 100 14, 108 16" fill="none"/><circle class="go" r="5"><animateMotion dur="3.2s" repeatCount="indefinite" path="M12 64 C 34 30, 58 74, 78 40 S 100 14, 108 16"/></circle><circle cx="108" cy="16" r="6" class="pin"/></svg></span>` : ''}
        ${extra === 'card' ? `<span class="pay"><i class="chip"></i><i class="l1"></i><i class="l2"></i><span class="ok">${I('check')}</span></span>` : ''}
        ${imgs.map((src, j) => `<img class="pl p${j + 1}" src="${src}" alt="" loading="lazy" decoding="async">`).join('')}<i class="sp a"></i><i class="sp b"></i><i class="sp c"></i></span></button>`;
  const homeAfter = () => { filterHome(); if (S.offerNow) setTimeout(() => S.offerNow && offerPop(S.offerNow), 600);
    const w = PL.$('#u-word'), words = S.words?.length ? S.words : ['your favourite food']; let wi = 0;
    if (w && words.length > 1 && !reduce()) { const iv = setInterval(() => { if (!w.isConnected) return clearInterval(iv); wi = (wi + 1) % words.length; w.textContent = words[wi]; w.style.animation = 'none'; void w.offsetWidth; w.style.animation = ''; }, 2600); }
    const b = PL.$('#u-bans'), dots = PL.$('#u-bdots'); if (b && dots) { let touched = false; const sync = () => { const i = Math.round(b.scrollLeft / (b.firstElementChild?.offsetWidth + 12 || 1)); [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i)); };
      b.addEventListener('scroll', sync, { passive: true }); b.addEventListener('pointerdown', () => { touched = true; }, { passive: true });
      if (!reduce()) { const iv = setInterval(() => { if (!b.isConnected) return clearInterval(iv); if (touched || document.hidden || b.scrollWidth <= b.clientWidth + 4) return; const step = b.firstElementChild.offsetWidth + 12, next = b.scrollLeft + step >= b.scrollWidth - b.clientWidth + 4 ? 0 : b.scrollLeft + step; b.scrollTo({ left: next, behavior: 'smooth' }); }, 4200); } }
    const h = PL.$('#u-head'); if (h) { document.documentElement.style.setProperty('--u-headh', h.offsetHeight + 'px'); } };
  addEventListener('scroll', () => { const h = PL.$('#u-head'); if (h) h.classList.toggle('stuck', scrollY > 8); }, { passive: true });

  // ---------- search (restaurants and dishes) ----------
  const recentQ = () => load('pl.recentq', []);
  async function search() { const r = await PL.api('/api/public/restaurants'); S.allR = r.restaurants;
    const cats = CATS.filter(([k]) => r.restaurants.some((x) => catsOf(textOf(x)).includes(k)));
    // before typing: real dishes to try and the kitchens open right now
    const pool = [...new Set(r.restaurants.filter((x) => x.is_open).flatMap((x) => String(x.dish_names || '').split(' | ').map((d) => d.trim()).filter((d) => d && d.length <= 28)))];
    const popular = pool.sort(() => Math.random() - 0.5).slice(0, 10), open = r.restaurants.filter((x) => x.is_open).slice(0, 8);
    return `<div class="u-shead"><button class="bk" data-act="back" aria-label="Back">${I('chev')}</button><label class="u-search">${I('search')}<input id="s-q" type="search" value="${e(S.sq || '')}" placeholder="Search restaurants and dishes" autocomplete="off" aria-label="Search restaurants and dishes"><button class="x ${S.sq ? '' : 'hide'}" data-act="sq-clear" aria-label="Clear">${I('x')}</button></label></div>
      <div id="s-out"></div>
      <div id="s-idle">${recentQ().length ? `<div class="u-sec" style="margin-top:14px"><h2 style="font-size:1rem">Recent searches</h2><button class="lk" data-act="sq-forget">Clear</button></div><div class="u-recent">${recentQ().map((q) => `<button data-act="sq" data-q="${e(q)}">${I('clock')}${e(q)}</button>`).join('')}</div>` : ''}
        ${cats.length ? `<div class="u-sec"><h2 style="font-size:1rem">Popular cuisines</h2></div><div class="u-cats one">${cats.map(([k, l]) => `<button class="u-cat" data-act="sq" data-q="${e(l.split(' ')[0])}"><span class="im"><img src="${catPic(k)}" alt="" loading="lazy"></span>${e(l)}</button>`).join('')}</div>` : ''}
        ${popular.length ? `<div class="u-sec"><h2 style="font-size:1rem">Try something new</h2></div><div class="u-tryq">${popular.map((d) => `<button data-act="sq" data-q="${e(d)}">${I('search')}${e(d)}</button>`).join('')}</div>` : ''}
        ${open.length ? `<div class="u-sec"><h2 style="font-size:1rem">Open now</h2></div><div class="u-slist">${open.map((x) => `<button class="u-sres" data-act="go" data-path="/r/${x.id}">${img(coverOf(x))}<span class="txt"><b>${e(x.name)}</b><small>${x.rating ? `★ ${Number(x.rating).toFixed(1)} · ` : ''}${e(x.cuisine || 'Local favourites')}${etaOf(x) ? ` · ${etaOf(x)}` : ''}</small></span><span class="ty">${I('chev')}</span></button>`).join('')}</div>` : ''}</div>`; }
  const runSearch = () => { const out = PL.$('#s-out'), idle = PL.$('#s-idle'); if (!out) return; const q = (S.sq || '').trim().toLowerCase(); PL.$('#s-q')?.nextElementSibling?.classList.toggle('hide', !q);
    idle?.classList.toggle('hide', !!q); if (!q) { out.innerHTML = ''; return; }
    const rest = (S.allR || []).filter((x) => textOf(x).toLowerCase().includes(q) || catsOf(textOf(x)).some((k) => CATS.find((c) => c[0] === k)[1].toLowerCase().includes(q)));
    const dishes = (S.allR || []).flatMap((x) => (x.dish_names || '').split(' | ').filter((d) => d && d.toLowerCase().includes(q)).map((d) => ({ d, x, i: S.menus?.[x.id]?.find((m) => m.name === d) }))).slice(0, 20);
    const need = [...new Set(dishes.filter((r) => !S.menus?.[r.x.id]).map((r) => r.x.id))];      // load those menus once for real dish photos and prices
    if (need.length) Promise.all(need.map((id) => PL.api(`/api/public/restaurants/${id}/menu`).then((m) => { (S.menus ||= {})[id] = m.items; }).catch(() => { (S.menus ||= {})[id] = []; }))).then(() => { if ((S.sq || '').trim().toLowerCase() === q) runSearch(); });
    out.innerHTML = !rest.length && !dishes.length ? empty('search', `No results for “${e(S.sq.trim())}”`, 'Check the spelling or try a cuisine like biryani or dosa.')
      : `${rest.length ? `<div class="u-sec" style="margin-top:14px"><h2 style="font-size:1rem">Restaurants</h2></div>${rest.map((x) => `<button class="u-sres" data-act="sgo" data-path="/r/${x.id}">${img(coverOf(x))}<span class="txt"><b>${e(x.name)}</b><small>${x.rating ? `★ ${Number(x.rating).toFixed(1)} · ` : ''}${e(x.cuisine || '')}${x.is_open ? '' : ' · Closed'}</small></span><span class="ty">Restaurant</span></button>`).join('')}` : ''}
         ${dishes.length ? `<div class="u-sec"><h2 style="font-size:1rem">Dishes</h2></div>${dishes.map(({ d, x, i }) => `<button class="u-sres" data-act="sgo" data-path="/r/${x.id}" data-mq="${e(d)}">${i?.image_path ? img(pubImg(i.image_path)) : dishPic(d) ? img(dishPic(d)) : '<span class="ph"></span>'}<span class="txt"><b>${i ? dietMark(i.diet) + ' ' : ''}${e(d)}</b><small>${i ? `${rs(i.price_paise)} · ` : ''}in ${e(x.name)}${x.is_open ? '' : ' · Closed'}</small></span><span class="ty">Dish</span></button>`).join('')}` : ''}`; };
  document.addEventListener('input', (ev) => { if (ev.target.id === 's-q') { S.sq = ev.target.value; runSearch(); } });
  PL.actions.sq = (el) => { S.sq = el.dataset.q; const i = PL.$('#s-q'); if (i) i.value = S.sq; runSearch(); };
  PL.actions['sq-clear'] = () => { S.sq = ''; const i = PL.$('#s-q'); if (i) { i.value = ''; i.focus(); } runSearch(); };
  PL.actions['sq-forget'] = () => { save('pl.recentq', []); PL.rerender(); };
  PL.actions.sgo = (el) => { const q = (S.sq || '').trim(); if (q) save('pl.recentq', [q, ...recentQ().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6)); S.mq = el.dataset.mq || ''; PL.go(el.dataset.path); };

  // ---------- restaurant menu ----------
  async function menu({ id }) {
    const [c, m] = await Promise.all([PL.api('/api/public/config'), PL.api(`/api/public/restaurants/${id}/menu`)]); const r = m.restaurant, inCart = (i) => (S.cart.rid === r.id && S.cart.items[i]?.qty) || 0;
    S.menuR = r; S.menuItems = Object.fromEntries(m.items.map((i) => [i.id, i]));
    const addAttrs = (i) => `data-id="${i.id}" data-rid="${r.id}" data-rn="${e(r.name)}" data-n="${e(i.name)}" data-p="${i.price_paise}" data-dt="${e(i.diet || '')}" data-im="${e(i.image_path || '')}"`;
    const ctl = (i) => (!i.available ? '<span class="u-so">Sold out</span>' : !r.is_open ? '' : inCart(i.id) ? `<div class="u-step ${S.popId == i.id ? 'pop' : ''}"><button data-act="dec" data-id="${i.id}" aria-label="Remove one ${e(i.name)}">−</button><span>${inCart(i.id)}</span><button data-act="inc" ${addAttrs(i)} aria-label="Add one ${e(i.name)}">+</button></div>` : `<button class="u-add" data-act="inc" ${addAttrs(i)} aria-label="Add ${e(i.name)}">ADD</button>`);
    const dish = (i) => `<div class="u-dish ${i.available ? '' : 'na'}" data-act="dish" data-id="${i.id}" data-s="${e([i.name, i.description].join(' ').toLowerCase())}" data-dt="${e(i.diet || '')}"><div class="tx">${dietMark(i.diet)}<h3>${e(i.name)}</h3><div class="pr">${rs(i.price_paise)}</div>
        ${i.description ? `<div class="ds">${e(i.description)}</div>` : ''}<div class="fine">~${i.prep_time_min} min to prepare</div></div>
      <div class="side ${i.image_path || repPic(i) ? '' : 'noimg'}">${i.image_path ? img(pubImg(i.image_path), '', i.name) : repPic(i) ? `<span class="rep">${img(repPic(i), '', '')}<i>Representative image</i></span>` : ''}<div class="ctl">${ctl(i)}</div></div></div>`;
    const known = new Set(m.categories.map((x) => x.id));
    const groups = [...m.categories.map((x) => [x.name, m.items.filter((i) => i.category_id === x.id)]), [m.categories.length ? 'More dishes' : 'Menu', m.items.filter((i) => !known.has(i.category_id))]].filter((g) => g[1].length);
    S.menuGroups = groups.map(([n, l]) => [n, l.length]);
    const prep = m.items.length ? Math.round(m.items.reduce((a, i) => a + (i.prep_time_min || 0), 0) / m.items.length) : 0;
    const inThis = S.cart.rid === r.id && cartCount(), hasDiet = m.items.some((i) => i.diet), col = (S.col ||= {})[r.id] ||= {};
    const offers = [r.free_delivery_above_paise && [I('bike'), `Free delivery above ${rs(r.free_delivery_above_paise)}`, 'Delivery charge waived on bigger orders'], r.min_order_paise && [I('receipt'), `Minimum order ${rs(r.min_order_paise)}`, 'Item total needed to order']].filter(Boolean);      // "pay online" is said at checkout; here only real offers
    const cover = r.image_path ? pubImg(r.image_path) : catPic(catsOf(textOf({ ...r, dish_names: m.items.map((i) => i.name).join(' ') }))[0] || 'thali');
    return `<div class="u-hero">${img(cover, '', r.name)}<div class="tb"><button class="u-iconbtn" data-act="back" aria-label="Back">${I('chev', 'class="flip"')}</button><div class="grp"><button class="u-iconbtn" data-act="focus-mq" aria-label="Search the menu">${I('search')}</button></div></div></div>
      <div class="u-rinfo"><div class="r1"><div style="min-width:0"><h1>${e(r.name)}</h1><div class="cu">${e(r.cuisine || 'Local favourites')}</div></div><div class="rbox ${r.rating ? '' : 'new'}"><b>${r.rating ? star + Number(r.rating).toFixed(1) : 'New'}</b><span>${r.rating_count ? `${kfmt(r.rating_count)} ratings` : 'No ratings'}</span></div></div>
        ${r.description ? `<div class="ds">${e(r.description)}</div>` : ''}${r.operating_info ? `<div class="ds">${e(r.operating_info)}</div>` : ''}
        <div class="facts"><div>${I('clock')}<span class="txt"><b>${prep ? `${prep + (r.packing_buffer_min || 0)} mins` : '–'}</b><small>to prepare</small></span></div><div>${I(r.is_open ? 'check' : 'clock')}<span class="txt"><b>${r.is_open ? 'Open now' : r.closed_reason === 'no_location' ? 'Not taking orders' : 'Closed'}</b><small>${!r.is_open && r.next_open_at ? opensTxt(r.next_open_at) : hoursOf(r) ? `Today ${hoursOf(r)}` : r.is_open ? 'Taking orders' : 'Not taking orders'}</small></span></div></div></div>
      ${maintNote(c)}${noRiders(c)}${r.is_open ? '' : `<div class="u-note bad">${I('clock')}<span>${r.closed_reason === 'no_location' ? 'This restaurant is not taking orders yet (it is still being set up). You can browse the menu.' : `${whyClosed(r)}${r.next_open_at ? ` · ${opensTxt(r.next_open_at)}` : ''}. You can browse the menu; ordering opens when it reopens.`}</span></div>`}
      ${offers.length ? `<div class="u-offers">${offers.map(([ic, b, s]) => `<div class="u-offer"><span class="ic">${ic}</span><span class="txt"><b>${b}</b><small>${s}</small></span></div>`).join('')}</div>` : ''}
      ${m.items.length ? `<div class="u-mbar"><label class="u-search">${I('search')}<input id="m-q" type="search" value="${e(S.mq || '')}" placeholder="Search for dishes" autocomplete="off" aria-label="Search dishes"></label>${hasDiet ? `<button class="u-veg ${S.veg ? 'on' : ''}" data-act="veg" aria-pressed="${!!S.veg}">${dietMark('veg')}<span>Veg</span><span class="tg"></span></button>` : ''}</div>` : ''}
      ${groups.map(([n, list], gi) => `<section class="u-msec ${col[gi] ? 'shut' : ''}" id="cat-${gi}"><button data-act="col" data-i="${gi}" data-r="${r.id}" aria-expanded="${!col[gi]}"><h2>${e(n)}<small>${list.length}</small></h2>${I('chev')}</button><div class="u-dishes" data-g="${gi}">${list.map(dish).join('')}</div></section>`).join('') || empty('bowl', 'Menu coming soon', 'This kitchen hasn’t added dishes yet.')}
      ${groups.length > 1 ? `<button class="u-fab ${inThis ? 'up' : ''}" data-act="menu-sheet">${I('menu')} MENU</button>` : ''}
      ${inThis ? `<button class="u-cartbar" data-act="go" data-path="/cart"><span class="l"><b>${cartCount()} item${cartCount() > 1 ? 's' : ''} added</b><small>${rs(cartTotal())} · delivery charge shown in cart</small></span><span class="r">View cart ${I('chev')}</span></button>` : ''}`;
  }
  const repPic = (i) => dishPic(i.name);
  // friendly bill lines: fees other apps add that Pakka Local doesn't (a different line each day, our own words)
  // Only fees Pakka Local really never charges (no platform, packaging, convenience or small-cart fee exists in the app).
  const QUIPS = {
    platform: ['We don’t charge you for opening an app 😌', '₹0. Pinky promise 🤙', 'Left it at the kitchen door 🚪', 'Our app, our treat 💛', 'Zero. Today, tomorrow, always ✨', 'Fees for scrolling? Not in this town 😄', 'Not our style, never will be 😎'],
    packing: ['The box is on us 📦', 'Wrapped with love, billed with none 💛', 'Packed tight, priced right: ₹0 🎁', 'Your biryani’s jacket is free 🧥', 'We pack it, we pay for it 🤝', 'Containers come free, hugs too 🤗', 'Pack charges? Never packed those 😏'],
    convenience: ['Convenience should be free, so it is ✨', 'Easy ordering, zero extra 🙌', 'Inconvenient fee? Skipped 🙅', 'Tap, eat, repeat. Free 🔁', 'The only convenience fee is your smile 😁', 'Ordering made easy, not pricey 💸', 'Couch to kitchen, no extra charge 🛋️'],
  };
  const quip = (k) => { const d = new Date(), i = (d.getDate() * 3 + d.getHours() + (k === 'packing' ? 2 : k === 'convenience' ? 5 : 0)) % QUIPS[k].length; return QUIPS[k][i]; };
  const SAVED = ['No sneaky fees. Just good food 🍛', 'You just skipped 3 fees other apps love 🎉', 'Honest bill, happy belly 😋', 'What you see is what you pay 👀', 'Local food, fair price 🏡'];
  const noFees = () => `<div class="kv nofee"><span><s>Platform fee</s></span><span class="quip">${quip('platform')}</span></div><div class="kv nofee"><span><s>Packaging charge</s></span><span class="quip">${quip('packing')}</span></div><div class="kv nofee"><span><s>Convenience fee</s></span><span class="quip">${quip('convenience')}</span></div>`;
  const savedNote = () => `<div class="u-saved">${SAVED[(new Date().getDate() + new Date().getHours()) % SAVED.length]}</div>`;
  PL.actions['why-delivery'] = () => PL.modal(`<h3>Why a delivery charge?</h3><p class="mt2">It goes to the delivery partner who rides from the kitchen to your door. Kitchens closer to you cost less to deliver from.</p>
    <div class="u-note info mt">${I('info')}<span>No platform fee and no packaging charge. Your bill shows every rupee before you pay.</span></div><button class="btn block mt" data-act="close-modal">Got it</button>`);
  PL.actions['close-modal'] = () => PL.closeModal();      // dish has no photo of its own: a photo of its kind, labelled as such
  // maintenance mode (set by admin): a calm full screen on home; a note on menus and cart. Tracking and help keep working.
  const maintNote = (c) => (c?.maintenance ? `<div class="u-note warn">${I('info')}<span><b>Under maintenance.</b> ${e(c.maintenance.message)}</span></div>` : '');
  const maintPage = (c, active) => `<div class="u-pg" style="text-align:center;padding-top:48px"><img src="/assets/icon-192.png" alt="" width="88" height="88" style="border-radius:22px"><h2 class="mt">We’ll be right back</h2><p class="mute mt2" style="max-width:420px;margin-left:auto;margin-right:auto">${e(c.maintenance.message)}</p>
    ${active.length ? `<button class="btn block mt" data-act="go" data-path="/orders">Track my order${active.length > 1 ? 's' : ''}</button>` : `<button class="btn ghost block mt" data-act="go" data-path="/orders">My orders</button>`}<button class="btn ghost block mt2" data-act="go" data-path="/support">Help</button></div>`;
  const noRiders = (c) => (c.ridersAvailable ? '' : `<div class="u-pill-note warn">${I('bike')}<span>${e(c.noRiderMessage)}</span></div>`);
  const filterMenu = () => { const q = (S.mq || '').trim().toLowerCase(); let n = 0; S.popId = null;
    document.querySelectorAll('.u-dishes').forEach((g) => { let k = 0; g.querySelectorAll('.u-dish').forEach((d) => { const ok = (!q || d.dataset.s.includes(q)) && (!S.veg || d.dataset.dt === 'veg'); d.classList.toggle('hide', !ok); k += ok; });
      const sec = g.closest('.u-msec'); sec?.classList.toggle('hide', !k); if (q && k) sec?.classList.remove('shut'); n += k; });
    let none = PL.$('#m-none'); if ((!q && !S.veg) || n) none?.remove(); else if (!none) { none = document.createElement('div'); none.id = 'm-none'; none.innerHTML = empty('search', 'No dish matches', S.veg ? 'Turn off “veg only” or try another name.' : 'Try another name.'); PL.$('.u-mbar')?.after(none); } };
  document.addEventListener('input', (ev) => { if (ev.target.id === 'm-q') { S.mq = ev.target.value; filterMenu(); } });
  PL.actions.veg = (el) => { S.veg = !S.veg; el.classList.toggle('on', S.veg); el.setAttribute('aria-pressed', S.veg); filterMenu(); };
  PL.actions['focus-mq'] = () => { const i = PL.$('#m-q'); if (!i) return; scrollTo({ top: i.getBoundingClientRect().top + scrollY - 90, behavior: reduce() ? 'auto' : 'smooth' }); setTimeout(() => i.focus(), 250); };
  PL.actions.col = (el) => { const c = S.col[el.dataset.r]; c[el.dataset.i] = !c[el.dataset.i]; const s = el.closest('.u-msec'); s.classList.toggle('shut', c[el.dataset.i]); el.setAttribute('aria-expanded', !c[el.dataset.i]); };
  const jump = (i) => { const t = PL.$('#cat-' + i); if (!t) return; t.classList.remove('shut'); const c = S.col?.[S.menuR?.id]; if (c) c[i] = false; scrollTo({ top: t.getBoundingClientRect().top + scrollY - (innerWidth >= 1000 ? 150 : 70), behavior: reduce() ? 'auto' : 'smooth' }); };
  PL.actions['menu-sheet'] = () => PL.modal(`<h3>Menu</h3><div class="u-msheet">${(S.menuGroups || []).map(([n, k], i) => `<button data-act="jump" data-i="${i}">${e(n)}<span>${k}</span></button>`).join('')}</div>`);
  PL.actions.jump = (el) => { PL.closeModal(); setTimeout(() => jump(el.dataset.i), 260); };
  PL.actions.dish = (el, ev) => { if (ev?.target?.closest?.('button')) return; const i = S.menuItems?.[el.dataset.id], r = S.menuR; if (!i) return;
    const q = (S.cart.rid === r.id && S.cart.items[i.id]?.qty) || 0;
    PL.modal(`<div class="u-dsheet">${i.image_path ? img(pubImg(i.image_path), 'big', i.name) : repPic(i) ? `<span class="rep">${img(repPic(i), 'big', '')}<i>Representative image</i></span>` : ''}<div class="bd">${dietMark(i.diet)}<h3>${e(i.name)}</h3>${i.description ? `<div class="ds">${e(i.description)}</div>` : ''}<div class="small mute mt2">About ${i.prep_time_min} min to prepare</div>
      <div class="ft"><b>${rs(i.price_paise)}</b>${!i.available ? '<span class="u-so">Sold out</span>' : !r.is_open ? '<span class="u-so">Restaurant closed</span>' : `<button class="btn green" data-act="inc" data-close="1" data-id="${i.id}" data-rid="${r.id}" data-rn="${e(r.name)}" data-n="${e(i.name)}" data-p="${i.price_paise}" data-dt="${e(i.diet || '')}" data-im="${e(i.image_path || '')}">${q ? `Add one more · ${q} in cart` : 'Add item'}</button>`}</div></div></div>`); };
  PL.actions.inc = async (el) => { const d = el.dataset, id = d.id;
    if (d.rid && S.cart.rid !== Number(d.rid) && cartCount() && !(await PL.confirm(`Your cart has items from ${S.cart.rname}. Start a new cart with ${d.rn}?`, 'Start new cart', { text: 'Items already in your cart will be removed.' }))) return;
    if (d.rid && S.cart.rid !== Number(d.rid)) S.cart = { rid: Number(d.rid), rname: d.rn, items: {} };
    const it = S.cart.items[id] || (S.cart.items[id] = { name: d.n, price: Number(d.p), qty: 0 }); if (d.dt) it.diet = d.dt; if (d.im) it.img = d.im;
    if (it.qty >= 20) return PL.toast('You can add up to 20 of one dish.', true);
    it.qty++; if (S.menuR?.id === S.cart.rid) S.cart.rimg = S.menuR.image_path || S.cart.rimg; saveCart(); S.popId = id; if (navigator.vibrate) navigator.vibrate(8);
    if (d.close) PL.closeModal(); PL.rerender(); };
  PL.actions.dec = (el) => { const it = S.cart.items[el.dataset.id]; if (!it) return; it.qty--; if (it.qty <= 0) delete S.cart.items[el.dataset.id]; if (!cartCount()) S.cart.rid = null; S.popId = el.dataset.id; saveCart(); PL.rerender(); };

  // ---------- cart + checkout (same rules: server quote, confirmed destination, online payment only) ----------
  const body = () => ({ restaurant_id: S.cart.rid, items: Object.entries(S.cart.items).map(([id, i]) => ({ id: Number(id), qty: i.qty })), instructions: S.instr || undefined, address_id: S.addrId || undefined, coupon: S.coupon || undefined });
  async function cart() {
    if (!cartCount()) return `<div class="u-pg">${empty('bag', 'Your cart is empty', 'Good food is always cooking. Go ahead, order some yummy items from the menu.', '<button class="btn mt" data-act="go" data-path="/home">Browse restaurants</button>')}</div>`;
    const [{ addresses: ad, gps_per_km_paise: perKm }, { locations: places }, crest] = await Promise.all([PL.api('/api/customer/addresses'), PL.api(placesUrl()), cartRest()]);
    const placeOf = (x) => places.find((l) => l.id === x.delivery_location_id);
    if (!ad.some((x) => x.id === S.addrId)) { S.addrId = (ad.find((x) => x.is_default) || ad[0])?.id || null; save('pl.addr', S.addrId); S.confirmed = false; }
    let sel = ad.find((x) => x.id === S.addrId);
    if (!S.method) S.method = sel ? (sel.kind === 'listed' ? 'list' : 'gps') : places.length ? 'list' : 'gps';
    const mine = [...ad].sort((p, q) => q.is_default - p.is_default);
    let q = null, err = null;
    if (sel) { try { q = await PL.post('/api/customer/quote', body());
      if (q.coupon_error && S.coupon) { S.couponErr = `${S.coupon}: ${q.coupon_error}`; S.coupon = null; q = await PL.post('/api/customer/quote', body()); }      // the server said no: show why and price without it
    } catch (x) { err = x; } }
    if (!S.offers || S.offers.rid !== S.cart.rid || Date.now() - S.offers.t > 60000) S.offers = { rid: S.cart.rid, t: Date.now(), list: (await PL.api('/api/customer/coupons?restaurant_id=' + S.cart.rid).catch(() => ({ coupons: [] }))).coupons };
    const items = `<div class="u-box"><div class="u-crest">${img(restPic(S.cart.rname, S.cart.rimg, Object.values(S.cart.items).map((i) => i.name).join(' ')))}<span class="txt"><b>${e(S.cart.rname)}</b><small>${cartCount()} item${cartCount() > 1 ? 's' : ''} · ${rs(cartTotal())}</small></span></div>
      <div class="mt2">${Object.entries(S.cart.items).map(([id, i]) => `<div class="u-cline"><div class="nm"><b>${i.diet ? dietMark(i.diet) : ''}<span>${e(i.name)}</span></b><small>${rs(i.price)} each</small></div><div class="rt"><div class="u-step sm ${S.popId == id ? 'pop' : ''}"><button data-act="dec" data-id="${id}" aria-label="Remove one ${e(i.name)}">−</button><span>${i.qty}</span><button data-act="inc" data-id="${id}" aria-label="Add one ${e(i.name)}">+</button></div><span class="amt">${rs(i.price * i.qty)}</span></div></div>`).join('')}</div>
      <button class="u-addmore" data-act="go" data-path="/r/${S.cart.rid}">${I('plus')} Add more items</button>
      <textarea class="u-ta" data-bind="instr" maxlength="300" placeholder="Add a note for the restaurant (optional)" aria-label="Note for this order">${e(S.instr)}</textarea></div>`;
    const acard = (x) => { const pl = placeOf(x), on = sel && x.id === sel.id; return `<label class="u-addr addr-pick ${on ? 'on' : ''}"><input type="radio" name="addr" value="${x.id}" ${on ? 'checked' : ''}><span class="t"><b>${e(x.kind === 'listed' ? (pl?.name || x.place_name) : LBL[x.label])}</b>${x.is_default ? ' <span class="u-pill" style="height:20px;font-size:.66rem">Default</span>' : ''}
      <div class="l1">${e(addrLine(x, x.kind === 'listed'))}</div>${x.entrance || x.landmark ? `<div class="l2">${e([x.entrance, x.landmark].filter(Boolean).join(' · '))}</div>` : ''}<div class="l2">${x.lat != null ? `GPS ±${Math.round(x.accuracy_m)} m` : 'Uses the place’s map point'}</div></span>
      <span class="fee">${x.kind === 'listed' && !pl ? 'Unavailable' : x.lat != null ? estTxt(x, crest, perKm) : placeEst(pl)}</span></label>`; };
    // one question, two plain answers; each goes straight to the screen that finishes it
    const choice = (path, icon, title, sub) => `<button class="u-choice" data-act="go" data-path="${path}"><span class="ic">${I(icon)}</span><span class="txt"><b>${title}</b><small>${sub}</small></span>${I('chev')}</button>`;
    const addrPart = `${mine.length ? `<div class="u-picklbl">Your saved addresses</div>${mine.map(acard).join('')}<div class="u-picklbl">Or add a new one</div>` : '<p class="u-pickq">Where should we deliver?</p>'}
      ${places.length ? choice('/places?back=cart', 'shop', 'My PG, hostel or college', 'Search its name and pick it') : ''}
      ${choice('/addresses/new?back=cart', 'pin', places.length ? 'Somewhere else' : 'My current location', 'Use your phone’s location')}
      ${sel && sel.kind !== 'listed' ? `<button class="u-lnk" data-act="go" data-path="/addresses/${sel.id}?back=cart&gps=1">${I('refresh')} I’ve moved: update my location</button>` : ''}`;
    const offTxt = (c) => (c.discount_type === 'percent' ? `${c.value / 100}% off` : `${rs(c.value)} off`) + (c.max_discount_paise ? ` up to ${rs(c.max_discount_paise)}` : '') + (c.min_order_paise ? ` on orders above ${rs(c.min_order_paise)}` : '');
    const coupon = `<div class="u-box u-coupon"><h3>${I('receipt')} Offers & coupons</h3>${q?.coupon_code ? `<div class="u-capplied"><span class="tk">${I('check')}</span><span class="txt"><b>${e(q.coupon_code)} applied</b><small>You save ${rs(q.discount_paise)} on this order</small></span><button class="btn ghost sm" data-act="coupon-off">Remove</button></div>`
      : `<form class="u-cform" data-form="coupon"><input name="code" data-bind="couponTry" placeholder="Enter coupon code" autocomplete="off" autocapitalize="characters" maxlength="24" aria-label="Coupon code" value="${e(S.couponTry || '')}"><button class="btn sm" type="submit">Apply</button></form>
        ${S.couponErr ? `<div class="u-cerr">${I('alert')}<span>${e(S.couponErr)}</span></div>` : ''}
        ${(S.offers?.list || []).slice(0, 4).map((c) => `<div class="u-cchip"><span class="txt"><b>${e(c.code)}</b><small>${e(c.description || offTxt(c))}</small></span><button class="btn ghost sm" data-act="coupon-use" data-code="${e(c.code)}">Apply</button></div>`).join('')}`}</div>`;
    const confirm = sel ? `<label class="u-confirm ${S.confirmed ? 'ok' : ''}"><input type="checkbox" id="confirm-dest" ${S.confirmed ? 'checked' : ''}><span>${sel.kind === 'listed' ? `Deliver to <b>${e(addrLine(sel))}</b>. This is the place I am ordering for.` : `Deliver to this point. The location was captured ${PL.dt(sel.captured_at)} and I am ordering for that place.`}</span></label>` : '';
    const bill = q ? `<div class="u-box u-bill"><h3>${I('receipt')} Bill details</h3><div class="mt2"><div class="kv"><span>Item total</span><span>${rs(q.items_paise)}</span></div>
        <div class="kv"><span>Delivery charge<button type="button" class="why" data-act="why-delivery">Why this?</button><small>${(q.delivery_pricing === 'distance' || q.delivery_pricing === 'gps_per_km') && q.delivery_distance_km != null ? `${e(q.delivery_distance_km)} km from ${e(S.cart.rname)}` : q.delivery_pricing === 'distance_fallback' ? 'Standard charge' : q.delivery_type === 'listed' ? e(q.delivery_location) : 'By distance'}${q.delivery_paise < q.delivery_fee_before_offers_paise ? ' · free above the restaurant’s minimum' : ''}</small></span><span>${q.delivery_paise < q.delivery_fee_before_offers_paise ? `<s class="mute" style="font-weight:500;margin-right:6px">${rs(q.delivery_fee_before_offers_paise)}</s>` : ''}${q.delivery_paise ? rs(q.delivery_paise) : '<b class="free">FREE</b>'}</span></div>
        ${noFees()}
        ${q.delivery_fallback ? `<div class="u-note info small">${I('info')}<span>We couldn’t measure the road distance right now, so the standard delivery charge applies.</span></div>` : ''}${q.surge_paise ? `<div class="kv"><span>Surge charge</span><span>${rs(q.surge_paise)}</span></div>` : ''}${q.tax_paise ? `<div class="kv"><span>Taxes</span><span>${rs(q.tax_paise)}</span></div>` : ''}
        ${q.discount_paise ? `<div class="kv save"><span>Coupon ${e(q.coupon_code)}<small>Paid by Pakka Local</small></span><span>− ${rs(q.discount_paise)}</span></div>` : ''}
        <div class="kv tot"><span>To pay</span><span>${rs(q.total_paise)}</span></div>${savedNote()}</div>${q.trip_km != null ? `<div class="u-trip">${I('nav')}<span>${q.trip_by_road ? `<b>${q.trip_km} km</b> by road from ${e(S.cart.rname)}` : `About <b>${q.trip_km} km</b> from ${e(S.cart.rname)} <small>(straight line)</small>`}</span></div>` : ''}<div class="small mute">Estimated delivery in ~${q.prep_min + 8 + q.delivery_min} min${q.trip_km != null ? '' : ' (restaurant location not set)'}</div></div>` : '';
    // compact "Deliver to" card; the full chooser opens only when changing it
    const open = !sel || S.addrOpen, spl = sel && placeOf(sel);
    const deliver = open ? `<div class="u-box u-deliver" id="u-deliver"><div class="row between"><h3>${I('pin')} Deliver to</h3>${sel ? '<button class="btn ghost sm" data-act="addr-done">Done</button>' : ''}</div>${addrPart}</div>`
      : `<div class="u-box u-deliver" id="u-deliver"><div class="u-dto"><span class="ic">${I(sel.kind === 'listed' ? 'shop' : 'pin')}</span><span class="txt"><small>Deliver to</small><b>${e(sel.kind === 'listed' ? (spl?.name || sel.place_name) : LBL[sel.label])}</b><span>${e(addrLine(sel, sel.kind === 'listed'))}</span>${sel.entrance || sel.landmark ? `<span class="mute">${e([sel.entrance, sel.landmark].filter(Boolean).join(' · '))}</span>` : ''}</span><button class="btn ghost sm" data-act="addr-change">Change</button></div>${confirm}</div>`;
    // 1-2-3 guide: where to deliver -> confirm the place -> pay
    const stepN = !sel ? 1 : !S.confirmed ? 2 : 3;
    const steps = `<ol class="u-steps3">${['Delivery place', 'Confirm', 'Pay'].map((t, k) => `<li class="${k + 1 < stepN ? 'done' : k + 1 === stepN ? 'cur' : ''}"><span>${k + 1 < stepN ? I('check') : k + 1}</span>${t}</li>`).join('')}</ol>`;
    return `<div class="u-pg u-checkout">${steps}${deliver}${items}${coupon}
      ${err ? `<div class="u-note ${err.code === 'NO_RIDERS' ? '' : 'bad'}">${I('alert')}<span>${e(err.message)}${err.code === 'NO_MAP_POINT' && sel ? `<br><button class="btn sm mt2" data-act="go" data-path="/addresses/${sel.id}?back=cart&gps=1">Add my GPS location</button>` : ''}</span></div>` : ''}
      ${bill}
      <div class="u-cod">${I('shield')} Online payment only. Cash on delivery is not available.</div></div>
      <div class="u-paybar"><span class="l"><b>${q ? rs(q.total_paise) : rs(cartTotal())}</b><small>${q ? (q.discount_paise ? `To pay · saved ${rs(q.discount_paise)}` : 'To pay') : 'Item total'}</small></span><button class="go" data-act="${!sel || !S.confirmed ? 'to-deliver' : inApp() ? 'place' : 'install-gate'}" ${!sel || (!S.confirmed && q && !err) || (q && !err && S.confirmed) ? '' : 'disabled'}>${!sel ? 'Choose where to deliver' : !S.confirmed ? 'Confirm delivery point' : !q ? 'Not available' : inApp() ? `Continue to payment ${I('chev')}` : `Install the app to order ${I('chev')}`}</button></div>`;
  }
  PL.actions['addr-change'] = () => { S.addrOpen = true; PL.rerender(); };
  PL.actions['to-deliver'] = () => { const b = document.getElementById('u-deliver'); if (b) { b.scrollIntoView({ behavior: 'smooth', block: 'start' }); b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); } };
  PL.actions['addr-done'] = () => { S.addrOpen = false; PL.rerender(); };
  // coupons: the code is only sent; the server decides whether it applies and by how much
  const tryCoupon = (code) => { code = String(code || '').trim().toUpperCase(); if (!code) return PL.toast('Enter a coupon code.', true); S.coupon = code; S.couponTry = code; S.couponErr = null; PL.rerender(); };
  PL.forms.coupon = (f) => tryCoupon(PL.form(f).code);
  PL.actions['coupon-use'] = (el) => tryCoupon(el.dataset.code);
  PL.actions['coupon-off'] = () => { S.coupon = null; S.couponTry = ''; S.couponErr = null; PL.rerender(); };
  PL.actions.method = (el, ev) => { ev?.preventDefault?.(); if (S.method === el.dataset.m) return; S.method = el.dataset.m; S.confirmed = false; PL.rerender(); };

  // estimated delivery charge for a point: distance from the cart's restaurant (straight line) x the per-km rate, to the rupee.
  // The bill shows the exact charge; this is only a guide while choosing.
  const estKm = (pt, r) => { if (!pt || pt.lat == null || !r || r.lat == null) return null; const k = Math.PI / 180, h = Math.sin((pt.lat - r.lat) * k / 2) ** 2 + Math.cos(r.lat * k) * Math.cos(pt.lat * k) * Math.sin((pt.lng - r.lng) * k / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
  const cartRest = async () => { if (!S.cart?.rid) return null; S.allR ||= (await PL.api('/api/public/restaurants').catch(() => ({ restaurants: [] }))).restaurants; return S.allR.find((x) => x.id === S.cart.rid) || null; };
  const estTxt = (pt, r, rate) => { const km = estKm(pt, r); return km == null ? 'By distance' : `~${rs(Math.max(rate, Math.round(km * rate / 100) * 100))} · ${km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km'}`; };
  // a listed place: the server's estimate from the cart's restaurant (place map points are not sent to the app)
  const placeEst = (l) => (l?.est_fee_paise ? `~${rs(l.est_fee_paise)} · ${l.est_km < 1 ? Math.round(l.est_km * 1000) + ' m' : l.est_km.toFixed(1) + ' km'}` : 'By distance');
  const placesUrl = () => '/api/public/locations' + (S.cart?.rid ? `?restaurant_id=${S.cart.rid}` : '');
  // searchable list of Pakka Local's places (active only, as returned by the server)
  async function placesView() { const qs = new URLSearchParams(location.hash.split('?')[1] || ''); const [{ locations: places, per_km_paise: rate }, rest] = await Promise.all([PL.api(placesUrl()), cartRest()]);
    return `<div class="u-pg"><h2>Find your place</h2><p class="small mute mt2">PGs, hostels and colleges Pakka Local delivers to. Delivery is charged by distance${rest ? ` from <b>${e(rest.name)}</b>` : ' from the restaurant'}; the bill shows the exact amount.</p>
      <label class="u-search">${I('search')}<input id="place-q" type="search" placeholder="Search by name or area" autocomplete="off" aria-label="Search places"></label>
      <div id="place-list" class="mt">${places.map((l) => `<button class="u-addr place-card" style="width:100%;background:#fff;text-align:left" data-act="place-pick" data-id="${l.id}" data-s="${e([l.name, l.area, l.address, l.kind].join(' ').toLowerCase())}"><span class="u-loc" style="padding:0;flex:none"><span class="pin">${I('pin')}</span></span><span class="t"><b>${e(l.name)}</b><div class="l1">${l.kind ? `${e(l.kind)} · ` : ''}${e([l.area, l.address].filter(Boolean).join(' · '))}</div></span><span class="fee">${placeEst(l)}</span></button>`).join('') || empty('search', 'No places yet', 'No places are on the list yet.')}</div>
      <div id="place-none" class="hide">${empty('search', 'No place matches', `Check the spelling, or <a href="#" data-act="go" data-path="/addresses/new?back=${e(qs.get('back') || 'cart')}">use your GPS location</a>.`)}</div></div>`; }
  document.addEventListener('input', (ev) => { if (ev.target.id !== 'place-q') return; const n = ev.target.value.trim().toLowerCase(); let shown = 0;
    document.querySelectorAll('.place-card').forEach((c) => { const ok = !n || c.dataset.s.includes(n); c.classList.toggle('hide', !ok); shown += ok; }); PL.$('#place-none')?.classList.toggle('hide', shown > 0); });
  PL.actions['place-pick'] = async (el) => { const id = Number(el.dataset.id), qs = new URLSearchParams(location.hash.split('?')[1] || '');
    if (qs.get('for') === 'form' && F) { F.a.delivery_location_id = id; return PL.go(F.url, true); }              // changing the place inside the address form
    const have = (await PL.api('/api/customer/addresses')).addresses.find((x) => x.kind === 'listed' && x.delivery_location_id === id);
    if (have) { S.addrId = have.id; save('pl.addr', S.addrId); S.method = 'list'; S.confirmed = false; return PL.go(qs.get('back') === 'addresses' ? '/addresses' : '/cart', true); }
    PL.go(`/addresses/new?kind=listed&place=${id}&back=${qs.get('back') || 'cart'}`); };

  document.addEventListener('change', (ev) => { const t = ev.target;
    if (t.name === 'addr' && t.closest('.addr-pick')) { S.addrId = Number(t.value); save('pl.addr', S.addrId); S.confirmed = false; S.addrOpen = false; PL.rerender(); }      // picking an address keeps its method
    if (t.id === 'confirm-dest') { S.confirmed = t.checked; PL.rerender(); } });
  PL.actions.place = async (el) => { if (!inApp()) return installGate(); if (!S.confirmed) return PL.toast('Confirm the delivery point first.', true); el.disabled = true; el.classList.add('busy');
    const r = await PL.run(() => PL.post('/api/customer/orders', { ...body(), confirm_destination: true })); if (r) { S.confirmed = false; S.coupon = null; S.couponTry = ''; S.couponErr = null; PL.go('/pay/' + r.order_code, true); } else { el.disabled = false; el.classList.remove('busy'); } };

  // ---------- delivery addresses (GPS-first) ----------
  // Fresh, high-accuracy reading from this phone. Never reuses an old browser position and never invents one.
  const GPS_ERR = { 1: ['Location permission is blocked', 'Allow location for this site: tap the lock or ⓘ icon next to the web address, choose Permissions → Location → Allow, then try again.'],
    2: ['Your phone could not find its location', 'Turn on Location (GPS) in your phone’s quick settings, step outside or near a window, then try again.'],
    3: ['Finding your location took too long', 'Make sure Location (GPS) is on and you have signal, then try again. Outdoors works best.'] };
  const captureGps = (timeoutSec) => new Promise((ok, no) => {
    if (!window.isSecureContext) return no({ title: 'Location needs a secure connection', text: 'Open Pakka Local over https:// to share your location.' });
    if (!navigator.geolocation) return no({ title: 'This browser cannot share location', text: 'Open Pakka Local in Chrome or Safari on your phone.' });
    navigator.geolocation.getCurrentPosition((p) => { const c = p.coords, t = p.timestamp || Date.now();
      if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) || Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180 || (c.latitude === 0 && c.longitude === 0)) return no({ title: 'Your phone returned an invalid location', text: 'Try again.' });
      if (Date.now() - t > 120_000) return no({ title: 'Your phone gave an old location', text: 'Try again so we get your position right now.' });
      ok({ lat: c.latitude, lng: c.longitude, accuracy_m: Number.isFinite(c.accuracy) ? c.accuracy : null, captured_at: new Date(t).toISOString() }); },
    (err) => no({ code: err.code, title: (GPS_ERR[err.code] || GPS_ERR[2])[0], text: (GPS_ERR[err.code] || GPS_ERR[2])[1] }),
    { enableHighAccuracy: true, maximumAge: 0, timeout: Math.max(5, timeoutSec || 20) * 1000 }); });

  async function addresses() { const { addresses: ad, max } = await PL.api('/api/customer/addresses');
    return `<div class="u-pg"><h2>Delivery addresses</h2><p class="small mute mt2">Pick your PG, hostel or college from Pakka Local’s list, or save a place that isn’t listed with your phone’s GPS.</p>
      ${ad.length < max ? `<button class="u-lnk" data-act="go" data-path="/places?back=addresses">${I('search')} Choose from the list</button><button class="u-lnk" data-act="go" data-path="/addresses/new">${I('pin')} Use my current GPS location</button>` : ''}
      ${ad.map((a) => `<div class="u-box"><div class="row between"><b style="font:800 1rem var(--head)">${e(a.kind === 'listed' ? a.place_name : LBL[a.label])}${a.is_default ? ' <span class="u-pill ok" style="height:22px">Default</span>' : ''}</b><span class="u-pill">${a.kind === 'listed' ? 'From the list' : 'GPS'}</span></div><div class="small mute mt2">${a.lat != null ? `GPS ±${Math.round(a.accuracy_m)} m · ${PL.dt(a.captured_at)}` : 'Uses the place’s map point'}</div>
        <div class="mt2">${e(addrLine(a, a.kind === 'listed'))}</div>${[a.entrance && 'Gate: ' + a.entrance, a.landmark && 'Near ' + a.landmark].filter(Boolean).map((x) => `<div class="small mute">${e(x)}</div>`).join('')}${a.instructions ? `<div class="small mute">“${e(a.instructions)}”</div>` : ''}
        <div class="row wrap mt2"><button class="btn ghost sm" data-act="go" data-path="/addresses/${a.id}">Edit</button>${a.is_default ? '' : `<button class="btn ghost sm" data-act="addr-default" data-id="${a.id}">Make default</button>`}<button class="btn danger sm" data-act="addr-del" data-id="${a.id}">Remove</button></div></div>`).join('') || empty('bag', 'No saved addresses yet', 'Add one while standing at your PG, hostel or room.', '<button class="btn mt" data-act="go" data-path="/addresses/new">Add delivery address</button>')}</div>`; }
  PL.actions['addr-default'] = async (el) => { const r = await PL.run(() => PL.put('/api/customer/addresses/' + el.dataset.id, { make_default: true }), 'Default address updated'); if (r) PL.rerender(); };
  PL.actions['addr-del'] = async (el) => { if (!(await PL.confirm('Remove this address? Orders already placed keep their delivery details.', 'Remove'))) return; const r = await PL.run(() => PL.api('/api/customer/addresses/' + el.dataset.id, { method: 'DELETE' }), 'Address removed'); if (r) PL.rerender(); };

  // add / edit form. The GPS reading lives only in this screen's memory until it is saved to the server.
  let F = null;
  async function addressForm({ id }) {
    const qs = new URLSearchParams(location.hash.split('?')[1] || ''), isNew = id === 'new';
    const [{ addresses: ad, policy }, { locations }] = await Promise.all([PL.api('/api/customer/addresses'), PL.api('/api/public/locations')]);
    if (!F || F.id !== id) { const a = isNew ? {} : ad.find((x) => String(x.id) === String(id)); if (!a) return empty('search', 'Address not found', '', '<button class="btn mt" data-act="go" data-path="/addresses">Back</button>');
      const kind = a.kind || (qs.get('kind') === 'listed' ? 'listed' : 'gps');
      F = { id, kind, url: location.hash.slice(1), back: qs.get('back'), policy, a: { label: 'pg', ...a, ...(kind === 'listed' && qs.get('place') ? { delivery_location_id: Number(qs.get('place')) } : {}) }, gps: null,
        state: kind === 'listed' ? (a.lat != null && !qs.get('gps') ? 'kept' : 'need') : isNew || qs.get('gps') ? 'need' : 'kept', err: null, here: false, ack: false, open: !!qs.get('gps') }; }
    const a = F.a, p = F.policy, g = F.gps, poor = g && p.warn_m && g.accuracy_m > p.warn_m, listed = F.kind === 'listed', place = listed && locations.find((l) => l.id === a.delivery_location_id);
    if (listed && !place) return empty('search', 'That place is not on the list any more', '', '<button class="btn mt" data-act="go" data-path="/places?for=form">Choose a place</button>');
    const gpsBox = `<div class="gps-card ${F.state}">
      <p class="gps-hint"><b>Please stand at your actual delivery location before capturing your GPS location. Our delivery partner will use these coordinates to reach you.</b></p>
      ${F.state === 'kept' ? `<div class="gps-ok">${I('check', 'width="20" height="20"')}<div><b>Saved GPS location</b><div class="small">Accuracy about ±${Math.round(a.accuracy_m)} m · captured ${PL.dt(a.captured_at)}</div></div></div><button class="btn ghost block mt2" data-act="gps-go">${I('pin', 'width="18" height="18"')} Capture again (I’m here now)</button>` : ''}
      ${F.state === 'need' ? `<button class="btn gps-btn block" data-act="gps-go">${I('pin', 'width="22" height="22"')} USE MY CURRENT LOCATION</button><p class="small mute mt2">Your phone will ask for location permission. Allow it.</p>` : ''}
      ${F.state === 'busy' ? `<div class="gps-busy"><span class="spin"></span><b>Finding your location…</b><div class="small mute">This can take up to ${p.timeout_sec} seconds. Stay where you are.</div></div>` : ''}
      ${F.state === 'error' ? `<div class="banner bad" style="margin:0"><b>${e(F.err.title)}</b><div class="small" style="font-weight:500">${e(F.err.text)}</div></div><button class="btn block mt2" data-act="gps-go">Try again</button>` : ''}
      ${F.state === 'got' ? `<div class="gps-ok">${I('check', 'width="20" height="20"')}<div><b>Location captured</b><div class="small">Accuracy about ±${Math.round(g.accuracy_m)} m · ${PL.time(g.captured_at)}</div><div class="small mute">${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}</div></div></div>
        ${poor ? `<div class="banner warn mt2" style="margin-bottom:0">This reading is only accurate to about ${Math.round(g.accuracy_m)} m (Pakka Local’s limit is ${p.warn_m} m). Step outside or near a window and try again, or use it anyway.</div><label class="check"><input type="checkbox" id="gps-ack" ${F.ack ? 'checked' : ''}> Use this location anyway (about ±${Math.round(g.accuracy_m)} m)</label>` : g.accuracy_m > 50 ? '<p class="small mute mt2">The accuracy number is quite large. If you can, step outside or near a window and capture again.</p>' : ''}
        <label class="check"><input type="checkbox" id="gps-here" ${F.here ? 'checked' : ''}> I am standing at my delivery location right now.</label>
        <button class="btn ghost sm mt2" data-act="gps-go">Capture again</button>` : ''}</div>`;
    const inp = (k, l, attrs = '') => `<label for="a-${k}">${l}</label><input id="a-${k}" name="${k}" value="${e(a[k] ?? '')}" ${attrs}>`;
    const placeCard = listed ? `<div class="u-box place-sel"><div class="small mute">Delivering to a place on Pakka Local’s list</div><div class="row between"><b style="font:800 1rem var(--head)">${e(place.name)}</b><span class="u-pill">By distance</span></div>
      <div class="small">${e([place.kind, place.area, place.address].filter(Boolean).join(' · '))}</div><button class="btn ghost sm mt2" data-act="form-change-place">Change place</button></div>` : '';
    const gpsPart = listed ? `<details class="card gps-opt" ${F.open || F.state === 'got' || F.state === 'busy' || F.state === 'error' ? 'open' : ''}><summary><b>Add my exact GPS point (optional)</b><div class="small mute">${a.lat != null ? `Saved: ±${Math.round(a.accuracy_m)} m` : 'Helps the delivery partner find your exact building. Without it, the place’s map point is used.'}</div></summary>${gpsBox}</details>` : gpsBox;
    return `<div class="u-pg"><h2>${isNew ? 'Add delivery address' : 'Edit delivery address'}</h2>${placeCard}${gpsPart}
      <form data-form="addr" class="card mt" novalidate><label>This place is a</label><div class="seg wrap">${Object.entries(LBL).map(([k, l]) => `<label class="${a.label === k ? 'on' : ''}"><input type="radio" name="label" value="${k}" ${a.label === k ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        ${listed ? '' : inp('place_name', 'PG, hostel or college name', 'maxlength="80" placeholder="e.g. the name on the board outside"')}
        ${inp('building', 'Building or hostel block name', 'maxlength="80"')}
        <div class="grid g3"><div>${inp('block', 'Block / tower', 'maxlength="30"')}</div><div>${inp('floor', 'Floor', 'maxlength="20" inputmode="numeric"')}</div><div>${inp('room', 'Room no.', 'maxlength="30"')}</div></div>
        ${inp('entrance', 'Main gate or entrance', 'maxlength="120" placeholder="e.g. back gate near the parking"')}
        ${inp('landmark', 'Nearby landmark', 'maxlength="120"')}
        <label for="a-instructions">Delivery instructions</label><textarea id="a-instructions" name="instructions" maxlength="300" placeholder="e.g. call from the gate, security won’t let riders in">${e(a.instructions || '')}</textarea>
        <p class="small mute mt2">${listed ? 'Required: a room number, gate or landmark.' : 'Required: the PG/hostel/college or building name, and a room number, gate or landmark.'}</p>
        ${isNew ? `<label class="check"><input type="checkbox" name="make_default" ${ad.length ? '' : 'checked'}> Make this my default address</label>` : ''}
        <button class="btn block lg mt" type="submit">Save address</button></form></div>`; }
  const keepForm = () => { const f = PL.$('form[data-form=addr]'); if (!f) return; const v = PL.form(f); delete v.delivery_location_id; Object.assign(F.a, v, { label: f.label.value || F.a.label }); };
  PL.actions['form-change-place'] = () => { keepForm(); PL.go('/places?for=form'); };
  PL.actions['gps-go'] = async () => { keepForm(); F.state = 'busy'; F.err = null; F.here = false; F.ack = false; PL.rerender();
    try { F.gps = await captureGps(F.policy.timeout_sec); F.state = 'got'; } catch (x) { F.err = x; F.state = 'error'; } PL.rerender(); };
  document.addEventListener('change', (ev) => { const t = ev.target; if (!F) return;
    if (t.id === 'gps-here') F.here = t.checked; if (t.id === 'gps-ack') F.ack = t.checked;
    if (t.name === 'label' && t.closest('form[data-form=addr]')) { keepForm(); PL.rerender(); } });
  PL.forms.addr = async (f) => { keepForm(); const a = F.a, isNew = F.id === 'new', listed = F.kind === 'listed';
    if (!listed && isNew && F.state !== 'got') return PL.toast('Capture your GPS location first.', true);
    if (F.state === 'got' && !F.here) return PL.toast('Confirm that you are standing at the delivery location.', true);
    const det = { label: a.label, building: a.building, block: a.block, floor: a.floor, room: a.room, entrance: a.entrance, landmark: a.landmark, instructions: a.instructions,
      ...(listed ? { delivery_location_id: a.delivery_location_id } : { place_name: a.place_name }) };
    const gps = F.state === 'got' ? { lat: F.gps.lat, lng: F.gps.lng, accuracy_m: F.gps.accuracy_m, captured_at: F.gps.captured_at, accuracy_acknowledged: F.ack, confirm: true } : {};
    const r = await PL.run(() => (isNew ? PL.post('/api/customer/addresses', { ...det, ...gps, ...(listed ? { kind: 'listed' } : { confirm: true }), make_default: !!f.make_default?.checked }) : PL.put('/api/customer/addresses/' + F.id, { ...det, ...gps })), 'Address saved');
    if (!r) return; const back = F.back; S.addrId = r.address.id; S.method = listed ? 'list' : 'gps'; save('pl.addr', S.addrId); S.confirmed = false; F = null; PL.go(back === 'cart' ? '/cart' : '/addresses', true); };

  // ---------- sandbox payment (stands in for the PhonePe checkout page) ----------
  async function pay({ code }) {
    const o = await PL.api('/api/customer/orders/' + code); const c = await PL.api('/api/public/config');
    if (o.status !== 'PAYMENT_PENDING') return `<div class="u-pg">${empty('bag', `This order is already ${e(o.status.toLowerCase().replace('_', ' '))}`, '', `<button class="btn mt" data-act="go" data-path="/orders/${e(code)}">View order</button>`)}</div>`;
    return `<div class="u-pg"><div class="u-paytop"><div class="sh">${I('shield')}</div><span>Amount to pay</span><div class="amt">${rs(o.total_paise)}</div><span>${e(o.restaurant || '')} · Order ${e(code)}</span></div>
      <div class="u-box u-items"><h3>${I('receipt')} Order summary</h3><div class="mt2">${o.items.map((i) => `<div class="kv"><span>${i.qty} × ${e(i.name)}</span><span>${rs(i.price_paise * i.qty)}</span></div>`).join('')}<div class="kv"><span class="mute">Delivery</span><span>${rs(o.delivery_paise)}</span></div>${o.surge_paise ? `<div class="kv"><span class="mute">Surge</span><span>${rs(o.surge_paise)}</span></div>` : ''}${o.tax_paise ? `<div class="kv"><span class="mute">Taxes</span><span>${rs(o.tax_paise)}</span></div>` : ''}<div class="kv" style="font-weight:800;border-top:1px solid var(--u-line);margin-top:6px;padding-top:10px"><span>Total</span><span>${rs(o.total_paise)}</span></div></div></div>
      <div class="u-box"><h3>${I('wallet')} Payment method</h3>${c.testPayments ? `<div class="u-pm"><span class="ic">${I('shield')}</span><span class="txt"><b>Test payment</b><small>Staging only. No real money moves.</small></span><span class="rd"></span></div><div class="u-pm off"><span class="ic">${I('wallet')}</span><span class="txt"><b>UPI, cards and wallets</b><small>Available when the payment gateway is connected</small></span><span class="rd"></span></div>` : `<div class="u-note">${I('info')}<span>Online payments are not available yet.</span></div>`}</div>
      ${c.testPayments ? `<div class="u-note info">${I('info')}<span>Test mode: this screen stands in for the payment gateway. Choose the outcome to test.</span></div><button class="btn danger block" data-act="sbx" data-code="${e(code)}" data-ok="fail">Simulate failed payment</button>` : ''}
      <div class="u-cod">${I('shield')} Online payment only. Cash on delivery is not available.</div></div>
      ${c.testPayments ? `<div class="u-paybar"><span class="l"><b>${rs(o.total_paise)}</b><small>Test payment</small></span><button class="go" style="background:var(--u-green);box-shadow:0 8px 20px rgba(15,138,79,.35)" data-act="sbx" data-code="${e(code)}" data-ok="success">Pay ${rs(o.total_paise)} ${I('chev')}</button></div>` : ''}`;
  }
  PL.actions.sbx = async (el) => { const ok = el.dataset.ok === 'success'; document.querySelectorAll('[data-act=sbx]').forEach((b) => { b.disabled = true; }); el.classList.add('busy');
    const r = await PL.run(() => PL.post(`/api/customer/payments/sandbox/${el.dataset.code}/complete`, { outcome: ok ? 'success' : 'fail' }));
    if (!r) { document.querySelectorAll('[data-act=sbx]').forEach((b) => { b.disabled = false; b.classList.remove('busy'); }); return; }
    // the animation follows the server's answer, never the button pressed
    const st = (await PL.api('/api/customer/orders/' + el.dataset.code).catch(() => ({}))).status, paid = !!st && !['PAYMENT_PENDING', 'PAYMENT_FAILED', 'EXPIRED'].includes(st);
    if (paid) { S.cart = { rid: null, rname: '', items: {} }; saveCart(); S.instr = ''; S.seen[el.dataset.code] = st; await PL.celebrate({ title: 'Payment successful', sub: 'Order placed. We’ve sent it to the restaurant.' }); PL.go('/orders/' + el.dataset.code, true); }
    else { await PL.celebrate({ ok: false, title: 'Payment failed', sub: 'No order was placed. Your cart is saved, so you can try again.', ms: 2600 }); PL.go('/cart', true); } };

  // ---------- orders ----------
  async function orders() { const { orders } = await PL.api('/api/customer/orders'); const act = orders.filter((o) => ACTIVE.includes(o.status)), unpaid = orders.filter((o) => o.status === 'PAYMENT_PENDING'), past = orders.filter((o) => !ACTIVE.includes(o.status) && o.status !== 'PAYMENT_PENDING');
    if (!orders.length) return `<div class="u-pg">${empty('bag', 'No orders yet', 'When you order, you can track it here.', '<button class="btn mt" data-act="go" data-path="/home">Browse restaurants</button>')}</div>`;
    const head = (o) => `<div class="h">${img(restPic(o.restaurant, o.restaurant_image, o.summary), '', o.restaurant)}<span class="txt"><b>${e(o.restaurant)}</b><small>${PL.dt(o.created_at)}</small></span>`;
    return `<div class="u-pg">${act.length ? `<div class="u-sec" style="margin-top:6px"><h2>Active orders</h2></div>${act.map((o) => `<button class="u-ocard live" data-act="go" data-path="/orders/${e(o.order_code)}">${head(o)}<span class="u-pill brand">${e(SAY[o.status]?.[0] || o.status)}</span></div><div class="bar"><i style="width:${PROG[o.status] || 8}%"></i></div><div class="ft"><span>${o.eta_at ? etaText(o) : e(SAY[o.status]?.[1] || '')}</span><b style="color:var(--brand)">Track ›</b></div></button>`).join('')}` : ''}
      ${unpaid.length ? `<div class="u-sec"${act.length ? '' : ' style="margin-top:6px"'}><h2>Waiting for payment<small>Not placed yet. The restaurant sees it only after payment.</small></h2></div>${unpaid.map((o) => `<div class="u-ocard"><button class="u-oh" data-act="go" data-path="/orders/${e(o.order_code)}">${head(o)}<span class="u-pill warn">Payment pending</span></div></button><div class="it">${e(o.summary || '')}</div><div class="ft"><b>${rs(o.total_paise)}</b><button class="btn sm" data-act="go" data-path="/pay/${e(o.order_code)}">Complete payment</button></div></div>`).join('')}` : ''}
      ${past.length ? `<div class="u-sec"${act.length || unpaid.length ? '' : ' style="margin-top:6px"'}><h2>Past orders</h2></div><div class="u-ogrid">${past.map((o) => `<div class="u-ocard"><button class="u-oh" data-act="go" data-path="/orders/${e(o.order_code)}">${head(o)}<span class="u-pill ${o.status === 'DELIVERED' ? 'ok' : ['REJECTED', 'CANCELLED', 'PAYMENT_FAILED', 'EXPIRED'].includes(o.status) ? 'bad' : 'warn'}">${o.status === 'DELIVERED' ? I('check', 'width="13" height="13"') : ''}${e(SAY[o.status]?.[0] || o.status)}</span></div><div class="it">${e(o.summary || '')}</div></button><div class="ft"><b>${rs(o.total_paise)}</b>${o.status === 'DELIVERED' && o.restaurant_id ? `<button class="u-reo" data-act="reorder" data-code="${e(o.order_code)}" data-rid="${o.restaurant_id}">${I('refresh')} Reorder</button>` : `<button class="btn ghost sm" data-act="go" data-path="/orders/${e(o.order_code)}">View details</button>`}</div></div>`).join('')}</div>` : ''}</div>`; }

  // ---------- order tracking ----------
  // professional status animations (LottieFiles, Lottie Simple License; player: lottie-web, MIT), loaded only on this screen
  const LOT = { PLACED: 'placed', ACCEPTED: 'preparing', PREPARING: 'preparing', READY: 'ready', PICKED_UP: 'onway', DELIVERED: 'delivered' };
  let lottieP = null; const animData = {};
  const loadLottie = () => (lottieP ||= new Promise((ok, no) => { if (window.lottie) return ok(window.lottie); const s = document.createElement('script'); s.src = '/vendor/lottie/lottie_light.min.js'; s.onload = () => ok(window.lottie); s.onerror = () => { lottieP = null; no(new Error('lottie')); }; document.head.appendChild(s); }));
  const mountLottie = async () => { const ph = PL.$('.u-lot'); if (!ph) return; const k = ph.dataset.a;
    if (S.lot && S.lot.k === k) { if (S.lot.el !== ph) ph.replaceWith(S.lot.el); return; }      // keep the running animation across the 2-second refreshes
    try { const L = await loadLottie(); const data = animData[k] || (animData[k] = await (await fetch(`/vendor/lottie/anim/${k}.json`)).json());
      const cur = PL.$('.u-lot'); if (!cur || cur.dataset.a !== k) return;
      S.lot?.anim?.destroy(); const box = document.createElement('div'); box.className = 'u-lot on ' + k; box.dataset.a = k; box.setAttribute('aria-hidden', 'true');
      const anim = L.loadAnimation({ container: box, renderer: 'svg', loop: k !== 'delivered', autoplay: !reduce(), animationData: data, rendererSettings: { preserveAspectRatio: 'xMidYMid meet' } });
      if (reduce()) anim.goToAndStop(Math.floor(anim.totalFrames * 0.6), true);
      cur.replaceWith(box); S.lot = { k, el: box, anim }; } catch { /* the drawn picture stays */ } };
  const NEXT = { PLACED: 'Next: the restaurant confirms your order.', ACCEPTED: 'Next: the kitchen starts cooking your food.', PREPARING: 'Next: your food is packed for a delivery partner to collect.', READY: 'Next: your delivery partner collects it from the restaurant.', PICKED_UP: 'Next: share your delivery code at the door.', PAYMENT_PENDING: 'Next: complete the payment to place the order.' };
  const STEPS = [['PAYMENT_SUCCESS', 'Order placed', 'PLACED'], ['RESTAURANT_ACCEPTED', 'Restaurant accepted', 'ACCEPTED'], ['PREPARING_STARTED', 'Food being prepared', 'PREPARING'], ['FOOD_READY', 'Ready for pickup', 'READY'], ['RIDER_ACCEPTED', 'Delivery partner assigned', null], ['PICKED_UP', 'Picked up · on the way', 'PICKED_UP'], ['DELIVERED', 'Delivered', 'DELIVERED']];
  const RANK = { PLACED: 0, ACCEPTED: 1, PREPARING: 2, READY: 3, PICKED_UP: 5, DELIVERED: 6 };
  S.seen = {};
  // small original scenes per status (decorative only; the live map is the only position shown)
  const scene = (st) => { const pan = '<g class="sc-steam" stroke="#f2a375" stroke-width="4" stroke-linecap="round" fill="none"><path d="M150 52c0-8 7-9 7-17"/><path d="M170 50c0-8 7-9 7-17"/><path d="M190 52c0-8 7-9 7-17"/></g><path d="M118 70h104c0 26-22 40-52 40s-52-14-52-40z" fill="#d0450b"/><rect x="112" y="64" width="116" height="10" rx="5" fill="#a83707"/><path d="M222 72h40" stroke="#4f5361" stroke-width="7" stroke-linecap="round"/>';
    const S2 = { PLACED: '<circle class="sc-ring" cx="170" cy="75" r="44" fill="#d0450b" opacity=".25"/><rect x="138" y="36" width="64" height="80" rx="10" fill="#fff" stroke="#d0450b" stroke-width="4"/><path d="M152 58h36M152 72h36M152 86h22" stroke="#f2a375" stroke-width="5" stroke-linecap="round"/>',
      ACCEPTED: '<circle class="sc-ring" cx="170" cy="75" r="44" fill="#0f8a4f" opacity=".2"/><circle cx="170" cy="75" r="36" fill="#0f8a4f"/><path class="sc-draw" d="M152 76l12 12 24-26" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
      PREPARING: pan, READY: '<path class="sc-spark" d="M226 40l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#f2a375"/><path class="sc-spark" d="M112 52l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#f2a375" style="animation-delay:.5s"/><rect x="134" y="50" width="72" height="66" rx="10" fill="#d0450b"/><path d="M150 50v-8a20 20 0 0140 0v8" stroke="#a83707" stroke-width="6" fill="none"/><rect x="152" y="72" width="36" height="20" rx="4" fill="#fff"/>',
      PICKED_UP: '<g class="sc-road" stroke="#d5d7de" stroke-width="4"><line x1="40" y1="122" x2="300" y2="122"/></g><g class="sc-bob"><circle cx="140" cy="106" r="14" fill="#1d2030"/><circle cx="140" cy="106" r="6" fill="#fff"/><circle cx="208" cy="106" r="14" fill="#1d2030"/><circle cx="208" cy="106" r="6" fill="#fff"/><path d="M140 106h40l16-30h14l6 30" stroke="#d0450b" stroke-width="8" fill="none" stroke-linejoin="round" stroke-linecap="round"/><rect x="120" y="58" width="40" height="34" rx="6" fill="#d0450b"/><circle cx="196" cy="54" r="10" fill="#1d2030"/></g>',
      DELIVERED: '<circle class="sc-ring" cx="170" cy="75" r="44" fill="#0f8a4f" opacity=".2"/><path d="M128 70l42-34 42 34v46h-84z" fill="#fff" stroke="#0f8a4f" stroke-width="5" stroke-linejoin="round"/><path class="sc-draw" d="M152 86l12 12 24-26" stroke="#0f8a4f" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' };
    const bad = '<circle cx="170" cy="75" r="36" fill="#fdecea"/><path d="M156 61l28 28M184 61l-28 28" stroke="#c42b23" stroke-width="7" stroke-linecap="round"/>', wait = '<rect x="132" y="44" width="76" height="62" rx="10" fill="#fff" stroke="#d0450b" stroke-width="4"/><rect x="132" y="56" width="76" height="12" fill="#ffd9c2"/><circle cx="190" cy="92" r="6" fill="#d0450b"/>';
    return `<svg class="scene" viewBox="0 0 340 140" fill="none" aria-hidden="true">${S2[st] || (st === 'PAYMENT_PENDING' ? wait : bad)}</svg>`; };
  async function track({ code }) {
    const o = await PL.api('/api/customer/orders/' + code); const at = Object.fromEntries(o.events.map((x) => [x.event_type, x.created_at])); const dead = ['REJECTED', 'CANCELLED', 'PAYMENT_FAILED', 'EXPIRED', 'PAYMENT_PENDING'].includes(o.status);
    const rank = RANK[o.status] ?? -1;
    // a step is done only when the server recorded it (or the order is already past it); done steps are listed in the order they happened
    const steps = STEPS.map(([ev, label, st], i) => ({ i, label, t: at[ev], done: !!at[ev] || (st ? rank > RANK[st] || (o.status === 'DELIVERED' && st === 'DELIVERED') : rank >= 5) }));
    const done = steps.filter((s) => s.done).sort((a, b) => (a.t && b.t ? new Date(a.t) - new Date(b.t) : a.i - b.i)), todo = steps.filter((s) => !s.done);
    const tl = dead ? '' : `<ul class="u-tl">${[...done, ...todo].map((s, k) => `<li class="${s.done ? 'done' : k === done.length && o.status !== 'DELIVERED' ? 'cur' : ''}"><span class="dt">${s.done ? I('check') : ''}</span><span><b>${s.label}</b><small>${s.t ? PL.time(s.t) : s.done ? '' : k === done.length ? 'In progress' : 'Pending'}</small></span></li>`).join('')}</ul>`;
    const rf = o.refund_detail;
    const refundCard = rf ? `<div class="u-box u-refund"><div class="row between"><h3>${I('refresh')} Refund ${rs(rf.amount_paise)}</h3><span class="u-pill ${rf.stage === 'completed' ? 'ok' : ['rejected', 'failed'].includes(rf.stage) ? 'bad' : 'warn'}">${e(rf.stage_text)}</span></div>
        <ol class="u-rsteps">${[['requested', 'UPI ID received'], ['approved', 'Approved'], ['completed', 'Money sent']].map(([k, l]) => { const done = rf.history.some((h) => h.stage === k); return `<li class="${done ? 'on' : ''}"><i>${done ? I('check') : ''}</i>${l}</li>`; }).join('')}</ol>
        ${rf.stage === 'completed' ? `<div class="u-note ok">${I('check')}<span>Sent to <b>${e(rf.upi_id)}</b>. UPI reference <b>${e(rf.reference)}</b>. It can take a few minutes to show in your bank app.</span></div>` : ''}
        ${rf.note ? `<div class="u-note bad">${I('alert')}<span>${e(rf.note)}</span></div>` : ''}
        ${rf.can_edit ? `<form data-form="refund-upi" data-code="${e(o.order_code)}" class="mt2"><label for="rf-upi">Your UPI ID for the refund</label><input id="rf-upi" name="upi_id" value="${e(rf.upi_id || '')}" placeholder="yourname@okaxis" required autocomplete="off" autocapitalize="off" spellcheck="false">
          <label for="rf-name">Name on the UPI account (optional)</label><input id="rf-name" name="upi_name" value="${e(rf.upi_name || '')}" maxlength="80" autocomplete="name">
          <button class="btn block lg mt" type="submit">${rf.upi_id ? 'Update UPI ID' : 'Request refund to this UPI ID'}</button><p class="small mute mt2">Pakka Local checks the request and sends the money to this UPI ID. You’ll be notified at each step.</p></form>` : rf.upi_id && rf.stage !== 'completed' ? `<div class="small mute mt2">Refund to <b>${e(rf.upi_id)}</b></div>` : ''}</div>` : '';
    const banner = o.status === 'CANCELLED' ? `<div class="u-note bad">${I('alert')}<span>This order was cancelled. ${e(o.rejection_reason || '')}${rf ? ' Your money will be refunded.' : ''}</span></div>` : o.status === 'REJECTED' ? `<div class="u-note bad">${I('alert')}<span><b>Order not accepted.</b> The restaurant couldn’t take this order: ${e(o.rejection_reason || '')}.${rf ? ' Your money will be refunded.' : ''}</span></div>` : o.status === 'PAYMENT_PENDING' ? `<div class="u-note">${I('info')}<span>Payment is pending.<br><button class="btn sm mt2" data-act="go" data-path="/pay/${e(code)}">Complete payment</button></span></div>` : o.status === 'PAYMENT_FAILED' || o.status === 'EXPIRED' ? `<div class="u-note bad">${I('alert')}<span>Payment was not completed. No order was placed.</span></div>` : '';
    const say = SAY[o.status] || [o.status, ''], prev = S.seen[code], changed = prev && prev !== o.status; S.seen[code] = o.status;
    if (changed) { PL.inbox.load(); if (o.status === 'DELIVERED') setTimeout(() => PL.celebrate({ title: 'Order delivered', sub: 'Enjoy your meal! Tap the stars below to rate it.', ms: 2400 }), 50); }
    const live = o.status === 'PICKED_UP';
    const hero = `<div class="u-thero ${o.status === 'DELIVERED' ? 'ok' : dead && o.status !== 'PAYMENT_PENDING' ? 'bad' : ''} ${changed ? 'just' : ''}">${LOT[o.status] ? `<div class="u-lot ${LOT[o.status]}" data-a="${LOT[o.status]}">${scene(o.status)}</div>` : scene(o.status)}<div class="st"><h1>${e(say[0])}</h1><p>${e(say[1])}</p></div>${NEXT[o.status] ? `<div class="u-next">${I('chev')}<span>${NEXT[o.status]}</span></div>` : ''}${o.eta_at && !dead && o.status !== 'DELIVERED' ? `<div class="u-eta">${I('clock')}<span class="txt"><b>${etaText(o)}</b><small>${minsTo(o.eta_at) > 1 ? `by ${PL.time(o.eta_at)}` : 'Your delivery partner is close'}${o.eta_live ? ' · <span class="u-livetag">live</span> from your delivery partner’s location' : ''}</small></span></div>` : ''}</div>`;
    const map = live ? `<div class="u-map"><div id="trkmap" data-code="${e(o.order_code)}"></div><div class="lbl"><span class="chip" id="trkst">Checking…</span></div><div class="u-meta" id="trketa" aria-live="polite"></div><div class="note" id="trknote"></div></div>` : '';
    const nItems = o.items.reduce((a, i) => a + i.qty, 0);
    const rcard = `<div class="u-box u-crest">${img(restPic(o.restaurant, o.restaurant_image, o.items.map((i) => i.name).join(' ')))}<span class="txt"><b>${e(o.restaurant)}</b><small>${nItems} item${nItems > 1 ? 's' : ''} · ${rs(o.total_paise)} · ${e(o.order_code)}</small></span></div>`;
    const chat = o.chat && (o.chat.open || o.chat.any) ? `<button class="u-box u-chatbtn" data-act="chat-open" data-code="${e(o.order_code)}"><span class="ic">${I('chat')}${o.chat.unread ? `<i class="dot">${o.chat.unread}</i>` : ''}</span><span class="txt"><b>${o.chat.unread ? `${o.chat.unread} new message${o.chat.unread > 1 ? 's' : ''}` : 'Message your delivery partner'}</b><small>${o.chat.open ? 'Gate number, landmark or where to meet' : 'Chat history for this order'}</small></span>${I('chev')}</button>` : '';
    const bar = `<div class="u-trkbar"><span>Updated ${PL.time(new Date().toISOString())}</span><button class="btn ghost sm" data-act="trk-refresh" aria-label="Refresh order status">${I('refresh')} Refresh</button></div>`;
    const help = `<button class="u-helpbtn" data-act="go" data-path="/support?order=${e(code)}">${I('chat')}<span><b>Need help with this order?</b><small>Ask the assistant or our team</small></span>${I('chev')}</button>`;
    // not registered for phone notifications yet: one clear button (a tap reliably shows the phone's permission question)
    const allow = PL.state.push === 'off' ? `<div class="u-allow">${I('bell')}<span><b>Get updates on your phone</b><small>Know when it’s accepted, picked up and delivered, even with the app closed</small></span><button class="btn sm" data-act="push-on">Allow</button></div>` : '';
    return `${map}${bar}${hero}${allow}${banner}${refundCard}${chat}${rcard}${help}
      ${o.delivery_otp ? `<div class="u-box u-otp"><span><b style="font:800 1rem var(--head)">Delivery code</b><div class="small mute">Share it with your delivery partner at your door</div></span><span class="dg" aria-label="Delivery code ${e(o.delivery_otp)}">${String(o.delivery_otp).split('').map((d) => `<span>${e(d)}</span>`).join('')}</span></div>` : ''}
      ${o.rider ? `<div class="u-box"><div class="u-rider">${o.rider.has_photo ? `<img alt="" data-authimg="/api/files/order-rider-photo/${e(code)}">` : `<span class="av">${e((o.rider.name || 'R').trim().charAt(0).toUpperCase())}</span>`}<span class="txt"><b>${e(o.rider.name)}</b><small>${['Your delivery partner', [o.rider.vehicle_category, o.rider.vehicle_make, o.rider.vehicle_model].filter(Boolean).join(' ')].filter(Boolean).map(e).join(' · ')}</small>${o.rider.vehicle_reg_no ? `<span class="plate">${e(o.rider.vehicle_reg_no)}</span>` : ''}</span>${o.status === 'PICKED_UP' ? `<a class="u-call" href="tel:${e(o.rider.phone)}" aria-label="Call your delivery partner">${I('phone')}</a>` : ''}</div></div>` : ''}
      ${o.status === 'DELIVERED' ? `<div class="u-box"><h3>${o.rating ? 'Your rating' : 'How was your food?'}</h3><div class="u-stars">${[1, 2, 3, 4, 5].map((n) => o.rating ? `<span class="${n <= o.rating ? 'on' : ''}">${star}</span>` : `<button data-act="rate" data-code="${e(o.order_code)}" data-s="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${star}</button>`).join('')}</div></div>` : ''}
      ${dead ? '' : `<div class="u-box"><h3>${I('receipt')} Order status</h3>${tl}</div>`}
      ${ACTIVE.includes(o.status) && S.push !== 'on' ? PL.push.card('user') : ''}
      <details class="u-box u-items" ${dead ? 'open' : ''}><summary><span>${e(o.restaurant)} · ${o.items.reduce((a, i) => a + i.qty, 0)} item${o.items.reduce((a, i) => a + i.qty, 0) > 1 ? 's' : ''}</span>${I('chev')}</summary><div class="mt2">${o.items.map((i) => `<div class="kv"><span>${i.qty} × ${e(i.name)}</span><span>${rs(i.price_paise * i.qty)}</span></div>`).join('')}<div class="kv"><span class="mute">Item total</span><span>${rs(o.items_paise)}</span></div><div class="kv"><span class="mute">Delivery</span><span>${rs(o.delivery_paise)}</span></div>${o.surge_paise ? `<div class="kv"><span class="mute">Surge</span><span>${rs(o.surge_paise)}</span></div>` : ''}${o.tax_paise ? `<div class="kv"><span class="mute">Taxes</span><span>${rs(o.tax_paise)}</span></div>` : ''}<div class="kv" style="font-weight:800;border-top:1px solid var(--u-line);margin-top:6px;padding-top:10px"><span>Total paid</span><span>${rs(o.total_paise)}</span></div>
        <div class="small mute mt2">Deliver to: ${e(o.dest_text)}${o.instructions ? `<br>Note: ${e(o.instructions)}` : ''}</div>${o.refund ? `<div class="mt2">Refund ${PL.chip(o.refund)}</div>` : ''}<div class="small mute mt2">Order ${PL.code(o.order_code)}</div></div></details>`;
  }

  // refresh: one request at a time; the screen is repainted in place (no page reload)
  PL.actions['trk-refresh'] = async (el) => { if (S.trkBusy) return; S.trkBusy = true; el.disabled = true; el.classList.add('spin');
    try { await PL.rerender(); } finally { S.trkBusy = false; const b = PL.$('[data-act="trk-refresh"]'); if (b) { b.disabled = false; b.classList.remove('spin'); } } };
  PL.actions['chat-open'] = (el) => PL.chat.open(`/api/customer/orders/${el.dataset.code}/messages`, 'Your delivery partner', 'Only you and the partner delivering this order can see these messages.');
  PL.forms['refund-upi'] = async (f) => { const v = PL.form(f); const r = await PL.run(() => PL.post(`/api/customer/orders/${f.dataset.code}/refund-upi`, { upi_id: v.upi_id.trim(), upi_name: v.upi_name.trim() || undefined }), 'Refund request sent. We’ll notify you when it’s paid.'); if (r) PL.rerender(); };

  // ---------- account ----------
  // ---------- Install Pakka Local (home-screen app) ----------
  // Chrome/Edge on Android and desktop: the browser's real install prompt (beforeinstallprompt). iPhone Safari and other
  // browsers have no prompt, so we show the exact manual steps instead of a button that does nothing.
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } }, lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const isInstalled = () => PL.isInstalled(), isIOS = () => PL.isIOS();
  document.addEventListener('pl-installable', () => document.querySelectorAll('.u-install').forEach((c) => { c.outerHTML = installCard(c.dataset.where); }));
  window.addEventListener('appinstalled', () => { document.querySelectorAll('.u-install').forEach((c) => c.remove()); });
  const homeInstallHidden = () => { try { return isInstalled() || sessionStorage.getItem('pl.install.later') === '1'; } catch { return isInstalled(); } };      // "Not now" hides it until the next visit
  // Customers order only from the installed Pakka Local app. In a browser tab they can browse and fill the cart; the bar below
  // stays on every page (no close button) and the order button opens the install steps instead of payment.
  const inApp = () => PL.isStandalone();
  const howTo = () => (PL.isIOS() ? 'In Safari, tap the <b>Share</b> button (square with an arrow), then <b>Add to Home Screen</b>, then <b>Add</b>.'
    : 'Open your browser menu (<b>⋮</b> at the top right) and tap <b>Install app</b> (or <b>Add to Home screen</b>), then <b>Install</b>.');
  function installGate() {
    const done = isInstalled();
    PL.modal(`<div class="cf u-gate"><span class="cf-ic" style="background:none"><img src="/assets/icon-192.png" alt="" width="64" height="64" style="border-radius:16px"></span>
      <h3>${done ? 'Open the Pakka Local app to order' : 'Install Pakka Local to order'}</h3>
      <p class="small mute">${done ? 'Pakka Local is installed on this phone. Orders are placed from the app: open <b>Pakka Local</b> from your home screen (your cart is kept).' : 'Orders are placed from the Pakka Local app, so you get live order updates and delivery alerts. It takes a few seconds and your cart is kept.'}</p>
      <p class="small u-how hide" style="text-align:left;margin-top:10px">${howTo()}</p></div>
      ${done ? `<button class="btn block mt" data-act="close-modal">OK</button>` : `<button class="btn block lg mt u-installbtn" data-act="install-now">${I('plus')} Install</button>`}`); }
  // Install: Chrome / Edge / Samsung Internet install straight away (the browser's own "Install app?" box, one more tap).
  // Only where the browser offers no direct install (iPhone Safari, some in-app browsers) do the steps appear.
  PL.actions['install-now'] = async (el) => {
    if (PL.installEvt) { await PL.install(); if (isInstalled()) { await PL.closeModalAsync(); syncBar(); } return; }
    const how = el.closest('.sheet')?.querySelector('.u-how'); if (how) { how.classList.remove('hide'); el.textContent = 'OK'; el.dataset.act = 'close-modal'; return; }
    installGate(); };
  PL.actions['install-gate'] = () => installGate();
  const barHtml = () => { const done = isInstalled();
    return `<img src="/assets/icon-192.png" alt=""><span class="txt"><b>${done ? 'Open the Pakka Local app to order' : 'Install Pakka Local to order'}</b><small>${done ? 'Ordering works in the app, not in this browser tab' : 'Free · takes a few seconds · live order alerts'}</small></span>
      <button class="btn sm" data-act="${done ? 'install-gate' : 'install-now'}">${done ? 'How?' : 'Install'}</button>`; };
  const syncBar = () => { let b = document.getElementById('u-installbar'); const need = !inApp() && !!PL.session();
    document.body.classList.toggle('has-ibar', need);
    if (!need) { b?.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'u-installbar'; b.className = 'u-ibar'; b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Install the app'); document.body.append(b); }
    const h = barHtml(); if (b.dataset.h !== h) { b.innerHTML = h; b.dataset.h = h; } };
  document.addEventListener('pl-installable', syncBar); window.addEventListener('appinstalled', () => setTimeout(syncBar, 300));
  setInterval(syncBar, 1500); setTimeout(syncBar, 300);
  function installCard(where = 'account') {
    if (isInstalled()) return '';
    const head = `<span class="ic"><img src="/assets/icon-192.png" alt=""></span><span class="txt"><b>Install the Pakka Local app</b><small>Opens in one tap from your home screen, full screen, with order alerts.</small></span>`;
    const notNow = '';      // installing is required to order: no "Not now"
    if (PL.installEvt) return `<div class="u-install" data-where="${where}"><div class="row1">${head}</div><div class="row2">${notNow}<button class="btn sm" data-act="install-go">${I('plus')} Install app</button></div></div>`;
    const how = isIOS() ? 'In Safari, tap the <b>Share</b> button, then <b>Add to Home Screen</b>.' : 'Open your browser menu (<b>⋮</b>) and tap <b>Install app</b> or <b>Add to Home screen</b>.';
    return `<div class="u-install" data-where="${where}"><div class="row1">${head}</div><p class="how">${how}</p>${notNow ? `<div class="row2">${notNow}</div>` : ''}</div>`;
  }
  PL.actions['install-go'] = async () => { await PL.install(); if (isInstalled()) document.querySelectorAll('.u-install').forEach((c) => c.remove()); };
  PL.actions['install-later'] = (el) => { try { sessionStorage.setItem('pl.install.later', '1'); } catch {} el.closest('.u-install')?.remove(); };
  // (notifications are switched on automatically on the first tap: see shared/push.js)

  // ---------- Help & support: assistant (answers from the customer's own orders) + tickets with the Pakka Local team ----------
  const ST = { open: ['Waiting for the team', 'o'], answered: ['Team replied', 'g'], closed: ['Closed', ''] };
  const bubble = (from, body, extra = '') => `<div class="u-bub ${from}">${from === 'bot' ? `<span class="who">${I('chat')}</span>` : ''}<div class="b">${e(body).replace(/\n/g, '<br>')}${extra}</div></div>`;
  const botActs = (acts = []) => acts.length ? `<div class="u-bacts">${acts.map((a) => a.path ? `<button data-act="go" data-path="${e(a.path)}">${e(a.label)}</button>` : a.team ? `<button class="team" data-act="hb-team">${I('chat')} ${e(a.label)}</button>` : `<button data-act="hb-ask" data-q="${e(a.ask)}">${e(a.label)}</button>`).join('')}</div>` : '';
  const feedback = `<div class="u-fb"><span>Did this solve it?</span><button data-act="hb-ok">${I('check')} Solved</button><button data-act="hb-no">Not solved</button></div>`;
  // official Instagram page (link opens Instagram; no tracking parameters)
  const IG_URL = 'https://www.instagram.com/pakkalocalfooddelivery/';
  const igIcon = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="#fff" stroke="none"/></svg>';
  const igCard = () => `<a class="u-ig" href="${IG_URL}" target="_blank" rel="noopener noreferrer"><span class="ig">${igIcon}</span><span class="tx"><b>Follow us on Instagram</b><small>@pakkalocalfooddelivery · offers, new kitchens and food drops first</small></span><span class="fb">Follow</span></a>`;
  // customer support e-mail (Hostinger business mailbox)
  const CARE = 'care@pakkalocal.online';
  const mailIcon = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>';
  const mailCard = () => `<a class="u-ig u-mail" href="mailto:${CARE}?subject=${encodeURIComponent('Pakka Local support')}"><span class="ig">${mailIcon}</span><span class="tx"><b>Email customer support</b><small>${CARE} · we reply as soon as we can</small></span><span class="fb">Email</span></a>`;
  async function support() {
    const qs = new URLSearchParams(location.hash.split('?')[1] || ''); if (qs.get('order')) S.hbOrder = qs.get('order');
    const { tickets } = await PL.api('/api/customer/support/tickets');
    // first message: the assistant greets with the order in progress (time, track) or the usual questions
    if (!S.hb) { const g = await PL.post('/api/customer/support/assistant', { q: '__start__' }).catch(() => ({ reply: 'Hi! Ask me anything about your orders.', actions: [] }));
      S.hb = [{ from: 'bot', body: g.reply, acts: g.actions }]; }
    return `<div class="u-pg u-help">
      <div class="u-hbox"><div class="hd"><span class="av">${I('chat')}</span><span><b>Help assistant</b><small>Instant answers from your orders</small></span></div>
        <div class="log" id="hb-log">${S.hb.map((m, k) => bubble(m.from, m.body, m.from === 'bot' ? botActs(m.acts) + (m.fb && k === S.hb.length - 1 && !S.hbBusy ? feedback : '') : '')).join('')}${S.hbBusy ? `<div class="u-bub bot"><span class="who">${I('chat')}</span><div class="b typing"><i></i><i></i><i></i></div></div>` : ''}</div>
        <form data-form="hb-ask" class="u-hform"><input name="q" placeholder="Type your question…" autocomplete="off" maxlength="300" aria-label="Your question"><button class="btn" type="submit" aria-label="Send">${I('chev')}</button></form></div>
      <div class="u-sec"><h2>Your tickets<small>Chats with the Pakka Local team</small></h2></div>
      ${tickets.length ? `<div class="u-tickets">${tickets.map((t) => `<button class="u-tk" data-act="go" data-path="/support/${e(t.code)}"><span class="tkt"><b>${e(t.code)}</b><span class="u-tag ${ST[t.status][1]}">${ST[t.status][0]}</span></span>
          <span class="tp">${e(t.topic)}${t.order_code ? ` · ${e(t.order_code)}` : ''}</span><span class="ls">${e(t.last || '')}</span>${t.unread ? `<span class="nb">${t.unread} new</span>` : ''}</button>`).join('')}</div>`
        : `<div class="u-empty slim">${I('chat')}<span>No tickets yet. Ask the assistant first; if it can’t solve it, it will connect you to our team.</span></div>`}
      ${mailCard()}${igCard()}</div>`; }
  PL.forms['hb-ask'] = async (f) => { const q = PL.form(f).q.trim(); if (!q) return; f.reset(); await hbAsk(q); };
  PL.actions['hb-ask'] = (el) => hbAsk(el.dataset.q);
  async function hbAsk(q) { S.hb.push({ from: 'me', body: q }); S.hbBusy = true; PL.rerender();
    try { const a = await PL.post('/api/customer/support/assistant', { q }); await new Promise((r) => setTimeout(r, 450)); S.hb.push({ from: 'bot', body: a.reply, acts: a.actions, fb: true }); if (a.handoff) S.hbTopic = a.handoff; }
    catch (x) { S.hb.push({ from: 'bot', body: 'Sorry, I could not answer just now. Please try again in a moment.', fb: true }); }
    S.hbBusy = false; PL.rerender(); }
  PL.actions['hb-ok'] = () => { S.hb.at(-1).fb = false; S.hb.push({ from: 'bot', body: 'Great! Anything else I can help with?' }); PL.rerender(); };
  PL.actions['hb-no'] = async () => { S.hb.at(-1).fb = false; S.hb.push({ from: 'me', body: 'That didn’t solve it' }); S.hbBusy = true; PL.rerender();
    try { const a = await PL.post('/api/customer/support/assistant/unresolved', {}); await new Promise((r) => setTimeout(r, 400));
      if (a.pass) { S.hbPass = a.pass; if (a.order_code) S.hbOrder = a.order_code; if (a.topic) S.hbTopic = a.topic; }
      S.hb.push({ from: 'bot', body: a.reply, acts: [...(a.actions || []), ...(a.pass ? [{ label: 'Contact the Pakka Local team', team: true }] : [])] }); }
    catch { S.hb.push({ from: 'bot', body: 'Sorry, something went wrong. Please try again.' }); }
    S.hbBusy = false; PL.rerender(); };
  PL.actions['hb-team'] = () => (S.hbPass ? PL.go('/support/new') : PL.toast('Ask the assistant first. If it can’t solve it, tap “Not solved”.', 'info'));
  async function supportNew() {
    if (!S.hbPass) { setTimeout(() => PL.go('/support', true), 0); return '<div class="u-pg"></div>'; }
    const [{ topics }, { orders: allOrders }] = await Promise.all([PL.api('/api/customer/support/topics'), PL.api('/api/customer/orders').catch(() => ({ orders: [] }))]);
    const pre = S.hbOrder || '', done = ['DELIVERED', 'REJECTED', 'CANCELLED', 'PAYMENT_FAILED', 'EXPIRED'];
    const orders = allOrders.filter((o) => done.includes(o.status) || o.order_code === pre);
    const last = (S.hb || []).filter((m) => m.from === 'me' && m.body !== 'That didn’t solve it').map((m) => m.body).slice(-1)[0] || '';
    return `<div class="u-pg"><div class="u-box"><h3>${I('chat')} Contact the Pakka Local team</h3><p class="small mute">You’ll get a ticket ID. Our team replies here, and you get a notification.</p>
      <form data-form="tk-new" class="mt2"><label>What is it about?</label><div class="u-topics">${topics.map((t, i) => `<label class="u-topic"><input type="radio" name="topic" value="${e(t)}" ${(S.hbTopic || (pre ? 'Order issue' : topics[0])) === t ? 'checked' : ''}><span>${e(t)}</span></label>`).join('')}</div>
        ${orders.length ? `<label>Which order? (optional)</label><select name="order_code"><option value="">Not about a specific order</option>${orders.slice(0, 10).map((o) => `<option value="${e(o.order_code)}" ${o.order_code === pre ? 'selected' : ''}>${e(o.order_code)} · ${e(o.restaurant)} · ${rs(o.total_paise)}</option>`).join('')}</select>` : ''}
        <label>Your message</label><textarea name="message" rows="5" maxlength="1000" required placeholder="Tell us what happened">${e(last)}</textarea>
        <button class="btn block lg mt" type="submit">Send to the team</button></form></div></div>`; }
  PL.forms['tk-new'] = async (f) => { const v = PL.form(f); const r = await PL.run(() => PL.post('/api/customer/support/tickets', { topic: v.topic, order_code: v.order_code || undefined, message: v.message, pass: S.hbPass }));
    if (!r) return; S.hbTopic = null; S.hbOrder = null; S.hbPass = null; S.hb = null; PL.toast(`Ticket ${r.ticket.code} created. Our team will reply here.`, 'ok'); PL.go(`/support/${r.ticket.code}`, true); };
  async function supportTicket({ code }) {
    const { ticket: t, messages } = await PL.api(`/api/customer/support/tickets/${encodeURIComponent(code)}`);
    return `<div class="u-pg u-help"><div class="u-tkhead"><div><b>${e(t.code)}</b><small>${e(t.topic)}${t.order_code ? ` · ${e(t.order_code)}` : ''} · opened ${PL.dt(t.created_at)}</small></div><span class="u-tag ${ST[t.status][1]}">${ST[t.status][0]}</span></div>
      <div class="u-hbox"><div class="log tall" id="tk-log">${messages.map((m) => bubble(m.from === 'customer' ? 'me' : 'team', m.body, `<span class="tm">${m.from === 'admin' ? 'Pakka Local team · ' : ''}${PL.time(m.created_at)}</span>`)).join('')}
        ${t.status === 'open' ? `<div class="u-wait small mute">${I('clock')} Our team usually replies within a few hours.</div>` : ''}</div>
        <form data-form="tk-send" data-code="${e(t.code)}" class="u-hform"><input name="body" placeholder="${t.status === 'closed' ? 'Write to reopen this ticket…' : 'Type a message…'}" autocomplete="off" maxlength="1000" aria-label="Message"><button class="btn" type="submit" aria-label="Send">${I('chev')}</button></form></div></div>`; }
  PL.forms['tk-send'] = async (f) => { const body = PL.form(f).body.trim(); if (!body) return; const r = await PL.run(() => PL.post(`/api/customer/support/tickets/${encodeURIComponent(f.dataset.code)}/messages`, { body })); if (r) { f.reset(); PL.rerender(); } };

  // Account: profile, notifications, offers, install. (Orders live in the Orders tab; addresses are chosen in the cart.)
  async function account() { const [me, pf] = await Promise.all([PL.api('/api/customer/me'), PL.api('/api/customer/preferences')]); const u = me.user;
    if (!pf.promo_opt_in) PL.put('/api/customer/preferences', { promo_opt_in: true }).catch(() => {});      // offers are always on now (no switch)
    return `<div class="u-pg"><div class="u-prof"><div class="av">${e((u.name || 'P').trim().charAt(0).toUpperCase())}</div><div style="min-width:0"><h1>${e(u.name || 'Pakka Local customer')}</h1><small>${e(u.phone)}</small></div><button class="btn ghost sm" data-act="name-edit">Edit name</button></div>
      ${installCard()}
      <div class="u-menu"><button data-act="go" data-path="/support"><span class="ic">${I('chat')}</span><span><b>Help &amp; support</b><small>Ask the assistant or chat with the Pakka Local team</small></span><span class="chev">${I('chev')}</span></button>
        <button data-act="inbox"><span class="ic">${I('bell')}</span><span><b>Notifications</b><small>Order updates, offers and messages</small></span><span class="chev">${I('chev')}</span></button></div>
      ${mailCard()}${igCard()}
      ${PL.push.card('user')}
      <button class="btn ghost block mt" data-act="logout">${I('logout')} Sign out</button></div>`; }
  PL.actions['name-edit'] = () => PL.modal(`<h3>Your name</h3><form data-form="name-change"><input name="name" maxlength="60" required autocomplete="name"><button class="btn block mt" type="submit">Save</button></form>`);
  PL.forms['name-change'] = async (f) => { const name = PL.form(f).name.trim(); const r = await PL.run(() => PL.post('/api/auth/name', { name }), 'Name saved'); if (!r) return;
    const s = PL.session(); if (s) { s.user = { ...s.user, ...r.user }; PL.setSession(s); } await PL.closeModalAsync(); PL.rerender(); };
  PL.actions.rate = async (el) => { const r = await PL.run(() => PL.post(`/api/customer/orders/${el.dataset.code}/rating`, { stars: Number(el.dataset.s) }), 'Thanks for rating'); if (r) PL.rerender(); };
  PL.actions.goorder = (el) => { const m = /orders\/([A-Z0-9]+)/.exec(el.dataset.link); if (m) PL.go('/orders/' + m[1]); };

  PL.start({ portal: 'user', name: 'Pakka Local', home: '/home', loginView, guest: { routes: ['/home', '/search', '/r/:id'], prompt: guestPrompt },
    tabs: [{ path: '/home', label: 'Home', icon: 'home' }, { path: '/search', label: 'Search', icon: 'search' }, { path: '/orders', label: 'Orders', icon: 'orders' }, { path: '/me', label: 'Account', icon: 'user' }],
    onReady: () => { checkName(); const tick = async () => { try { const { orders } = await PL.api('/api/customer/orders'); PL.badge('/orders', orders.filter((o) => ACTIVE.includes(o.status)).length); } catch {} }; tick(); const iv = setInterval(tick, 10000); PL.hooks.stop = [() => clearInterval(iv)]; },
    routes: { '/home': { title: 'Home', render: home, poll: 6000, after: homeAfter, skel: 'cards' }, '/search': { title: 'Search', render: search, after: () => { runSearch(); const i = PL.$('#s-q'); if (i && !S.sq) i.focus(); }, skel: 'list' },
      '/r/:id': { title: 'Menu', render: menu, poll: 8000, noNav: true, after: () => { filterMenu(); S.popId = null; }, skel: 'menu' }, '/cart': { title: 'Cart', render: cart, poll: 8000, noNav: true, after: () => { S.popId = null; }, skel: 'detail' }, '/pay/:code': { title: 'Payment', render: pay, noNav: true, skel: 'detail' },
      '/orders': { title: 'My orders', render: orders, poll: 5000 }, '/orders/:code': { title: 'Track order', render: track, poll: 2000, skel: 'detail', after: () => { PL.track.customerMount(); mountLottie(); } }, '/me': { title: 'Account', render: account }, '/addresses': { title: 'Delivery addresses', render: addresses }, '/places': { title: 'Find your place', render: placesView }, '/addresses/:id': { title: 'Delivery address', render: addressForm },
      '/support': { title: 'Help & support', render: support, after: () => { const l = PL.$('#hb-log'); if (l) l.scrollTop = l.scrollHeight; } }, '/support/new': { title: 'Contact the team', render: supportNew },
      '/support/:code': { title: 'Support ticket', render: supportTicket, poll: 6000, after: () => { const l = PL.$('#tk-log'); if (l) l.scrollTop = l.scrollHeight; } } } });
})();
