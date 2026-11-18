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
  const catsOf = (txt) => CATS.filter(([, , re]) => re.test(txt)).map(([k]) => k);
  const textOf = (x) => [x.name, x.cuisine, x.description, x.dish_names].filter(Boolean).join(' | ');
  // a restaurant without its own photo shows a photo of its cuisine (labelled by the cuisine, never as their dish)
  const coverOf = (x) => (x.image_path ? `/api/files/public/${encodeURIComponent(x.image_path)}` : catPic(catsOf(textOf(x))[0] || 'thali'));
  const img = (src, cls = '', alt = '') => `<img src="${e(src)}" class="${cls}" alt="${e(alt)}" loading="lazy" decoding="async">`;
  const pubImg = (p) => (p ? `/api/files/public/${encodeURIComponent(p)}` : '');
  const star = '<svg viewBox="0 0 24 24"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/></svg>';
  const kfmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K+` : String(n));
  const rateBadge = (x) => (x.rating ? `<span class="u-rate">${star}${Number(x.rating).toFixed(1)}</span>` : '<span class="u-rate new">New</span>');
  const etaOf = (x) => (x.eta_min ? `${x.eta_min} mins` : '');
  const dietMark = (d) => (d ? `<span class="diet ${e(d)}" role="img" aria-label="${{ veg: 'Veg', nonveg: 'Non-veg', egg: 'Contains egg' }[d] || ''}"></span>` : '');
  const offerOf = (x) => (x.free_delivery_above_paise ? `<span class="of"><small>Free delivery</small>above ${rs(x.free_delivery_above_paise)}</span>` : '');
  const greet = () => { const h = new Date().getHours(); return h < 11 ? 'Good morning' : h < 16 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Late-night cravings?'; };
  const ART = {      // simple original illustrations for empty states (no emoji, no downloaded art)
    bowl: '<svg class="art" viewBox="0 0 160 110" fill="none"><ellipse cx="80" cy="98" rx="58" ry="7" fill="#f1ece6"/><path d="M22 52h116c0 28-26 44-58 44S22 80 22 52z" fill="#ffd9c2"/><path d="M22 52h116" stroke="#d0450b" stroke-width="4" stroke-linecap="round"/><path d="M58 40c0-8 6-8 6-16M80 40c0-8 6-8 6-16M102 40c0-8 6-8 6-16" stroke="#f2a375" stroke-width="3.5" stroke-linecap="round"/></svg>',
    bag: '<svg class="art" viewBox="0 0 160 110" fill="none"><ellipse cx="80" cy="100" rx="52" ry="6" fill="#f1ece6"/><rect x="44" y="34" width="72" height="62" rx="10" fill="#ffe3d1"/><path d="M60 34v-6a20 20 0 0140 0v6" stroke="#d0450b" stroke-width="4" stroke-linecap="round"/><path d="M66 62l10 10 20-20" stroke="#0f8a4f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    search: '<svg class="art" viewBox="0 0 160 110" fill="none"><ellipse cx="80" cy="100" rx="50" ry="6" fill="#f1ece6"/><circle cx="72" cy="50" r="30" fill="#fff3ec" stroke="#d0450b" stroke-width="5"/><path d="M94 72l22 22" stroke="#d0450b" stroke-width="7" stroke-linecap="round"/><path d="M60 50h24" stroke="#f2a375" stroke-width="4" stroke-linecap="round"/></svg>' };
  const empty = (art, title, text, btn = '') => `<div class="u-empty">${ART[art] || ''}<b>${title}</b><div>${text}</div>${btn}</div>`;

  // ---------- login: photo welcome -> mobile number -> code ----------
  function loginView(root) {
    const pics = ['biryani', 'dosa', 'pizza', 'momos', 'curry', 'burger', 'thali', 'noodles', 'rolls', 'cakes', 'idli', 'chai'];
    root.innerHTML = `<div class="splash" id="splash"><img src="/assets/logo.png" alt="Pakka Local"><div class="bar"></div></div>
      <div class="u-login"><div class="u-collage" aria-hidden="true"><div class="grid">${pics.map((k, i) => `<img src="${catPic(k)}" alt="" style="animation-delay:${i * 50}ms">`).join('')}</div>
        <div class="brand"><span class="lg"><img src="/assets/logo.png" alt=""></span><p>Your neighbourhood, delivered.</p><span>Hot food from kitchens near your PG, hostel or college</span></div></div>
      <div class="u-lsheet" id="u-lsheet"><h2>Hungry? Let’s get started</h2><p class="s">Log in or sign up with your mobile number.</p><button class="btn block lg" data-act="to-login">Continue with mobile number</button>
        <p class="fine">Online payment only · Live order tracking</p></div></div>`;
    setTimeout(() => PL.$('#splash')?.classList.add('out'), 1100); setTimeout(() => PL.$('#splash')?.remove(), 1600);
  }
  const sheet = (html) => { const s = PL.$('#u-lsheet'); if (s) { s.innerHTML = html; s.style.animation = 'none'; void s.offsetWidth; s.style.animation = ''; return; } loginView(PL.$('#root')); PL.$('#splash')?.remove(); PL.$('#u-lsheet').innerHTML = html; };
  PL.actions['to-login'] = () => {
    sheet(`<h2>Log in or sign up</h2><p class="s">We’ll send a one-time code on WhatsApp.</p>
      <form data-form="otp-request"><label for="c-ph" class="small mute">Mobile number</label><div class="field pre"><span>+91</span><input id="c-ph" name="phone" inputmode="tel" autocomplete="tel" placeholder="98765 43210" required autofocus></div><button class="btn block lg mt" type="submit">Send code</button></form><div id="email-login"></div>
      <p class="fine">By continuing you agree to receive order updates on WhatsApp.</p>`);
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
  const codeForm = (form, attr, sentTo, note) => `<h2>Enter the 6-digit code</h2><p class="s">Sent to <b>${e(sentTo)}</b>${note ? `. ${note}` : ''}</p>
      <form data-form="${form}" ${attr}><input class="otp-in" placeholder="••••••" name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" required autofocus aria-label="6-digit code">
      <label class="small mute">Your name (optional)</label><input name="name" autocomplete="name" maxlength="80"><button class="btn block lg mt" type="submit">Verify and continue</button></form>`;
  function emailOtpView(email, wait) {
    sheet(`${codeForm('email-otp-verify', `data-email="${e(email)}"`, email, 'Check spam too. It expires in 5 minutes')}
      <button class="btn ghost block mt2" id="resend" data-act="email-resend" data-email="${e(email)}" disabled>Resend in ${wait}s</button><button class="btn ghost block mt2" data-act="to-email-login">Change email</button>`);
    countdown(wait);
  }
  const countdown = (wait) => { let t = wait; const iv = setInterval(() => { const b = PL.$('#resend'); if (!b) return clearInterval(iv); t--; if (t <= 0) { b.disabled = false; b.textContent = 'Resend code'; clearInterval(iv); } else b.textContent = `Resend in ${t}s`; }, 1000); };
  PL.actions['email-resend'] = async (el) => { const r = await PL.run(() => PL.post('/api/auth/customer/email-otp/request', { email: el.dataset.email }), 'Code sent'); if (r) emailOtpView(el.dataset.email, r.resendAfterSec); };
  PL.forms['email-otp-verify'] = async (f) => { const v = PL.form(f); const body = { email: f.dataset.email, otp: v.otp }; if (v.name?.trim()) body.name = v.name.trim();
    const r = await PL.run(() => PL.post('/api/auth/customer/email-otp/verify', body)); if (r) { PL.setSession(r); history.replaceState({ idx: 0 }, '', location.hash || '#'); PL.boot(); } };
  const normPhone = (p) => { p = p.replace(/[\s-]/g, ''); return /^\d{10}$/.test(p) ? '+91' + p : p; };
  PL.forms['otp-request'] = async (f) => { const phone = normPhone(PL.form(f).phone); const r = await PL.run(() => PL.post('/api/auth/customer/otp/request', { phone })); if (r) otpView(phone, r.resendAfterSec); };
  function otpView(phone, wait) {
    sheet(`${codeForm('otp-verify', `data-phone="${e(phone)}"`, phone)}
      <button class="btn ghost block mt2" id="resend" data-act="resend" data-phone="${e(phone)}" disabled>Resend in ${wait}s</button><button class="btn ghost block mt2" data-act="to-login">Change number</button>`);
    countdown(wait);
  }
  PL.actions.resend = async (el) => { const r = await PL.run(() => PL.post('/api/auth/customer/otp/request', { phone: el.dataset.phone }), 'Code sent'); if (r) otpView(el.dataset.phone, r.resendAfterSec); };
  PL.forms['otp-verify'] = async (f) => { const v = PL.form(f); const body = { phone: f.dataset.phone, otp: v.otp }; if (v.name?.trim()) body.name = v.name.trim();
    const r = await PL.run(() => PL.post('/api/auth/customer/otp/verify', body)); if (r) { PL.setSession(r); history.replaceState({ idx: 0 }, '', location.hash || '#'); PL.boot(); } };

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
  const card = (x, i) => { const cats = catsOf(textOf(x)), eta = etaOf(x);
    return `<button class="u-rrow ${x.is_open ? '' : 'u-closed'}" style="--i:${Math.min(i, 8)}" data-act="go" data-path="/r/${x.id}" data-s="${e(textOf(x).toLowerCase())}" data-cats="${cats.join(' ')}" data-open="${x.is_open ? 1 : 0}" data-r="${x.rating || 0}" data-eta="${x.eta_min || 999}" data-veg="${x.veg_only ? 1 : 0}" data-o="${i}">
      <span class="im">${img(coverOf(x), '', '')}${x.is_open ? offerOf(x) : `<span class="cl">Closed${x.reopen_at ? `<br>Opens ${PL.time(x.reopen_at)}` : ''}</span>`}</span>
      <span class="tx"><h3>${e(x.name)}</h3><span class="mt">${rateBadge(x)}${x.rating_count ? `<span class="small mute" style="font-weight:600;margin-right:2px">(${kfmt(x.rating_count)})</span>` : ''}${eta && x.is_open ? `<span class="u-dot"></span>${eta}` : ''}</span>
        <span class="cu">${e(x.cuisine || 'Local favourites')}</span>${x.description ? `<span class="ds">${e(x.description)}</span>` : ''}
        <span class="tags">${x.veg_only ? `<span class="u-tag g">${dietMark('veg')} Pure veg</span>` : ''}${x.min_order_paise ? `<span class="u-tag">Min ${rs(x.min_order_paise)}</span>` : ''}</span></span></button>`; };
  async function home() {
    const [c, r, my, me, adr] = await Promise.all([PL.api('/api/public/config'), PL.api('/api/public/restaurants'), PL.api('/api/customer/orders').catch(() => ({ orders: [] })), PL.api('/api/customer/me').catch(() => ({ user: {} })), PL.api('/api/customer/addresses').catch(() => ({ addresses: [] }))]);
    const all = r.restaurants, open = all.filter((x) => x.is_open), active = my.orders.filter((o) => ACTIVE.includes(o.status)), recent = my.orders.filter((o) => o.status === 'DELIVERED').slice(0, 8);
    const ad = adr.addresses, cur = ad.find((x) => x.id === S.addrId) || ad.find((x) => x.is_default) || ad[0];
    const name = (me.user?.name || '').trim().split(' ')[0];
    const counts = Object.fromEntries(CATS.map(([k]) => [k, all.filter((x) => catsOf(textOf(x)).includes(k)).length]));
    const cats = CATS.filter(([k]) => counts[k]); S.words = cats.map(([, l]) => l.toLowerCase().split(' ')[0]).slice(0, 6);
    const picks = [...open].sort((p, q) => (q.rating || 0) - (p.rating || 0) || (q.rating_count || 0) - (p.rating_count || 0)).slice(0, 10);
    // banners: only true statements (real free-delivery rules from restaurants, real features)
    const fd = open.filter((x) => x.free_delivery_above_paise).sort((p, q) => p.free_delivery_above_paise - q.free_delivery_above_paise)[0];
    const top = cats[0];
    const bans = [fd && `<button class="u-ban b-or" data-act="go" data-path="/r/${fd.id}"><span class="k">Free delivery</span><b>On orders above ${rs(fd.free_delivery_above_paise)}</b><span class="s">from ${e(fd.name)}</span><span class="cta">Order now ${I('chev')}</span>${img(coverOf(fd), 'ph')}</button>`,
      top && `<button class="u-ban b-gr" data-act="cat" data-k="${top[0]}"><span class="k">Near you</span><b>${e(top[1])} from local kitchens</b><span class="s">${counts[top[0]]} restaurant${counts[top[0]] > 1 ? 's' : ''} serving it now</span><span class="cta">Explore ${I('chev')}</span>${img(catPic(top[0]), 'ph')}</button>`,
      `<div class="u-ban b-dk"><span class="k">Live tracking</span><b>Watch your rider on the map</b><span class="s">From the restaurant to your gate</span><svg class="art" viewBox="0 0 140 100" fill="none"><rect x="6" y="8" width="128" height="84" rx="16" fill="#2b3046"/><path d="M18 70c20-30 40 10 60-20s30-20 46-34" stroke="#ff9248" stroke-width="4" stroke-dasharray="7 7" stroke-linecap="round"/><circle cx="18" cy="70" r="7" fill="#fff"/><path d="M118 6c-8 0-13 6-13 12 0 9 13 20 13 20s13-11 13-20c0-6-5-12-13-12z" fill="#d0450b"/><circle cx="118" cy="18" r="4" fill="#fff"/></svg></div>`,
      `<div class="u-ban b-pl"><span class="k">Simple checkout</span><b>Pay online. No cash needed.</b><span class="s">Every charge shown before you pay</span><svg class="art" viewBox="0 0 140 100" fill="none"><rect x="20" y="18" width="100" height="66" rx="12" fill="#fff" opacity=".95"/><rect x="20" y="32" width="100" height="12" fill="#5b2a86" opacity=".35"/><rect x="32" y="58" width="36" height="8" rx="4" fill="#8a3ea8" opacity=".5"/><circle cx="104" cy="66" r="12" fill="#0f8a4f"/><path d="M98 66l4 4 8-8" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`].filter(Boolean);
    const notes = [c.testPayments ? `<div class="u-note info">${I('info')}<span><b>Test mode.</b> Payments are simulated on this staging app.</span></div>` : '', c.paymentsAvailable === false ? `<div class="u-note">${I('info')}<span>Ordering opens soon. You can browse menus now.</span></div>` : '', !c.ridersAvailable ? `<div class="u-note">${I('bike')}<span>${e(c.noRiderMessage)}</span></div>` : ''].join('');
    const live = active[0];
    return `<div class="u-head" id="u-head"><div class="row1"><button class="u-loc" data-act="go" data-path="/addresses"><span class="pin">${I('pin')}</span><span class="txt"><b>${cur ? e(cur.kind === 'listed' ? cur.place_name || 'Selected place' : LBL[cur.label] || 'Home') : 'Set delivery location'}${I('chev')}</b><small>${cur ? e(addrLine(cur, cur.kind === 'listed')) : 'Choose your PG, hostel or college'}</small></span></button>${PL.inbox.btn()}<button class="u-av" data-act="go" data-path="/me" aria-label="Account">${e((name || 'P').charAt(0).toUpperCase())}</button></div>
        <a class="u-search" href="#/search" aria-label="Search for restaurants and dishes">${I('search')}<span class="ph">Search for ‘<i id="u-word">${e(S.words[0] || 'biryani')}</i>’</span></a></div>
      ${notes}
      ${bans.length ? `<div class="u-bans" id="u-bans">${bans.join('')}</div><div class="u-bdots" id="u-bdots">${bans.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
      ${cats.length ? `<div class="u-sec"><h2>${name ? `${e(name)}, what’s on your mind?` : 'What’s on your mind?'}</h2></div><div class="u-cats ${cats.length < 7 ? 'one' : ''}" id="u-cats">${cats.map(([k, l]) => `<button class="u-cat ${S.cat === k ? 'on' : ''}" data-act="cat" data-k="${k}" aria-pressed="${S.cat === k}"><span class="im"><img src="${catPic(k)}" alt="" loading="lazy"></span>${e(l)}</button>`).join('')}</div>` : ''}
      ${recent.length ? `<div class="u-sec"><h2>Order again</h2></div><div class="u-hscroll">${recent.map((o) => `<button class="u-again" data-act="go" data-path="/orders/${e(o.order_code)}">${o.restaurant_image ? img(pubImg(o.restaurant_image)) : '<span class="ph"></span>'}<span class="txt"><b>${e(o.restaurant)}</b><small>${e(o.summary || '')}</small><small>${PL.dt(o.created_at)} · ${rs(o.total_paise)}</small></span></button>`).join('')}</div>` : ''}
      ${picks.length > 1 ? `<div class="u-sec"><h2>Top rated near you<small>${greet()}! These kitchens are open now</small></h2></div><div class="u-hscroll">${picks.map((x) => `<button class="u-pick" data-act="go" data-path="/r/${x.id}"><span class="im" style="display:block">${img(coverOf(x))}${offerOf(x)}</span><h3>${e(x.name)}</h3><span class="mt">${rateBadge(x)}${etaOf(x) ? `<span class="u-dot"></span>${etaOf(x)}` : ''}</span><div class="cu">${e(x.cuisine || 'Local favourites')}</div></button>`).join('')}</div>` : ''}
      <div class="u-sec"><h2 id="u-count">${all.length} restaurant${all.length === 1 ? '' : 's'} to explore</h2></div>
      ${all.length > 1 ? `<div class="u-chips" id="u-chips"><button class="u-chip" data-act="sort">${I('filter')} Sort${S.sort && S.sort !== 'rel' ? ': ' + { rating: 'Rating', eta: 'Fastest' }[S.sort] : ''} ${I('chev', 'style="transform:rotate(90deg);width:14px;height:14px"')}</button>${[['open', 'Open now'], ['fast', 'Under 35 mins'], ['r4', 'Rating 4.0+'], ['veg', 'Pure veg']].filter(([k]) => k !== 'veg' || all.some((x) => x.veg_only)).map(([k, l]) => `<button class="u-chip ${S.fl?.[k] ? 'on' : ''}" data-act="fl" data-k="${k}" aria-pressed="${!!S.fl?.[k]}">${l}<span class="x">${I('x')}</span></button>`).join('')}</div>` : ''}
      ${all.length ? `<div class="u-list u-in" id="u-list">${all.map(card).join('')}</div><div id="u-none" class="hide">${empty('search', 'No restaurants match', 'Try removing a filter.', '<button class="btn ghost mt" data-act="fl-clear">Clear filters</button>')}</div>` : empty('bowl', 'No restaurants yet', 'Kitchens near you will appear here soon.')}
      ${live ? `<button class="u-live" data-act="go" data-path="/orders/${e(live.order_code)}"><span class="ic">${I(live.status === 'PICKED_UP' ? 'bike' : live.status === 'READY' ? 'box' : 'chef')}</span><span class="txt"><b>${e(SAY[live.status]?.[0] || live.status)}</b><small>${e(live.restaurant)}${live.eta_at ? ` · ${etaText(live)}` : ''}${active.length > 1 ? ` · +${active.length - 1} more` : ''}</small></span><span class="go">Track ${I('chev')}</span></button>` : ''}`;
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
  const homeAfter = () => { filterHome();
    const w = PL.$('#u-word'), words = S.words?.length ? S.words : ['biryani']; let wi = 0;
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
    return `<div class="u-shead"><button class="bk" data-act="back" aria-label="Back">${I('chev')}</button><label class="u-search">${I('search')}<input id="s-q" type="search" value="${e(S.sq || '')}" placeholder="Search restaurants and dishes" autocomplete="off" aria-label="Search restaurants and dishes"><button class="x ${S.sq ? '' : 'hide'}" data-act="sq-clear" aria-label="Clear">${I('x')}</button></label></div>
      <div id="s-out"></div>
      <div id="s-idle">${recentQ().length ? `<div class="u-sec" style="margin-top:14px"><h2 style="font-size:1rem">Recent searches</h2><button class="lk" data-act="sq-forget">Clear</button></div><div class="u-recent">${recentQ().map((q) => `<button data-act="sq" data-q="${e(q)}">${I('clock')}${e(q)}</button>`).join('')}</div>` : ''}
        ${cats.length ? `<div class="u-sec"><h2 style="font-size:1rem">Popular cuisines</h2></div><div class="u-cats one">${cats.map(([k, l]) => `<button class="u-cat" data-act="sq" data-q="${e(l.split(' ')[0])}"><span class="im"><img src="${catPic(k)}" alt="" loading="lazy"></span>${e(l)}</button>`).join('')}</div>` : ''}</div>`; }
  const runSearch = () => { const out = PL.$('#s-out'), idle = PL.$('#s-idle'); if (!out) return; const q = (S.sq || '').trim().toLowerCase(); PL.$('#s-q')?.nextElementSibling?.classList.toggle('hide', !q);
    idle?.classList.toggle('hide', !!q); if (!q) { out.innerHTML = ''; return; }
    const rest = (S.allR || []).filter((x) => textOf(x).toLowerCase().includes(q) || catsOf(textOf(x)).some((k) => CATS.find((c) => c[0] === k)[1].toLowerCase().includes(q)));
    const dishes = (S.allR || []).flatMap((x) => (x.dish_names || '').split(' | ').filter((d) => d && d.toLowerCase().includes(q)).map((d) => ({ d, x, i: S.menus?.[x.id]?.find((m) => m.name === d) }))).slice(0, 20);
    const need = [...new Set(dishes.filter((r) => !S.menus?.[r.x.id]).map((r) => r.x.id))];      // load those menus once for real dish photos and prices
    if (need.length) Promise.all(need.map((id) => PL.api(`/api/public/restaurants/${id}/menu`).then((m) => { (S.menus ||= {})[id] = m.items; }).catch(() => { (S.menus ||= {})[id] = []; }))).then(() => { if ((S.sq || '').trim().toLowerCase() === q) runSearch(); });
    out.innerHTML = !rest.length && !dishes.length ? empty('search', `No results for “${e(S.sq.trim())}”`, 'Check the spelling or try a cuisine like biryani or dosa.')
      : `${rest.length ? `<div class="u-sec" style="margin-top:14px"><h2 style="font-size:1rem">Restaurants</h2></div>${rest.map((x) => `<button class="u-sres" data-act="sgo" data-path="/r/${x.id}">${img(coverOf(x))}<span class="txt"><b>${e(x.name)}</b><small>${x.rating ? `★ ${Number(x.rating).toFixed(1)} · ` : ''}${e(x.cuisine || '')}${x.is_open ? '' : ' · Closed'}</small></span><span class="ty">Restaurant</span></button>`).join('')}` : ''}
         ${dishes.length ? `<div class="u-sec"><h2 style="font-size:1rem">Dishes</h2></div>${dishes.map(({ d, x, i }) => `<button class="u-sres" data-act="sgo" data-path="/r/${x.id}" data-mq="${e(d)}">${i?.image_path ? img(pubImg(i.image_path)) : '<span class="ph"></span>'}<span class="txt"><b>${i ? dietMark(i.diet) + ' ' : ''}${e(d)}</b><small>${i ? `${rs(i.price_paise)} · ` : ''}in ${e(x.name)}${x.is_open ? '' : ' · Closed'}</small></span><span class="ty">Dish</span></button>`).join('')}` : ''}`; };
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
      <div class="side ${i.image_path ? '' : 'noimg'}">${i.image_path ? img(pubImg(i.image_path), '', i.name) : ''}<div class="ctl">${ctl(i)}</div></div></div>`;
    const known = new Set(m.categories.map((x) => x.id));
    const groups = [...m.categories.map((x) => [x.name, m.items.filter((i) => i.category_id === x.id)]), [m.categories.length ? 'More dishes' : 'Menu', m.items.filter((i) => !known.has(i.category_id))]].filter((g) => g[1].length);
    S.menuGroups = groups.map(([n, l]) => [n, l.length]);
    const prep = m.items.length ? Math.round(m.items.reduce((a, i) => a + (i.prep_time_min || 0), 0) / m.items.length) : 0;
    const inThis = S.cart.rid === r.id && cartCount(), hasDiet = m.items.some((i) => i.diet), col = (S.col ||= {})[r.id] ||= {};
    const offers = [r.free_delivery_above_paise && [I('bike'), `Free delivery above ${rs(r.free_delivery_above_paise)}`, 'Delivery charge waived on bigger orders'], r.min_order_paise && [I('receipt'), `Minimum order ${rs(r.min_order_paise)}`, 'Item total needed to order'], [I('shield'), 'Pay online', 'No cash needed at the door']].filter(Boolean);
    const cover = r.image_path ? pubImg(r.image_path) : catPic(catsOf(textOf({ ...r, dish_names: m.items.map((i) => i.name).join(' ') }))[0] || 'thali');
    return `<div class="u-hero">${img(cover, '', r.name)}<div class="tb"><button class="u-iconbtn" data-act="back" aria-label="Back">${I('chev', 'class="flip"')}</button><div class="grp"><button class="u-iconbtn" data-act="focus-mq" aria-label="Search the menu">${I('search')}</button></div></div></div>
      <div class="u-rinfo"><div class="r1"><div style="min-width:0"><h1>${e(r.name)}</h1><div class="cu">${e(r.cuisine || 'Local favourites')}</div></div><div class="rbox ${r.rating ? '' : 'new'}"><b>${r.rating ? star + Number(r.rating).toFixed(1) : 'New'}</b><span>${r.rating_count ? `${kfmt(r.rating_count)} ratings` : 'No ratings'}</span></div></div>
        ${r.description ? `<div class="ds">${e(r.description)}</div>` : ''}${r.operating_info ? `<div class="ds">${e(r.operating_info)}</div>` : ''}
        <div class="facts"><div>${I('clock')}<span class="txt"><b>${prep ? `${prep + (r.packing_buffer_min || 0)} mins` : '–'}</b><small>to prepare</small></span></div><div>${I(r.is_open ? 'check' : 'clock')}<span class="txt"><b>${r.is_open ? 'Open now' : 'Closed'}</b><small>${r.is_open ? 'Taking orders' : 'Opens later'}</small></span></div></div></div>
      ${noRiders(c)}${r.is_open ? '' : `<div class="u-note bad">${I('clock')}<span>This restaurant is closed right now. You can browse the menu; ordering opens when it reopens.</span></div>`}
      <div class="u-offers">${offers.map(([ic, b, s]) => `<div class="u-offer"><span class="ic">${ic}</span><span class="txt"><b>${b}</b><small>${s}</small></span></div>`).join('')}</div>
      ${m.items.length ? `<div class="u-mbar"><label class="u-search">${I('search')}<input id="m-q" type="search" value="${e(S.mq || '')}" placeholder="Search for dishes" autocomplete="off" aria-label="Search dishes"></label>${hasDiet ? `<button class="u-veg ${S.veg ? 'on' : ''}" data-act="veg" aria-pressed="${!!S.veg}">${dietMark('veg')}<span>Veg</span><span class="tg"></span></button>` : ''}</div>` : ''}
      ${groups.map(([n, list], gi) => `<section class="u-msec ${col[gi] ? 'shut' : ''}" id="cat-${gi}"><button data-act="col" data-i="${gi}" data-r="${r.id}" aria-expanded="${!col[gi]}"><h2>${e(n)}<small>${list.length}</small></h2>${I('chev')}</button><div class="u-dishes" data-g="${gi}">${list.map(dish).join('')}</div></section>`).join('') || empty('bowl', 'Menu coming soon', 'This kitchen hasn’t added dishes yet.')}
      ${groups.length > 1 ? `<button class="u-fab ${inThis ? 'up' : ''}" data-act="menu-sheet">${I('menu')} MENU</button>` : ''}
      ${inThis ? `<button class="u-cartbar" data-act="go" data-path="/cart"><span class="l"><b>${cartCount()} item${cartCount() > 1 ? 's' : ''} added</b><small>${rs(cartTotal())} · delivery charge shown in cart</small></span><span class="r">View cart ${I('chev')}</span></button>` : ''}`;
  }
  const noRiders = (c) => (c.ridersAvailable ? '' : `<div class="u-note">${I('bike')}<span>${e(c.noRiderMessage)}</span></div>`);
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
    PL.modal(`<div class="u-dsheet">${i.image_path ? img(pubImg(i.image_path), 'big', i.name) : ''}<div class="bd">${dietMark(i.diet)}<h3>${e(i.name)}</h3>${i.description ? `<div class="ds">${e(i.description)}</div>` : ''}<div class="small mute mt2">About ${i.prep_time_min} min to prepare</div>
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
  const body = () => ({ restaurant_id: S.cart.rid, items: Object.entries(S.cart.items).map(([id, i]) => ({ id: Number(id), qty: i.qty })), instructions: S.instr || undefined, address_id: S.addrId || undefined });
  async function cart() {
    if (!cartCount()) return `<div class="u-pg">${empty('bag', 'Your cart is empty', 'Good food is always cooking. Go ahead, order some yummy items from the menu.', '<button class="btn mt" data-act="go" data-path="/home">Browse restaurants</button>')}</div>`;
    const [{ addresses: ad, gps_fee_paise: gpsFee }, { locations: places }] = await Promise.all([PL.api('/api/customer/addresses'), PL.api('/api/public/locations')]);
    const placeOf = (x) => places.find((l) => l.id === x.delivery_location_id);
    if (!ad.some((x) => x.id === S.addrId)) { S.addrId = (ad.find((x) => x.is_default) || ad[0])?.id || null; save('pl.addr', S.addrId); S.confirmed = false; }
    let sel = ad.find((x) => x.id === S.addrId);
    if (!S.method) S.method = sel ? (sel.kind === 'listed' ? 'list' : 'gps') : places.length ? 'list' : 'gps';
    if (sel && (sel.kind === 'listed') !== (S.method === 'list')) {                                // selection must match the chosen method:
      sel = ad.filter((x) => (x.kind === 'listed') === (S.method === 'list')).sort((p, q) => q.is_default - p.is_default)[0] || null;   // use that method's default/latest address
      S.addrId = sel?.id ?? S.addrId; if (sel) save('pl.addr', S.addrId); }
    const mine = ad.filter((x) => (S.method === 'list' ? x.kind === 'listed' : x.kind !== 'listed'));
    let q = null, err = null;
    if (sel) { try { q = await PL.post('/api/customer/quote', body()); } catch (x) { err = x; } }
    const items = `<div class="u-box"><div class="u-crest">${S.cart.rimg ? img(pubImg(S.cart.rimg)) : `<span class="ph" style="display:grid;place-items:center;color:var(--brand)">${I('shop')}</span>`}<span class="txt"><b>${e(S.cart.rname)}</b><small>${cartCount()} item${cartCount() > 1 ? 's' : ''} · ${rs(cartTotal())}</small></span></div>
      <div class="mt2">${Object.entries(S.cart.items).map(([id, i]) => `<div class="u-cline"><div class="nm"><b>${i.diet ? dietMark(i.diet) : ''}<span>${e(i.name)}</span></b><small>${rs(i.price)} each</small></div><div class="rt"><div class="u-step sm ${S.popId == id ? 'pop' : ''}"><button data-act="dec" data-id="${id}" aria-label="Remove one ${e(i.name)}">−</button><span>${i.qty}</span><button data-act="inc" data-id="${id}" aria-label="Add one ${e(i.name)}">+</button></div><span class="amt">${rs(i.price * i.qty)}</span></div></div>`).join('')}</div>
      <button class="u-addmore" data-act="go" data-path="/r/${S.cart.rid}">${I('plus')} Add more items</button>
      <textarea class="u-ta" data-bind="instr" maxlength="300" placeholder="Add a note for the restaurant (optional)" aria-label="Note for this order">${e(S.instr)}</textarea></div>`;
    const tabs = `<div class="u-seg" role="tablist">
      <button role="tab" aria-selected="${S.method === 'list'}" class="${S.method === 'list' ? 'on' : ''}" data-act="method" data-m="list">${I('shop')}<span><b>PG / hostel / college</b><small>From Pakka Local’s list</small></span></button>
      <button role="tab" aria-selected="${S.method === 'gps'}" class="${S.method === 'gps' ? 'on' : ''}" data-act="method" data-m="gps">${I('pin')}<span><b>My GPS location</b><small>Place not on the list</small></span></button></div>`;
    const acard = (x) => { const pl = placeOf(x), on = sel && x.id === sel.id; return `<label class="u-addr addr-pick ${on ? 'on' : ''}"><input type="radio" name="addr" value="${x.id}" ${on ? 'checked' : ''}><span class="t"><b>${e(x.kind === 'listed' ? (pl?.name || x.place_name) : LBL[x.label])}</b>${x.is_default ? ' <span class="u-pill" style="height:20px;font-size:.66rem">Default</span>' : ''}
      <div class="l1">${e(addrLine(x, x.kind === 'listed'))}</div>${x.entrance || x.landmark ? `<div class="l2">${e([x.entrance, x.landmark].filter(Boolean).join(' · '))}</div>` : ''}<div class="l2">${x.lat != null ? `GPS ±${Math.round(x.accuracy_m)} m` : 'Uses the place’s map point'}</div></span>
      <span class="fee">${x.kind === 'listed' ? (pl ? rs(pl.delivery_fee_paise) : 'Unavailable') : rs(gpsFee)}</span></label>`; };
    const addrPart = S.method === 'list'
      ? `${places.length ? '' : `<div class="u-note">${I('info')}<span>There are no places on the list yet. Use your GPS location instead.</span></div>`}${mine.map(acard).join('')}
        ${places.length ? `<button class="u-lnk" data-act="go" data-path="/places?back=cart">${I('search')} ${mine.length ? 'Choose another place from the list' : 'Find my PG, hostel or college'}</button>` : ''}
        <p class="small mute mt2" style="text-align:center">Can’t find your place? <a href="#" data-act="method" data-m="gps">Use your GPS location instead</a>.</p>`
      : `<div class="u-note info">${I('info')}<span>Delivery charge for places not on the list: <b>${rs(gpsFee)}</b></span></div>${mine.map(acard).join('')}
        <button class="u-lnk" data-act="go" data-path="/addresses/new?back=cart">${I('pin')} ${mine.length ? 'Add a new GPS address' : 'Add address with my GPS location'}</button>${sel ? `<button class="u-lnk" data-act="go" data-path="/addresses/${sel.id}?back=cart&gps=1">${I('refresh')} I’ve moved: update GPS</button>` : ''}`;
    const confirm = sel ? `<label class="u-confirm ${S.confirmed ? 'ok' : ''}"><input type="checkbox" id="confirm-dest" ${S.confirmed ? 'checked' : ''}><span>${sel.kind === 'listed' ? `Deliver to <b>${e(addrLine(sel))}</b>. This is the place I am ordering for.` : `Deliver to this point. The location was captured ${PL.dt(sel.captured_at)} and I am ordering for that place.`}</span></label>` : '';
    const bill = q ? `<div class="u-box u-bill"><h3>${I('receipt')} Bill details</h3><div class="mt2"><div class="kv"><span>Item total<small>Restaurant prices</small></span><span>${rs(q.items_base_paise)}</span></div>${q.markup_paise ? `<div class="kv"><span>Platform markup</span><span>${rs(q.markup_paise)}</span></div>` : ''}
        <div class="kv"><span>Delivery charge<small>${q.delivery_pricing === 'distance' ? `${e(q.delivery_distance_km)} km by road from ${e(S.cart.rname)}` : q.delivery_pricing === 'distance_fallback' ? 'Standard charge' : q.delivery_type === 'listed' ? e(q.delivery_location) : 'Fixed charge for places not on the list'}${q.delivery_paise < q.delivery_fee_before_offers_paise ? ' · free above the restaurant’s minimum' : ''}</small></span><span>${q.delivery_paise < q.delivery_fee_before_offers_paise ? `<s class="mute" style="font-weight:500;margin-right:6px">${rs(q.delivery_fee_before_offers_paise)}</s>` : ''}${rs(q.delivery_paise)}</span></div>
        ${q.delivery_fallback ? `<div class="u-note info small">${I('info')}<span>We couldn’t measure the road distance right now, so the standard delivery charge applies.</span></div>` : ''}${q.surge_paise ? `<div class="kv"><span>Surge charge</span><span>${rs(q.surge_paise)}</span></div>` : ''}${q.tax_paise ? `<div class="kv"><span>Taxes</span><span>${rs(q.tax_paise)}</span></div>` : ''}
        <div class="kv tot"><span>To pay</span><span>${rs(q.total_paise)}</span></div></div><div class="small mute">Estimated delivery in ~${q.prep_min + 8 + q.delivery_min} min</div></div>` : '';
    return `<div class="u-pg">${items}
      <div class="u-box"><h3>${I('pin')} Delivery at</h3>${tabs}${addrPart}${confirm}</div>
      ${err ? `<div class="u-note ${err.code === 'NO_RIDERS' ? '' : 'bad'}">${I('alert')}<span>${e(err.message)}${err.code === 'NO_MAP_POINT' && sel ? `<br><button class="btn sm mt2" data-act="go" data-path="/addresses/${sel.id}?back=cart&gps=1">Add my GPS location</button>` : ''}</span></div>` : ''}
      ${bill}
      <div class="u-cod">${I('shield')} Online payment only. Cash on delivery is not available.</div></div>
      <div class="u-paybar"><span class="l"><b>${q ? rs(q.total_paise) : rs(cartTotal())}</b><small>${q ? 'To pay' : 'Item total'}</small></span><button class="go" data-act="place" ${q && !err && S.confirmed ? '' : 'disabled'}>${!sel ? 'Choose delivery place' : !S.confirmed ? 'Confirm delivery point' : q ? `Proceed to pay ${I('chev')}` : 'Not available'}</button></div>`;
  }
  PL.actions.method = (el, ev) => { ev?.preventDefault?.(); if (S.method === el.dataset.m) return; S.method = el.dataset.m; S.confirmed = false; PL.rerender(); };

  // searchable list of Pakka Local's places (active only, as returned by the server)
  async function placesView() { const qs = new URLSearchParams(location.hash.split('?')[1] || ''); const { locations: places } = await PL.api('/api/public/locations');
    return `<div class="u-pg"><h2>Find your place</h2><p class="small mute mt2">PGs, hostels and colleges Pakka Local delivers to, with each place’s delivery charge.</p>
      <label class="u-search">${I('search')}<input id="place-q" type="search" placeholder="Search by name or area" autocomplete="off" aria-label="Search places"></label>
      <div id="place-list" class="mt">${places.map((l) => `<button class="u-addr place-card" style="width:100%;background:#fff;text-align:left" data-act="place-pick" data-id="${l.id}" data-s="${e([l.name, l.area, l.address, l.kind].join(' ').toLowerCase())}"><span class="u-loc" style="padding:0;flex:none"><span class="pin">${I('pin')}</span></span><span class="t"><b>${e(l.name)}</b><div class="l1">${l.kind ? `${e(l.kind)} · ` : ''}${e([l.area, l.address].filter(Boolean).join(' · '))}</div></span><span class="fee">${rs(l.delivery_fee_paise)}</span></button>`).join('') || empty('search', 'No places yet', 'No places are on the list yet.')}</div>
      <div id="place-none" class="hide">${empty('search', 'No place matches', `Check the spelling, or <a href="#" data-act="go" data-path="/addresses/new?back=${e(qs.get('back') || 'cart')}">use your GPS location</a>.`)}</div></div>`; }
  document.addEventListener('input', (ev) => { if (ev.target.id !== 'place-q') return; const n = ev.target.value.trim().toLowerCase(); let shown = 0;
    document.querySelectorAll('.place-card').forEach((c) => { const ok = !n || c.dataset.s.includes(n); c.classList.toggle('hide', !ok); shown += ok; }); PL.$('#place-none')?.classList.toggle('hide', shown > 0); });
  PL.actions['place-pick'] = async (el) => { const id = Number(el.dataset.id), qs = new URLSearchParams(location.hash.split('?')[1] || '');
    if (qs.get('for') === 'form' && F) { F.a.delivery_location_id = id; return PL.go(F.url, true); }              // changing the place inside the address form
    const have = (await PL.api('/api/customer/addresses')).addresses.find((x) => x.kind === 'listed' && x.delivery_location_id === id);
    if (have) { S.addrId = have.id; save('pl.addr', S.addrId); S.method = 'list'; S.confirmed = false; return PL.go(qs.get('back') === 'addresses' ? '/addresses' : '/cart', true); }
    PL.go(`/addresses/new?kind=listed&place=${id}&back=${qs.get('back') || 'cart'}`); };

  document.addEventListener('change', (ev) => { const t = ev.target;
    if (t.name === 'addr' && t.closest('.addr-pick')) { S.addrId = Number(t.value); save('pl.addr', S.addrId); S.confirmed = false; PL.rerender(); }      // picking an address keeps its method
    if (t.id === 'confirm-dest') { S.confirmed = t.checked; PL.rerender(); } });
  PL.actions.place = async (el) => { if (!S.confirmed) return PL.toast('Confirm the delivery point first.', true); el.disabled = true; el.classList.add('busy');
    const r = await PL.run(() => PL.post('/api/customer/orders', { ...body(), confirm_destination: true })); if (r) { S.confirmed = false; PL.go('/pay/' + r.order_code, true); } else { el.disabled = false; el.classList.remove('busy'); } };

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
    const placeCard = listed ? `<div class="u-box place-sel"><div class="small mute">Delivering to a place on Pakka Local’s list</div><div class="row between"><b style="font:800 1rem var(--head)">${e(place.name)}</b><span class="u-pill">${rs(place.delivery_fee_paise)}</span></div>
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
  async function orders() { const { orders } = await PL.api('/api/customer/orders'); const act = orders.filter((o) => ACTIVE.includes(o.status)), past = orders.filter((o) => !ACTIVE.includes(o.status));
    if (!orders.length) return `<div class="u-pg">${empty('bag', 'No orders yet', 'When you order, you can track it here.', '<button class="btn mt" data-act="go" data-path="/home">Browse restaurants</button>')}</div>`;
    const head = (o) => `<div class="h">${o.restaurant_image ? img(pubImg(o.restaurant_image)) : `<span class="ph" style="display:grid;place-items:center;color:var(--brand)">${I('shop')}</span>`}<span class="txt"><b>${e(o.restaurant)}</b><small>${PL.dt(o.created_at)}</small></span>`;
    return `<div class="u-pg">${act.length ? `<div class="u-sec" style="margin-top:6px"><h2>Active orders</h2></div>${act.map((o) => `<button class="u-ocard live" data-act="go" data-path="/orders/${e(o.order_code)}">${head(o)}<span class="u-pill brand">${e(SAY[o.status]?.[0] || o.status)}</span></div><div class="bar"><i style="width:${PROG[o.status] || 8}%"></i></div><div class="ft"><span>${o.eta_at ? etaText(o) : e(SAY[o.status]?.[1] || '')}</span><b style="color:var(--brand)">Track ›</b></div></button>`).join('')}` : ''}
      ${past.length ? `<div class="u-sec"${act.length ? '' : ' style="margin-top:6px"'}><h2>Past orders</h2></div><div class="u-ogrid">${past.map((o) => `<button class="u-ocard" data-act="go" data-path="/orders/${e(o.order_code)}">${head(o)}<span class="u-pill ${o.status === 'DELIVERED' ? 'ok' : ['REJECTED', 'CANCELLED', 'PAYMENT_FAILED', 'EXPIRED'].includes(o.status) ? 'bad' : 'warn'}">${o.status === 'DELIVERED' ? I('check', 'width="13" height="13"') : ''}${e(SAY[o.status]?.[0] || o.status)}</span></div><div class="it">${e(o.summary || '')}</div><div class="ft"><span>View details</span><b>${rs(o.total_paise)}</b></div></button>`).join('')}</div>` : ''}</div>`; }

  // ---------- order tracking ----------
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
    const banner = o.status === 'CANCELLED' ? `<div class="u-note bad">${I('alert')}<span>This order was cancelled. ${e(o.rejection_reason || '')} ${o.refund ? 'Refund: ' + PL.chip(o.refund) : ''}</span></div>` : o.status === 'REJECTED' ? `<div class="u-note bad">${I('alert')}<span>The restaurant couldn’t take this order: ${e(o.rejection_reason || '')}. ${o.refund ? 'Refund: ' + PL.chip(o.refund) : ''}</span></div>` : o.status === 'PAYMENT_PENDING' ? `<div class="u-note">${I('info')}<span>Payment is pending.<br><button class="btn sm mt2" data-act="go" data-path="/pay/${e(code)}">Complete payment</button></span></div>` : o.status === 'PAYMENT_FAILED' || o.status === 'EXPIRED' ? `<div class="u-note bad">${I('alert')}<span>Payment was not completed. No order was placed.</span></div>` : '';
    const say = SAY[o.status] || [o.status, ''], prev = S.seen[code], changed = prev && prev !== o.status; S.seen[code] = o.status;
    if (changed) { PL.inbox.load(); if (o.status === 'DELIVERED') setTimeout(() => PL.celebrate({ title: 'Order delivered', sub: 'Enjoy your meal! Tap the stars below to rate it.', ms: 2400 }), 50); }
    const live = o.status === 'PICKED_UP';
    const hero = `<div class="u-thero ${o.status === 'DELIVERED' ? 'ok' : dead && o.status !== 'PAYMENT_PENDING' ? 'bad' : ''} ${changed ? 'just' : ''}">${live ? '' : scene(o.status)}<div class="st"><h1>${e(say[0])}</h1><p>${e(say[1])}</p></div>${o.eta_at && !dead && o.status !== 'DELIVERED' ? `<div class="u-eta">${I('clock')}<span class="txt"><b>${etaText(o)}</b><small>${minsTo(o.eta_at) > 1 ? `by ${PL.time(o.eta_at)}` : 'Your delivery partner is close'}</small></span></div>` : ''}</div>`;
    const map = live ? `<div class="u-map"><div id="trkmap" data-code="${e(o.order_code)}"></div><div class="lbl"><span class="chip" id="trkst">Checking…</span></div><div class="note" id="trknote"></div></div>` : '';
    return `${map}${hero}${banner}
      ${o.delivery_otp ? `<div class="u-box u-otp"><span><b style="font:800 1rem var(--head)">Delivery code</b><div class="small mute">Share it with your delivery partner at your door</div></span><span class="dg" aria-label="Delivery code ${e(o.delivery_otp)}">${String(o.delivery_otp).split('').map((d) => `<span>${e(d)}</span>`).join('')}</span></div>` : ''}
      ${o.rider ? `<div class="u-box"><div class="u-rider">${o.rider.has_photo ? `<img alt="" data-authimg="/api/files/order-rider-photo/${e(code)}">` : `<span class="av">${e((o.rider.name || 'R').trim().charAt(0).toUpperCase())}</span>`}<span class="txt"><b>${e(o.rider.name)}</b><small>${['Your delivery partner', [o.rider.vehicle_category, o.rider.vehicle_make, o.rider.vehicle_model].filter(Boolean).join(' ')].filter(Boolean).map(e).join(' · ')}</small>${o.rider.vehicle_reg_no ? `<span class="plate">${e(o.rider.vehicle_reg_no)}</span>` : ''}</span>${o.status === 'PICKED_UP' ? `<a class="u-call" href="tel:${e(o.rider.phone)}" aria-label="Call your delivery partner">${I('phone')}</a>` : ''}</div></div>` : ''}
      ${o.status === 'DELIVERED' ? `<div class="u-box"><h3>${o.rating ? 'Your rating' : 'How was your food?'}</h3><div class="u-stars">${[1, 2, 3, 4, 5].map((n) => o.rating ? `<span class="${n <= o.rating ? 'on' : ''}">${star}</span>` : `<button data-act="rate" data-code="${e(o.order_code)}" data-s="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${star}</button>`).join('')}</div></div>` : ''}
      ${dead ? '' : `<div class="u-box"><h3>${I('receipt')} Order status</h3>${tl}</div>`}
      ${ACTIVE.includes(o.status) && S.push !== 'on' ? PL.push.card('user') : ''}
      <details class="u-box u-items" ${dead ? 'open' : ''}><summary><span>${e(o.restaurant)} · ${o.items.reduce((a, i) => a + i.qty, 0)} item${o.items.reduce((a, i) => a + i.qty, 0) > 1 ? 's' : ''}</span>${I('chev')}</summary><div class="mt2">${o.items.map((i) => `<div class="kv"><span>${i.qty} × ${e(i.name)}</span><span>${rs(i.price_paise * i.qty)}</span></div>`).join('')}<div class="kv"><span class="mute">Item total</span><span>${rs(o.items_base_paise + o.markup_paise)}</span></div><div class="kv"><span class="mute">Delivery</span><span>${rs(o.delivery_paise)}</span></div>${o.surge_paise ? `<div class="kv"><span class="mute">Surge</span><span>${rs(o.surge_paise)}</span></div>` : ''}${o.tax_paise ? `<div class="kv"><span class="mute">Taxes</span><span>${rs(o.tax_paise)}</span></div>` : ''}<div class="kv" style="font-weight:800;border-top:1px solid var(--u-line);margin-top:6px;padding-top:10px"><span>Total paid</span><span>${rs(o.total_paise)}</span></div>
        <div class="small mute mt2">Deliver to: ${e(o.dest_text)}${o.instructions ? `<br>Note: ${e(o.instructions)}` : ''}</div>${o.refund ? `<div class="mt2">Refund ${PL.chip(o.refund)}</div>` : ''}<div class="small mute mt2">Order ${PL.code(o.order_code)}</div></div></details>`;
  }

  // ---------- account ----------
  async function account() { const [me, pf, my, adr] = await Promise.all([PL.api('/api/customer/me'), PL.api('/api/customer/preferences'), PL.api('/api/customer/orders'), PL.api('/api/customer/addresses').catch(() => ({ addresses: [] }))]); const u = me.user;
    const delivered = my.orders.filter((o) => o.status === 'DELIVERED').length;
    return `<div class="u-pg"><div class="u-prof"><div class="av">${e((u.name || 'P').trim().charAt(0).toUpperCase())}</div><div style="min-width:0"><h1>${e(u.name || 'Pakka Local customer')}</h1><small>${e(u.phone)}</small></div></div>
      <div class="u-tiles"><button class="u-tile" data-act="go" data-path="/orders"><span class="ic">${I('orders')}</span><b>${my.orders.length}</b><small>Orders</small></button><button class="u-tile" data-act="go" data-path="/orders"><span class="ic">${I('check')}</span><b>${delivered}</b><small>Delivered</small></button><button class="u-tile" data-act="go" data-path="/addresses"><span class="ic">${I('pin')}</span><b>${adr.addresses.length}</b><small>Addresses</small></button></div>
      <div class="u-menu"><button data-act="go" data-path="/orders"><span class="ic">${I('orders')}</span><span><b>My orders</b><small>Track active orders and see past ones</small></span><span class="chev">${I('chev')}</span></button>
        <button data-act="go" data-path="/addresses"><span class="ic">${I('pin')}</span><span><b>Delivery addresses</b><small>Saved places with their GPS location</small></span><span class="chev">${I('chev')}</span></button>
        <button data-act="inbox"><span class="ic">${I('bell')}</span><span><b>Notifications</b><small>Order updates and messages</small></span><span class="chev">${I('chev')}</span></button>
        <div><span class="ic">${I('percent')}</span><span class="grow"><b>Offers and promotions</b><small>Order updates are always sent.</small></span><button class="sw ${pf.promo_opt_in ? 'on' : ''}" data-act="promo-toggle" data-v="${pf.promo_opt_in ? 0 : 1}" aria-label="Offers and promotions"><i></i></button></div></div>
      ${PL.push.card('user')}
      <details class="u-box"><summary><span>Install Pakka Local on your phone</span>${I('chev')}</summary><p class="small mute mt2">Android: use the Install prompt in Chrome. iPhone: open in Safari, tap Share, then “Add to Home Screen”. Notifications on iPhone need iOS 16.4 or later and the installed app.</p></details>
      <button class="btn ghost block mt" data-act="logout">${I('logout')} Sign out</button></div>`; }
  PL.actions['promo-toggle'] = async (el) => { const r = await PL.run(() => PL.put('/api/customer/preferences', { promo_opt_in: el.dataset.v === '1' }), el.dataset.v === '1' ? 'Offers turned on' : 'Offers turned off'); if (r) PL.rerender(); };
  PL.actions.rate = async (el) => { const r = await PL.run(() => PL.post(`/api/customer/orders/${el.dataset.code}/rating`, { stars: Number(el.dataset.s) }), 'Thanks for rating'); if (r) PL.rerender(); };
  PL.actions.goorder = (el) => { const m = /orders\/([A-Z0-9]+)/.exec(el.dataset.link); if (m) PL.go('/orders/' + m[1]); };

  PL.start({ portal: 'user', name: 'Pakka Local', home: '/home', loginView,
    tabs: [{ path: '/home', label: 'Home', icon: 'home' }, { path: '/search', label: 'Search', icon: 'search' }, { path: '/orders', label: 'Orders', icon: 'orders' }, { path: '/me', label: 'Account', icon: 'user' }],
    onReady: () => { const tick = async () => { try { const { orders } = await PL.api('/api/customer/orders'); PL.badge('/orders', orders.filter((o) => ACTIVE.includes(o.status)).length); } catch {} }; tick(); const iv = setInterval(tick, 10000); PL.hooks.stop = [() => clearInterval(iv)]; },
    routes: { '/home': { title: 'Home', render: home, poll: 6000, after: homeAfter, skel: 'cards' }, '/search': { title: 'Search', render: search, after: () => { runSearch(); const i = PL.$('#s-q'); if (i && !S.sq) i.focus(); }, skel: 'list' },
      '/r/:id': { title: 'Menu', render: menu, poll: 8000, noNav: true, after: () => { filterMenu(); S.popId = null; }, skel: 'menu' }, '/cart': { title: 'Cart', render: cart, poll: 8000, noNav: true, after: () => { S.popId = null; }, skel: 'detail' }, '/pay/:code': { title: 'Payment', render: pay, noNav: true, skel: 'detail' },
      '/orders': { title: 'My orders', render: orders, poll: 5000 }, '/orders/:code': { title: 'Track order', render: track, poll: 2000, skel: 'detail', after: () => PL.track.customerMount() }, '/me': { title: 'Account', render: account }, '/addresses': { title: 'Delivery addresses', render: addresses }, '/places': { title: 'Find your place', render: placesView }, '/addresses/:id': { title: 'Delivery address', render: addressForm } } });
})();
