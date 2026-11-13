(function () { const m = /^\/user\/orders\/([A-Z0-9]+)/.exec(location.pathname); if (m && !location.hash) history.replaceState(null, '', '/user/#/orders/' + m[1]); })();
(function () {
  const e = PL.esc, rs = PL.rs, S = PL.state;
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  S.cart = load('pl.cart', { rid: null, rname: '', items: {} }); S.addrId = load('pl.addr', null); S.instr = ''; try { localStorage.removeItem('pl.dest'); } catch {}      // the server is the source of truth for addresses
  const saveCart = () => localStorage.setItem('pl.cart', JSON.stringify(S.cart));
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };      // only small preferences (e.g. which saved address is chosen); never coordinates
  const cartCount = () => Object.values(S.cart.items).reduce((a, i) => a + i.qty, 0);
  const cartTotal = () => Object.values(S.cart.items).reduce((a, i) => a + i.qty * i.price, 0);
  document.addEventListener('input', (ev) => { const k = ev.target.dataset?.bind; if (k) S[k] = ev.target.value; });

  // ---------- login (splash -> welcome -> OTP) ----------
  function loginView(root) {
    root.innerHTML = `<div class="splash" id="splash"><img src="/assets/logo.png" alt="Pakka Local"><div class="bar"></div></div>
      <div class="welcome"><h1>Your neighbourhood, delivered.</h1><p>Fresh food from local restaurants you won’t find on the big apps.</p><button class="btn" data-act="to-login">Login</button></div>`;
    setTimeout(() => PL.$('#splash')?.classList.add('out'), 1100); setTimeout(() => PL.$('#splash')?.remove(), 1600);
  }
  PL.actions['to-login'] = () => {
    PL.$('#root').innerHTML = `<div class="loginbox"><img class="logo" src="/assets/logo.png" alt="Pakka Local"><h1 style="text-align:center">Welcome</h1><p class="mute" style="text-align:center">Sign in with your mobile number. We’ll send a one-time code on WhatsApp.</p>
      <form data-form="otp-request"><label>Mobile number</label><input name="phone" inputmode="tel" autocomplete="tel" placeholder="98765 43210" required><button class="btn block mt" type="submit">Send code</button></form></div>`;
  };
  const normPhone = (p) => { p = p.replace(/[\s-]/g, ''); return /^\d{10}$/.test(p) ? '+91' + p : p; };
  PL.forms['otp-request'] = async (f) => { const phone = normPhone(PL.form(f).phone); const r = await PL.run(() => PL.post('/api/auth/customer/otp/request', { phone })); if (r) otpView(phone, r.resendAfterSec); };
  function otpView(phone, wait) {
    PL.$('#root').innerHTML = `<div class="loginbox"><img class="logo" src="/assets/logo.png" alt=""><h1 style="text-align:center">Enter your code</h1><p class="mute" style="text-align:center">Sent to ${e(phone)}</p>
      <form data-form="otp-verify" data-phone="${e(phone)}"><label>6-digit code</label><input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" required>
      <label>Your name (optional)</label><input name="name" autocomplete="name" maxlength="80"><button class="btn block mt" type="submit">Verify and continue</button></form>
      <button class="btn ghost block mt" id="resend" data-act="resend" data-phone="${e(phone)}" disabled>Resend in ${wait}s</button><button class="btn ghost block mt2" data-act="to-login">Change number</button></div>`;
    let t = wait; const iv = setInterval(() => { const b = PL.$('#resend'); if (!b) return clearInterval(iv); t--; if (t <= 0) { b.disabled = false; b.textContent = 'Resend code'; clearInterval(iv); } else b.textContent = `Resend in ${t}s`; }, 1000);
  }
  PL.actions.resend = async (el) => { const r = await PL.run(() => PL.post('/api/auth/customer/otp/request', { phone: el.dataset.phone }), 'Code sent'); if (r) otpView(el.dataset.phone, r.resendAfterSec); };
  PL.forms['otp-verify'] = async (f) => { const v = PL.form(f); const body = { phone: f.dataset.phone, otp: v.otp }; if (v.name?.trim()) body.name = v.name.trim();
    const r = await PL.run(() => PL.post('/api/auth/customer/otp/verify', body)); if (r) { PL.setSession(r); history.replaceState({ idx: 0 }, '', location.hash || '#'); PL.boot(); } };

  // ---------- order status wording (one place, used by home, orders and tracking) ----------
  const ACTIVE = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP'];
  const SAY = { PAYMENT_PENDING: ['Waiting for payment', 'Complete the payment to place this order.'], PLACED: ['Order placed', 'Waiting for the restaurant to accept.'], ACCEPTED: ['Accepted', 'The restaurant has your order.'],
    PREPARING: ['Being prepared', 'Your food is being cooked.'], READY: ['Ready for pickup', 'Waiting for your delivery partner to collect it.'], PICKED_UP: ['On the way', 'Your delivery partner is heading to you.'],
    DELIVERED: ['Delivered', 'Enjoy your meal!'], REJECTED: ['Not accepted', 'The restaurant could not take this order.'], CANCELLED: ['Cancelled', 'This order was cancelled.'], PAYMENT_FAILED: ['Payment failed', 'No order was placed.'], EXPIRED: ['Payment expired', 'No order was placed.'] };
  const step = (st) => ({ PLACED: 1, ACCEPTED: 2, PREPARING: 3, READY: 4, PICKED_UP: 5, DELIVERED: 6 }[st] || 0);
  const steps = (st) => `<div class="pbar" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i class="${step(st) > i || st === 'DELIVERED' ? 'on' : step(st) === i ? 'cur' : ''}"></i>`).join('')}</div>`;
  const liveCard = (o) => `<button class="card live" data-act="go" data-path="/orders/${e(o.order_code)}"><div class="row between"><div class="grow"><div class="small mute">${e(o.restaurant)}</div><h3>${e(SAY[o.status]?.[0] || o.status)}</h3></div>${o.eta_at ? `<div class="right"><div class="small mute">Arriving</div><b class="eta">${PL.time(o.eta_at)}</b></div>` : ''}</div>${steps(o.status)}<div class="row between small"><span class="mute ellip">${e(o.summary || '')}</span><span class="link">Track ›</span></div></button>`;

  // ---------- home ----------
  const noRiders = (c) => (c.ridersAvailable ? '' : `<div class="banner warn">${e(c.noRiderMessage)}</div>`);
  async function home() {
    const [c, l, r, my] = await Promise.all([PL.api('/api/public/config'), PL.api('/api/public/locations'), PL.api('/api/public/restaurants'), PL.api('/api/customer/orders').catch(() => ({ orders: [] }))]);
    const active = my.orders.filter((o) => ACTIVE.includes(o.status)), recent = my.orders.filter((o) => o.status === 'DELIVERED').slice(0, 3);
    const ad = (await PL.api('/api/customer/addresses').catch(() => ({ addresses: [] }))).addresses, cur = ad.find((x) => x.id === S.addrId) || ad.find((x) => x.is_default) || ad[0];
    return `${c.paymentsAvailable === false ? '<div class="banner warn small">Online ordering is not open yet. You can browse menus; ordering opens soon.</div>' : ''}${c.testPayments ? '<div class="banner info small">Test mode: payments are simulated. No real money moves.</div>' : ''}${noRiders(c)}
      <button class="card row" data-act="go" data-path="/addresses"><span style="color:var(--brand)">${PL.icon('pin')}</span><div class="grow"><div class="small mute">Deliver to</div><b class="ellip">${cur ? e(addrLine(cur)) : 'Add your delivery address'}</b>${cur ? '' : '<div class="small mute">Uses your phone’s GPS. Takes a minute.</div>'}</div><span class="mute">${cur ? 'Change' : 'Add'}</span></button>
      ${active.length ? `<div class="sec">On its way</div>${active.map(liveCard).join('')}` : ''}
      ${recent.length ? `<div class="sec">Recent orders</div><div class="hscroll">${recent.map((o) => `<button class="mini" data-act="go" data-path="/orders/${e(o.order_code)}"><b class="ellip">${e(o.restaurant)}</b><span class="small mute ellip">${e(o.summary || '')}</span><span class="small">${PL.dt(o.created_at)} · ${rs(o.total_paise)}</span></button>`).join('')}</div>` : ''}
      <h2 class="mt" style="margin-bottom:10px">Local restaurants</h2>
      ${r.restaurants.length ? r.restaurants.map((x) => `<div class="card rest-card ${x.is_open ? '' : 'closed'}" data-act="go" data-path="/r/${x.id}" style="cursor:pointer">${x.image_path ? PL.img(x.image_path, 'cover') : `<div class="cover" style="height:90px;background:var(--brand-l);display:grid;place-items:center;color:var(--brand)">${PL.icon('shop', 'width="34" height="34"')}</div>`}
        <div class="b"><div class="row between"><h3>${e(x.name)}</h3>${x.is_open ? '<span class="chip ok">Open</span>' : '<span class="chip bad">Closed</span>'}</div><div class="small mute">${e(x.cuisine || 'Local favourites')}${x.rating ? ` · ★ ${x.rating} (${x.rating_count})` : ''}</div><div class="small mute">${x.min_prep ? `Prep ~${x.min_prep + x.packing_buffer_min} min` : ''}${x.eta_min ? ` · Delivery in ~${x.eta_min} min` : ''}</div>${x.operating_info ? `<div class="small mute">${e(x.operating_info)}</div>` : ''}${!x.is_open && x.reopen_at ? `<div class="small mute">Reopens around ${PL.time(x.reopen_at)}</div>` : ''}</div></div>`).join('') : '<div class="empty">No restaurants are available in your area yet.</div>'}`;
  }
  // ---------- menu ----------
  async function menu({ id }) {
    const [c, m] = await Promise.all([PL.api('/api/public/config'), PL.api(`/api/public/restaurants/${id}/menu`)]); const r = m.restaurant, inCart = (i) => (S.cart.rid === r.id && S.cart.items[i]?.qty) || 0;
    const card = (i) => `<div class="card row" style="align-items:flex-start">${PL.img(i.image_path)}<div class="grow"><b>${e(i.name)}</b><div class="small mute">${e(i.description || '')}</div><div class="small mute">~${i.prep_time_min} min</div>
        <div class="price mt2">${rs(i.price_paise)}</div><div class="small mute">Restaurant ${rs(i.restaurant_price_paise)} + platform ${rs(i.price_paise - i.restaurant_price_paise)}</div></div>
        ${!i.available ? '<span class="chip">Sold out</span>' : !r.is_open ? '' : inCart(i.id) ? `<div class="qty"><button data-act="dec" data-id="${i.id}">−</button><span>${inCart(i.id)}</span><button data-act="inc" data-id="${i.id}" data-rid="${r.id}" data-rn="${e(r.name)}" data-n="${e(i.name)}" data-p="${i.price_paise}">+</button></div>` : `<button class="btn sm ghost" data-act="inc" data-id="${i.id}" data-rid="${r.id}" data-rn="${e(r.name)}" data-n="${e(i.name)}" data-p="${i.price_paise}">Add</button>`}</div>`;
    const known = new Set(m.categories.map((x) => x.id));
    const groups = [...m.categories.map((x) => [x.name, m.items.filter((i) => i.category_id === x.id)]), [m.categories.length ? 'Other' : '', m.items.filter((i) => !known.has(i.category_id))]].filter((g) => g[1].length);
    const rules = [r.min_order_paise ? `Minimum order ${rs(r.min_order_paise)}` : '', r.free_delivery_above_paise ? `Free delivery above ${rs(r.free_delivery_above_paise)}` : ''].filter(Boolean).join(' · ');
    return `${noRiders(c)}${r.is_open ? '' : '<div class="banner bad">This restaurant is currently closed. You can browse the menu but cannot order right now.</div>'}
      <div class="card flat"><h2>${e(r.name)}</h2><p class="mute small">${e(r.cuisine || '')} ${r.description ? '· ' + e(r.description) : ''}${r.rating ? ` · ★ ${r.rating} (${r.rating_count})` : ''}</p>${r.operating_info ? `<p class="small">${e(r.operating_info)}</p>` : ''}${rules ? `<p class="small" style="color:var(--brand-d)"><b>${e(rules)}</b></p>` : ''}</div>
      ${groups.map(([n, list]) => (n ? `<div class="sec">${e(n)}</div>` : '') + list.map(card).join('')).join('') || '<div class="empty">The menu is empty.</div>'}
      ${S.cart.rid === r.id && cartCount() ? `<div style="position:sticky;bottom:78px"><button class="btn block" data-act="go" data-path="/cart">View cart · ${cartCount()} item${cartCount() > 1 ? 's' : ''} · ${rs(cartTotal())}</button></div>` : ''}`;
  }
  PL.actions.inc = async (el) => { const d = el.dataset, id = d.id;
    if (d.rid && S.cart.rid !== Number(d.rid) && cartCount() && !(await PL.confirm(`Start a new cart? Your cart has items from ${S.cart.rname}.`, 'Start new'))) return;
    if (d.rid && S.cart.rid !== Number(d.rid)) S.cart = { rid: Number(d.rid), rname: d.rn, items: {} };
    const it = S.cart.items[id] || (S.cart.items[id] = { name: d.n, price: Number(d.p), qty: 0 }); if (it.qty < 20) it.qty++; saveCart(); PL.rerender(); };
  PL.actions.dec = (el) => { const it = S.cart.items[el.dataset.id]; if (!it) return; it.qty--; if (it.qty <= 0) delete S.cart.items[el.dataset.id]; if (!cartCount()) S.cart.rid = null; saveCart(); PL.rerender(); };

  // ---------- cart + checkout ----------
  const body = () => ({ restaurant_id: S.cart.rid, items: Object.entries(S.cart.items).map(([id, i]) => ({ id: Number(id), qty: i.qty })), instructions: S.instr || undefined, address_id: S.addrId || undefined });
  async function cart() {
    if (!cartCount()) return '<div class="empty">Your cart is empty.<br><button class="btn mt" data-act="go" data-path="/home">Browse restaurants</button></div>';
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
    const items = `<h2>${e(S.cart.rname)}</h2><div class="mt2">${Object.entries(S.cart.items).map(([id, i]) => `<div class="card row"><div class="grow"><b>${e(i.name)}</b><div class="small mute">${rs(i.price)} each</div></div><div class="qty"><button data-act="dec" data-id="${id}">−</button><span>${i.qty}</span><button data-act="inc" data-id="${id}">+</button></div></div>`).join('')}</div>`;
    const tabs = `<div class="method-tabs" role="tablist">
      <button role="tab" aria-selected="${S.method === 'list'}" class="${S.method === 'list' ? 'on' : ''}" data-act="method" data-m="list">${PL.icon('shop', 'width="20" height="20"')}<span><b>Select PG / hostel / college</b><small>From Pakka Local’s list</small></span></button>
      <button role="tab" aria-selected="${S.method === 'gps'}" class="${S.method === 'gps' ? 'on' : ''}" data-act="method" data-m="gps">${PL.icon('pin', 'width="20" height="20"')}<span><b>Use my GPS location</b><small>Not on the list</small></span></button></div>`;
    const card = (x) => { const pl = placeOf(x); return `<label class="card addr-pick ${sel && x.id === sel.id ? 'on' : ''}"><input type="radio" name="addr" value="${x.id}" ${sel && x.id === sel.id ? 'checked' : ''}><div class="grow"><div class="row between"><b>${e(x.kind === 'listed' ? (pl?.name || x.place_name) : LBL[x.label])}${x.is_default ? ' <span class="chip">Default</span>' : ''}</b>
      <span class="fee-tag">${x.kind === 'listed' ? (pl ? rs(pl.delivery_fee_paise) : 'Unavailable') : rs(gpsFee)}</span></div><div class="small">${e(addrLine(x))}</div>${x.entrance || x.landmark ? `<div class="small mute">${e([x.entrance, x.landmark].filter(Boolean).join(' · '))}</div>` : ''}
      <div class="small mute">${x.lat != null ? `GPS ±${Math.round(x.accuracy_m)} m` : 'Uses the place’s map point'}</div></div></label>`; };
    const body2 = S.method === 'list'
      ? `${places.length ? '' : '<div class="banner warn">There are no places on the list yet. Use your GPS location instead.</div>'}${mine.map(card).join('')}
        ${places.length ? `<button class="btn ${mine.length ? 'ghost' : ''} block" data-act="go" data-path="/places?back=cart">${PL.icon('search', 'width="18" height="18"')} ${mine.length ? 'Choose another place from the list' : 'Find my PG, hostel or college'}</button>` : ''}
        <p class="small mute mt2" style="text-align:center">Can’t find your place? <a href="#" data-act="method" data-m="gps">Use your GPS location instead</a>.</p>`
      : `<div class="banner info small">Delivery charge for places not on the list: <b>${rs(gpsFee)}</b></div>${mine.map(card).join('')}
        <div class="row wrap"><button class="btn ${mine.length ? 'ghost' : ''} sm grow" data-act="go" data-path="/addresses/new?back=cart">${PL.icon('pin', 'width="16" height="16"')} ${mine.length ? '+ New GPS address' : 'Add address with my GPS location'}</button>${sel ? `<button class="btn ghost sm grow" data-act="go" data-path="/addresses/${sel.id}?back=cart&gps=1">I’ve moved: update GPS</button>` : ''}</div>`;
    const confirm = sel ? `<label class="check confirm-dest"><input type="checkbox" id="confirm-dest" ${S.confirmed ? 'checked' : ''}> <span>${sel.kind === 'listed' ? `Deliver to <b>${e(addrLine(sel))}</b>. This is the place I am ordering for.` : `Deliver to this point. The location was captured ${PL.dt(sel.captured_at)} and I am ordering for that place.`}</span></label>` : '';
    return `${items}<div class="sec">Deliver to</div>${tabs}${body2}${confirm}
      <div class="sec">Note for this order (optional)</div><textarea data-bind="instr" maxlength="300" placeholder="Anything extra for this order only">${e(S.instr)}</textarea>
      ${err ? `<div class="banner ${err.code === 'NO_RIDERS' ? 'warn' : 'bad'} mt">${e(err.message)}${err.code === 'NO_MAP_POINT' && sel ? `<br><button class="btn sm mt2" data-act="go" data-path="/addresses/${sel.id}?back=cart&gps=1">Add my GPS location</button>` : ''}</div>` : ''}
      ${q ? `<div class="sec">Bill details</div><div class="card"><div class="kv"><span>Item total (restaurant price)</span><span>${rs(q.items_base_paise)}</span></div><div class="kv"><span>Platform markup</span><span>${rs(q.markup_paise)}</span></div><div class="kv"><span>Delivery charge<div class="small mute">${q.delivery_type === 'listed' ? e(q.delivery_location) : 'Fixed charge for places not on the list'}${q.delivery_paise < q.delivery_fee_before_offers_paise ? ' · free above the restaurant’s minimum' : ''}</div></span><span>${rs(q.delivery_paise)}</span></div>${q.surge_paise ? `<div class="kv"><span>Surge charge</span><span>${rs(q.surge_paise)}</span></div>` : ''}${q.tax_paise ? `<div class="kv"><span>Taxes</span><span>${rs(q.tax_paise)}</span></div>` : ''}<div class="kv tot"><span>Total</span><span class="num">${rs(q.total_paise)}</span></div><div class="small mute">Estimated delivery in ~${q.prep_min + 8 + q.delivery_min} min</div></div>` : ''}
      <button class="btn block mt" data-act="place" ${q && !err && S.confirmed ? '' : 'disabled'}>${!sel ? 'Choose where to deliver' : !S.confirmed ? 'Confirm the delivery point to continue' : q ? `Pay ${rs(q.total_paise)}` : 'Not available'}</button><p class="small mute mt2" style="text-align:center">Online payment only. Cash on delivery is not available.</p>`;
  }
  PL.actions.method = (el, ev) => { ev?.preventDefault?.(); if (S.method === el.dataset.m) return; S.method = el.dataset.m; S.confirmed = false; PL.rerender(); };

  // searchable list of Pakka Local's places (active only, as returned by the server)
  async function placesView() { const qs = new URLSearchParams(location.hash.split('?')[1] || ''); const { locations: places } = await PL.api('/api/public/locations');
    return `<h2>Find your place</h2><p class="small mute mt2">PGs, hostels and colleges Pakka Local delivers to, with each place’s delivery charge.</p>
      <input id="place-q" type="search" placeholder="Search by name or area" autocomplete="off" aria-label="Search places" style="margin:10px 0">
      <div id="place-list">${places.map((l) => `<button class="card place-card" data-act="place-pick" data-id="${l.id}" data-s="${e([l.name, l.area, l.address, l.kind].join(' ').toLowerCase())}"><div class="row between"><b>${e(l.name)}</b><span class="fee-tag">${rs(l.delivery_fee_paise)}</span></div>
        <div class="small">${l.kind ? `<span class="chip">${e(l.kind)}</span> ` : ''}${e([l.area, l.address].filter(Boolean).join(' · '))}</div></button>`).join('') || '<div class="empty">No places on the list yet.</div>'}</div>
      <div id="place-none" class="empty hide">No place matches. Check the spelling, or <a href="#" data-act="go" data-path="/addresses/new?back=${e(qs.get('back') || 'cart')}">use your GPS location</a>.</div>`; }
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
  PL.actions.place = async (el) => { if (!S.confirmed) return PL.toast('Confirm the delivery point first.', true); el.disabled = true;
    const r = await PL.run(() => PL.post('/api/customer/orders', { ...body(), confirm_destination: true })); if (r) { S.confirmed = false; PL.go('/pay/' + r.order_code, true); } else el.disabled = false; };

  // ---------- delivery addresses (GPS-first) ----------
  const LBL = { home: 'Home', hostel: 'Hostel', pg: 'PG', college: 'College', other: 'Other' };
  const addrLine = (a) => [a.place_name, a.building, a.block && `Block ${a.block}`, a.floor && `Floor ${a.floor}`, a.room && `Room ${a.room}`].filter(Boolean).join(', ') || 'Saved location';
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
    return `<h2>Delivery addresses</h2>${ad.length < max ? `<div class="row wrap mt2"><button class="btn sm grow" data-act="go" data-path="/places?back=addresses">${PL.icon('search', 'width="16" height="16"')} Choose from the list</button><button class="btn ghost sm grow" data-act="go" data-path="/addresses/new">${PL.icon('pin', 'width="16" height="16"')} Use my GPS location</button></div>` : ''}
      <p class="small mute mt2">Pick your PG, hostel or college from Pakka Local’s list, or save a place that isn’t listed with your phone’s GPS.</p>
      ${ad.map((a) => `<div class="card"><div class="row between"><b>${e(a.kind === 'listed' ? a.place_name : LBL[a.label])}${a.is_default ? ' <span class="chip ok">Default</span>' : ''}</b><span class="chip">${a.kind === 'listed' ? 'From the list' : 'GPS'}</span></div><div class="small mute">${a.lat != null ? `GPS ±${Math.round(a.accuracy_m)} m · ${PL.dt(a.captured_at)}` : 'Uses the place’s map point'}</div>
        <div class="mt2">${e(addrLine(a))}</div>${[a.entrance && 'Gate: ' + a.entrance, a.landmark && 'Near ' + a.landmark].filter(Boolean).map((x) => `<div class="small mute">${e(x)}</div>`).join('')}${a.instructions ? `<div class="small mute">“${e(a.instructions)}”</div>` : ''}
        <div class="row wrap mt2"><button class="btn ghost sm" data-act="go" data-path="/addresses/${a.id}">Edit</button>${a.is_default ? '' : `<button class="btn ghost sm" data-act="addr-default" data-id="${a.id}">Make default</button>`}<button class="btn danger sm" data-act="addr-del" data-id="${a.id}">Remove</button></div></div>`).join('') || `<div class="empty">${PL.icon('pin', 'width="40" height="40"')}<br><b>No saved addresses yet</b><br><span class="small">Add one while standing at your PG, hostel or room.</span><br><button class="btn mt" data-act="go" data-path="/addresses/new">Add delivery address</button></div>`}`; }
  PL.actions['addr-default'] = async (el) => { const r = await PL.run(() => PL.put('/api/customer/addresses/' + el.dataset.id, { make_default: true }), 'Default address updated'); if (r) PL.rerender(); };
  PL.actions['addr-del'] = async (el) => { if (!(await PL.confirm('Remove this address? Orders already placed keep their delivery details.', 'Remove'))) return; const r = await PL.run(() => PL.api('/api/customer/addresses/' + el.dataset.id, { method: 'DELETE' }), 'Address removed'); if (r) PL.rerender(); };

  // add / edit form. The GPS reading lives only in this screen's memory until it is saved to the server.
  let F = null;
  async function addressForm({ id }) {
    const qs = new URLSearchParams(location.hash.split('?')[1] || ''), isNew = id === 'new';
    const [{ addresses: ad, policy }, { locations }] = await Promise.all([PL.api('/api/customer/addresses'), PL.api('/api/public/locations')]);
    if (!F || F.id !== id) { const a = isNew ? {} : ad.find((x) => String(x.id) === String(id)); if (!a) return '<div class="empty">Address not found.<br><button class="btn mt" data-act="go" data-path="/addresses">Back</button></div>';
      const kind = a.kind || (qs.get('kind') === 'listed' ? 'listed' : 'gps');
      F = { id, kind, url: location.hash.slice(1), back: qs.get('back'), policy, a: { label: 'pg', ...a, ...(kind === 'listed' && qs.get('place') ? { delivery_location_id: Number(qs.get('place')) } : {}) }, gps: null,
        state: kind === 'listed' ? (a.lat != null && !qs.get('gps') ? 'kept' : 'need') : isNew || qs.get('gps') ? 'need' : 'kept', err: null, here: false, ack: false, open: !!qs.get('gps') }; }
    const a = F.a, p = F.policy, g = F.gps, poor = g && p.warn_m && g.accuracy_m > p.warn_m, listed = F.kind === 'listed', place = listed && locations.find((l) => l.id === a.delivery_location_id);
    if (listed && !place) return `<div class="empty">That place is not on the list any more.<br><button class="btn mt" data-act="go" data-path="/places?for=form">Choose a place</button></div>`;
    const gpsBox = `<div class="gps-card ${F.state}">
      <p class="gps-hint"><b>Please stand at your actual delivery location before capturing your GPS location. Our delivery partner will use these coordinates to reach you.</b></p>
      ${F.state === 'kept' ? `<div class="gps-ok">${PL.icon('check', 'width="20" height="20"')}<div><b>Saved GPS location</b><div class="small">Accuracy about ±${Math.round(a.accuracy_m)} m · captured ${PL.dt(a.captured_at)}</div></div></div><button class="btn ghost block mt2" data-act="gps-go">${PL.icon('pin', 'width="18" height="18"')} Capture again (I’m here now)</button>` : ''}
      ${F.state === 'need' ? `<button class="btn gps-btn block" data-act="gps-go">${PL.icon('pin', 'width="22" height="22"')} USE MY CURRENT LOCATION</button><p class="small mute mt2">Your phone will ask for location permission. Allow it.</p>` : ''}
      ${F.state === 'busy' ? `<div class="gps-busy"><span class="spin"></span><b>Finding your location…</b><div class="small mute">This can take up to ${p.timeout_sec} seconds. Stay where you are.</div></div>` : ''}
      ${F.state === 'error' ? `<div class="banner bad" style="margin:0"><b>${e(F.err.title)}</b><div class="small" style="font-weight:500">${e(F.err.text)}</div></div><button class="btn block mt2" data-act="gps-go">Try again</button>` : ''}
      ${F.state === 'got' ? `<div class="gps-ok">${PL.icon('check', 'width="20" height="20"')}<div><b>Location captured</b><div class="small">Accuracy about ±${Math.round(g.accuracy_m)} m · ${PL.time(g.captured_at)}</div><div class="small mute">${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}</div></div></div>
        ${poor ? `<div class="banner warn mt2" style="margin-bottom:0">This reading is only accurate to about ${Math.round(g.accuracy_m)} m (Pakka Local’s limit is ${p.warn_m} m). Step outside or near a window and try again, or use it anyway.</div><label class="check"><input type="checkbox" id="gps-ack" ${F.ack ? 'checked' : ''}> Use this location anyway (about ±${Math.round(g.accuracy_m)} m)</label>` : g.accuracy_m > 50 ? '<p class="small mute mt2">The accuracy number is quite large. If you can, step outside or near a window and capture again.</p>' : ''}
        <label class="check"><input type="checkbox" id="gps-here" ${F.here ? 'checked' : ''}> I am standing at my delivery location right now.</label>
        <button class="btn ghost sm mt2" data-act="gps-go">Capture again</button>` : ''}</div>`;
    const inp = (k, l, attrs = '') => `<label for="a-${k}">${l}</label><input id="a-${k}" name="${k}" value="${e(a[k] ?? '')}" ${attrs}>`;
    const placeCard = listed ? `<div class="card place-sel"><div class="small mute">Delivering to a place on Pakka Local’s list</div><div class="row between"><b>${e(place.name)}</b><span class="fee-tag">${rs(place.delivery_fee_paise)}</span></div>
      <div class="small">${e([place.kind, place.area, place.address].filter(Boolean).join(' · '))}</div><button class="btn ghost sm mt2" data-act="form-change-place">Change place</button></div>` : '';
    const gpsPart = listed ? `<details class="card gps-opt" ${F.open || F.state === 'got' || F.state === 'busy' || F.state === 'error' ? 'open' : ''}><summary><b>Add my exact GPS point (optional)</b><div class="small mute">${a.lat != null ? `Saved: ±${Math.round(a.accuracy_m)} m` : 'Helps the delivery partner find your exact building. Without it, the place’s map point is used.'}</div></summary>${gpsBox}</details>` : gpsBox;
    return `<h2>${isNew ? 'Add delivery address' : 'Edit delivery address'}</h2>${placeCard}${gpsPart}
      <form data-form="addr" class="card mt" novalidate><label>This place is a</label><div class="seg wrap">${Object.entries(LBL).map(([k, l]) => `<label class="${a.label === k ? 'on' : ''}"><input type="radio" name="label" value="${k}" ${a.label === k ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        ${listed ? '' : inp('place_name', 'PG, hostel or college name', 'maxlength="80" placeholder="e.g. the name on the board outside"')}
        ${inp('building', 'Building or hostel block name', 'maxlength="80"')}
        <div class="grid g3"><div>${inp('block', 'Block / tower', 'maxlength="30"')}</div><div>${inp('floor', 'Floor', 'maxlength="20" inputmode="numeric"')}</div><div>${inp('room', 'Room no.', 'maxlength="30"')}</div></div>
        ${inp('entrance', 'Main gate or entrance', 'maxlength="120" placeholder="e.g. back gate near the parking"')}
        ${inp('landmark', 'Nearby landmark', 'maxlength="120"')}
        <label for="a-instructions">Delivery instructions</label><textarea id="a-instructions" name="instructions" maxlength="300" placeholder="e.g. call from the gate, security won’t let riders in">${e(a.instructions || '')}</textarea>
        <p class="small mute mt2">${listed ? 'Required: a room number, gate or landmark.' : 'Required: the PG/hostel/college or building name, and a room number, gate or landmark.'}</p>
        ${isNew ? `<label class="check"><input type="checkbox" name="make_default" ${ad.length ? '' : 'checked'}> Make this my default address</label>` : ''}
        <button class="btn block mt" type="submit">Save address</button></form>`; }
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
    if (o.status !== 'PAYMENT_PENDING') return `<div class="empty">This order is already ${e(o.status.toLowerCase().replace('_', ' '))}.<br><button class="btn mt" data-act="go" data-path="/orders/${e(code)}">View order</button></div>`;
    return `<div class="card"><h2>Complete payment</h2><p class="mute">Order ${e(code)}</p><div class="kv tot"><span>Amount</span><span class="num">${rs(o.total_paise)}</span></div></div>
      ${c.testPayments ? `<div class="banner info">Test mode. This screen simulates the payment gateway. When PhonePe is connected, you’ll be redirected to PhonePe instead.</div><button class="btn green block" data-act="sbx" data-code="${e(code)}" data-ok="success">Simulate successful payment</button><button class="btn danger block mt2" data-act="sbx" data-code="${e(code)}" data-ok="fail">Simulate failed payment</button>` : '<div class="banner warn">Online payments are not available yet.</div>'}`;
  }
  PL.actions.sbx = async (el) => { const ok = el.dataset.ok === 'success'; const r = await PL.run(() => PL.post(`/api/customer/payments/sandbox/${el.dataset.code}/complete`, { outcome: ok ? 'success' : 'fail' }));
    if (!r) return; if (ok) { S.cart = { rid: null, rname: '', items: {} }; saveCart(); S.instr = ''; PL.toast('Payment confirmed'); PL.go('/orders/' + el.dataset.code, true); } else { PL.toast('Payment failed. Your cart is saved.', true); PL.go('/cart', true); } };

  // ---------- orders ----------
  async function orders() { const { orders } = await PL.api('/api/customer/orders'); const act = orders.filter((o) => ACTIVE.includes(o.status)), past = orders.filter((o) => !ACTIVE.includes(o.status));
    if (!orders.length) return `<div class="empty">${PL.icon('orders', 'width="40" height="40"')}<br><b>No orders yet</b><br><span class="small">Your orders will appear here.</span><br><button class="btn mt" data-act="go" data-path="/home">Browse restaurants</button></div>`;
    return `${act.length ? `<div class="sec">Active</div>${act.map(liveCard).join('')}` : ''}${past.length ? `<div class="sec">Past orders</div>${past.map((o) => `<button class="card order-row" data-act="go" data-path="/orders/${o.order_code}"><div class="row between"><b>${e(o.restaurant)}</b>${PL.chip(o.status)}</div><div class="small mute ellip">${e(o.summary || '')}</div><div class="row between small mute"><span>${PL.dt(o.created_at)}</span><b style="color:var(--ink)">${rs(o.total_paise)}</b></div></button>`).join('')}` : ''}`; }
  const STAGES = [['PAYMENT_SUCCESS', 'Order Placed'], ['RESTAURANT_ACCEPTED', 'Restaurant Accepted'], ['PREPARING_STARTED', 'Preparing'], ['FOOD_READY', 'Ready for Pickup'], ['PICKED_UP', 'Rider Picked Up'], ['DELIVERED', 'Delivered']];
  const IDX = { PLACED: 0, ACCEPTED: 1, PREPARING: 2, READY: 3, PICKED_UP: 4, DELIVERED: 5 };
  async function track({ code }) {
    const o = await PL.api('/api/customer/orders/' + code); const at = Object.fromEntries(o.events.map((x) => [x.event_type, x.created_at])); const cur = IDX[o.status] ?? -1; const dead = ['REJECTED', 'CANCELLED', 'PAYMENT_FAILED', 'EXPIRED', 'PAYMENT_PENDING'].includes(o.status);
    const tl = dead ? '' : `<ul class="tl">${STAGES.map(([ev, label], i) => { const done = i < cur || (i === cur && o.status === 'DELIVERED'); return `<li class="${done ? 'done' : i === cur ? 'cur' : ''}"><span class="dot">${done ? PL.icon('check') : ''}</span><b>${label}</b><span class="small mute">${at[ev] ? PL.time(at[ev]) : done ? '' : i === cur ? 'In progress' : ''}</span></li>`; }).join('')}</ul>`;
    const banner = o.status === 'CANCELLED' ? `<div class="banner bad">This order was cancelled. ${e(o.rejection_reason || '')} ${o.refund ? 'Refund: ' : ''}${o.refund ? PL.chip(o.refund) : ''}</div>` : o.status === 'REJECTED' ? `<div class="banner bad">The restaurant couldn’t take this order: ${e(o.rejection_reason || '')}. ${o.refund ? 'Refund: ' + PL.chip(o.refund) : ''}</div>` : o.status === 'PAYMENT_PENDING' ? `<div class="banner warn">Payment is pending.<br><button class="btn sm mt2" data-act="go" data-path="/pay/${e(code)}">Complete payment</button></div>` : o.status === 'PAYMENT_FAILED' || o.status === 'EXPIRED' ? '<div class="banner bad">Payment was not completed. No order was placed.</div>' : '';
    const say = SAY[o.status] || [o.status, ''];
    return `<div class="card hero st-${e(o.status)}"><div class="row between"><div class="grow"><div class="small">${e(o.restaurant)}</div><h2>${e(say[0])}</h2><div class="small">${e(say[1])}</div></div>${o.eta_at && !dead && o.status !== 'DELIVERED' ? `<div class="eta-box"><div class="small">Arriving by</div><b>${PL.time(o.eta_at)}</b></div>` : ''}</div>${dead ? '' : steps(o.status)}<div class="small mt2 row between"><span>Order ${PL.code(o.order_code)}</span></div></div>${banner}
      ${o.delivery_otp ? `<div class="card"><div class="small mute">Share this code with your delivery partner at your door</div><div class="otp mt2">${e(o.delivery_otp)}</div></div>` : ''}
      ${PL.track.customerCard(o)}
      ${o.rider ? `<div class="card"><div class="sec" style="margin-top:0">Your delivery partner</div><div class="row"><img class="thumb" style="border-radius:50%" alt="" data-authimg="/api/files/order-rider-photo/${e(code)}"><div class="grow"><b>${e(o.rider.name)}</b><div class="small mute">${e(o.rider.vehicle_category || '')} ${e([o.rider.vehicle_make, o.rider.vehicle_model].filter(Boolean).join(' '))}</div><div class="code" style="font-size:1.1rem">${e(o.rider.vehicle_reg_no || '')}</div></div><a class="btn sm" href="tel:${e(o.rider.phone)}">${PL.icon('phone', 'width="18" height="18"')} Call</a></div></div>` : ''}
      ${o.status === 'DELIVERED' ? `<div class="card"><h3>${o.rating ? 'Your rating' : 'How was your order?'}</h3><div class="row mt2" style="gap:4px">${[1, 2, 3, 4, 5].map((n) => o.rating ? `<span style="font-size:1.8rem;color:${n <= o.rating ? '#e9a100' : '#d8d2c6'}">★</span>` : `<button class="iconbtn" style="font-size:1.8rem;color:#d8d2c6;width:48px;height:48px" data-act="rate" data-code="${e(o.order_code)}" data-s="${n}" aria-label="${n} stars">★</button>`).join('')}</div></div>` : ''}
      ${dead ? '' : `<div class="card"><h3 style="margin-bottom:12px">Order progress</h3>${tl}</div>`}
      ${ACTIVE.includes(o.status) && S.push !== 'on' ? PL.push.card('user') : ''}<div class="card"><h3>Items</h3>${o.items.map((i) => `<div class="kv"><span>${i.qty} × ${e(i.name)}</span><span>${rs(i.price_paise * i.qty)}</span></div>`).join('')}<div class="kv"><span class="mute">Item total</span><span>${rs(o.items_base_paise + o.markup_paise)}</span></div><div class="kv"><span class="mute">Delivery</span><span>${rs(o.delivery_paise)}</span></div>${o.surge_paise ? `<div class="kv"><span class="mute">Surge</span><span>${rs(o.surge_paise)}</span></div>` : ''}${o.tax_paise ? `<div class="kv"><span class="mute">Taxes</span><span>${rs(o.tax_paise)}</span></div>` : ''}<div class="kv tot"><span>Total paid</span><span>${rs(o.total_paise)}</span></div><div class="small mute mt2">Deliver to: ${e(o.dest_text)}${o.instructions ? `<br>Note: ${e(o.instructions)}` : ''}</div>${o.refund ? `<div class="mt2">Refund ${PL.chip(o.refund)}</div>` : ''}</div>`;
  }

  async function account() { const [me, pf, my] = await Promise.all([PL.api('/api/customer/me'), PL.api('/api/customer/preferences'), PL.api('/api/customer/orders')]); const u = me.user;
    const delivered = my.orders.filter((o) => o.status === 'DELIVERED').length;
    return `<div class="card profile"><div class="avatar">${e((u.name || 'P').trim().charAt(0).toUpperCase())}</div><div class="grow"><h2>${e(u.name || 'Pakka Local customer')}</h2><div class="mute">${e(u.phone)}</div></div></div>
      <div class="stats"><div class="stat"><div class="v">${my.orders.length}</div><div class="l">Orders</div></div><div class="stat"><div class="v">${delivered}</div><div class="l">Delivered</div></div></div>
      <div class="sec">Settings</div><div class="card list">
        <button class="li" data-act="go" data-path="/orders"><span>${PL.icon('orders')}</span><b class="grow">My orders</b><span class="mute">›</span></button>
        <div class="li"><span>${PL.icon('bell')}</span><div class="grow"><b>Offers and promotions</b><div class="small mute">Order updates are always sent.</div></div><button class="sw ${pf.promo_opt_in ? 'on' : ''}" data-act="promo-toggle" data-v="${pf.promo_opt_in ? 0 : 1}" aria-label="Offers and promotions"><i></i></button></div>
        <button class="li" data-act="go" data-path="/addresses"><span>${PL.icon('pin')}</span><div class="grow"><b>Delivery addresses</b><div class="small mute">Saved places with their GPS location</div></div><span class="mute">›</span></button></div>
      ${PL.push.card('user')}
      <details class="card"><summary><b>Install Pakka Local on your phone</b></summary><p class="small mute mt2">Android: use the Install prompt in Chrome. iPhone: open in Safari, tap Share, then “Add to Home Screen”. Notifications on iPhone need iOS 16.4 or later and the installed app.</p></details>
      <button class="btn ghost block mt" data-act="logout">Sign out</button>`; }
  PL.actions['promo-toggle'] = async (el) => { const r = await PL.run(() => PL.put('/api/customer/preferences', { promo_opt_in: el.dataset.v === '1' }), el.dataset.v === '1' ? 'Offers turned on' : 'Offers turned off'); if (r) PL.rerender(); };
  PL.actions.rate = async (el) => { const r = await PL.run(() => PL.post(`/api/customer/orders/${el.dataset.code}/rating`, { stars: Number(el.dataset.s) }), 'Thanks for rating'); if (r) PL.rerender(); };
  PL.actions.goorder = (el) => { const m = /orders\/([A-Z0-9]+)/.exec(el.dataset.link); if (m) PL.go('/orders/' + m[1]); };

  PL.start({ portal: 'user', name: 'Pakka Local', home: '/home', loginView,
    tabs: [{ path: '/home', label: 'Home', icon: 'home' }, { path: '/orders', label: 'Orders', icon: 'orders' }, { path: '/me', label: 'Account', icon: 'user' }],
    onReady: () => { const tick = async () => { try { const { orders } = await PL.api('/api/customer/orders'); PL.badge('/orders', orders.filter((o) => ACTIVE.includes(o.status)).length); } catch {} }; tick(); const iv = setInterval(tick, 10000); PL.hooks.stop = [() => clearInterval(iv)]; },
    routes: { '/home': { title: 'Pakka Local', render: home, poll: 6000 }, '/r/:id': { title: 'Menu', render: menu, poll: 8000 }, '/cart': { title: 'Your cart', render: cart, poll: 8000 }, '/pay/:code': { title: 'Payment', render: pay, noNav: true },
      '/orders': { title: 'My orders', render: orders, poll: 5000 }, '/orders/:code': { title: 'Order', render: track, poll: 2000, after: () => PL.track.customerMount() }, '/me': { title: 'Account', render: account }, '/addresses': { title: 'Delivery addresses', render: addresses }, '/places': { title: 'Find your place', render: placesView }, '/addresses/:id': { title: 'Delivery address', render: addressForm } } });
})();
