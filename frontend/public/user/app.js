(function () { const m = /^\/user\/orders\/([A-Z0-9]+)/.exec(location.pathname); if (m && !location.hash) history.replaceState(null, '', '/user/#/orders/' + m[1]); })();
(function () {
  const e = PL.esc, rs = PL.rs, S = PL.state;
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  S.cart = load('pl.cart', { rid: null, rname: '', items: {} }); S.dest = load('pl.dest', null); S.instr = '';
  const saveCart = () => localStorage.setItem('pl.cart', JSON.stringify(S.cart));
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
    const d = S.dest, loc = d && d.location_id && l.locations.find((x) => x.id === d.location_id);
    return `${c.paymentsAvailable === false ? '<div class="banner warn small">Online ordering is not open yet. You can browse menus; ordering opens soon.</div>' : ''}${c.testPayments ? '<div class="banner info small">Test mode: payments are simulated. No real money moves.</div>' : ''}${noRiders(c)}
      <button class="card row" style="width:100%;text-align:left;cursor:pointer" data-act="pick-loc"><span style="color:var(--brand)">${PL.icon('pin')}</span><div class="grow"><div class="small mute">Deliver to</div><b class="ellip">${d ? (d.gps ? 'Current location (GPS)' : loc ? e(loc.name) : 'Choose a location') : 'Choose a location'}</b></div><span class="mute">Change</span></button>
      ${active.length ? `<div class="sec">On its way</div>${active.map(liveCard).join('')}` : ''}
      ${recent.length ? `<div class="sec">Recent orders</div><div class="hscroll">${recent.map((o) => `<button class="mini" data-act="go" data-path="/orders/${e(o.order_code)}"><b class="ellip">${e(o.restaurant)}</b><span class="small mute ellip">${e(o.summary || '')}</span><span class="small">${PL.dt(o.created_at)} · ${rs(o.total_paise)}</span></button>`).join('')}</div>` : ''}
      <h2 class="mt" style="margin-bottom:10px">Local restaurants</h2>
      ${r.restaurants.length ? r.restaurants.map((x) => `<div class="card rest-card ${x.is_open ? '' : 'closed'}" data-act="go" data-path="/r/${x.id}" style="cursor:pointer">${x.image_path ? PL.img(x.image_path, 'cover') : `<div class="cover" style="height:90px;background:var(--brand-l);display:grid;place-items:center;color:var(--brand)">${PL.icon('shop', 'width="34" height="34"')}</div>`}
        <div class="b"><div class="row between"><h3>${e(x.name)}</h3>${x.is_open ? '<span class="chip ok">Open</span>' : '<span class="chip bad">Closed</span>'}</div><div class="small mute">${e(x.cuisine || 'Local favourites')}${x.rating ? ` · ★ ${x.rating} (${x.rating_count})` : ''}</div><div class="small mute">${x.min_prep ? `Prep ~${x.min_prep + x.packing_buffer_min} min` : ''}${x.eta_min ? ` · Delivery in ~${x.eta_min} min` : ''}</div>${x.operating_info ? `<div class="small mute">${e(x.operating_info)}</div>` : ''}${!x.is_open && x.reopen_at ? `<div class="small mute">Reopens around ${PL.time(x.reopen_at)}</div>` : ''}</div></div>`).join('') : '<div class="empty">No restaurants are available in your area yet.</div>'}`;
  }
  PL.actions['pick-loc'] = async () => { const { locations } = await PL.api('/api/public/locations');
    PL.modal(`<h3>Delivery location</h3><div class="mt2">${locations.map((l) => `<button class="card row" style="width:100%;text-align:left;cursor:pointer" data-act="set-loc" data-id="${l.id}"><div class="grow"><b>${e(l.name)}</b><div class="small mute">${e(l.address)}</div></div><span class="price">${PL.rs(l.delivery_fee_paise)}</span></button>`).join('') || '<p class="mute">No saved locations yet.</p>'}</div>
      <div class="card flat"><b>Not listed?</b><p class="small mute">Share your current location and we’ll deliver there.</p><button class="btn ghost block" data-act="gps">${PL.icon('pin', 'width="18" height="18"')} Use my current location</button></div>`); };
  PL.actions['set-loc'] = (el) => { S.dest = { location_id: Number(el.dataset.id) }; localStorage.setItem('pl.dest', JSON.stringify(S.dest)); PL.closeModal(); setTimeout(PL.rerender, 60); };
  PL.actions.gps = () => { if (!navigator.geolocation) return PL.toast('Location is not supported on this device.', true);
    PL.toast('Fetching your location…'); navigator.geolocation.getCurrentPosition((p) => { S.dest = { gps: true, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }; localStorage.setItem('pl.dest', JSON.stringify(S.dest)); PL.closeModal(); setTimeout(PL.rerender, 60); PL.toast('Location captured'); },
      () => PL.toast('Could not get your location. Allow location access and try again.', true), { enableHighAccuracy: true, timeout: 12000 }); };

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
  const body = () => ({ restaurant_id: S.cart.rid, items: Object.entries(S.cart.items).map(([id, i]) => ({ id: Number(id), qty: i.qty })), instructions: S.instr || undefined,
    ...(S.dest?.gps ? { lat: S.dest.lat, lng: S.dest.lng, dest_text: 'Current location (GPS)' } : S.dest?.location_id ? { location_id: S.dest.location_id } : {}) });
  async function cart() {
    if (!cartCount()) return '<div class="empty">Your cart is empty.<br><button class="btn mt" data-act="go" data-path="/home">Browse restaurants</button></div>';
    const locs = (await PL.api('/api/public/locations')).locations; let q = null, err = null;
    if (S.dest) { try { q = await PL.post('/api/customer/quote', body()); } catch (x) { err = x; } } else { try { await PL.post('/api/customer/quote', { ...body(), location_id: locs[0]?.id ?? 0 }); } catch (x) { if (x.code === 'NO_RIDERS') err = x; } }
    const blocked = err && err.code === 'NO_RIDERS';
    return `<h2>${e(S.cart.rname)}</h2><div class="mt2">${Object.entries(S.cart.items).map(([id, i]) => `<div class="card row"><div class="grow"><b>${e(i.name)}</b><div class="small mute">${rs(i.price)} each</div></div><div class="qty"><button data-act="dec" data-id="${id}">−</button><span>${i.qty}</span><button data-act="inc" data-id="${id}">+</button></div></div>`).join('')}</div>
      <div class="sec">Delivery location</div><div class="card"><select data-act-change="loc" id="locsel"><option value="">Choose hostel, PG or apartment</option>${locs.map((l) => `<option value="${l.id}" ${S.dest?.location_id === l.id ? 'selected' : ''}>${e(l.name)} · ${rs(l.delivery_fee_paise)}</option>`).join('')}${S.dest?.gps ? '<option value="gps" selected>Current location (GPS)</option>' : ''}</select>
      <button class="btn ghost block mt2" data-act="gps">${PL.icon('pin', 'width="18" height="18"')} ${S.dest?.gps ? 'Update my GPS location' : 'My address isn’t listed. Use current location'}</button></div>
      <div class="sec">Delivery instructions (optional)</div><textarea data-bind="instr" maxlength="300" placeholder="Gate number, room or block, call before arriving…">${e(S.instr)}</textarea>
      ${blocked ? `<div class="banner warn mt">${e(err.message)}</div>` : err && S.dest ? `<div class="banner bad mt">${e(err.message)}</div>` : ''}
      ${q ? `<div class="sec">Bill details</div><div class="card"><div class="kv"><span>Item total (restaurant price)</span><span>${rs(q.items_base_paise)}</span></div><div class="kv"><span>Platform markup</span><span>${rs(q.markup_paise)}</span></div><div class="kv"><span>Delivery charge</span><span>${rs(q.delivery_paise)}</span></div>${q.surge_paise ? `<div class="kv"><span>Surge charge</span><span>${rs(q.surge_paise)}</span></div>` : ''}${q.tax_paise ? `<div class="kv"><span>Taxes</span><span>${rs(q.tax_paise)}</span></div>` : ''}<div class="kv tot"><span>Total</span><span class="num">${rs(q.total_paise)}</span></div><div class="small mute">Estimated delivery in ~${q.prep_min + 8 + q.delivery_min} min</div></div>` : ''}
      <button class="btn block mt" data-act="place" ${q && !err ? '' : 'disabled'}>${q ? `Pay ${rs(q.total_paise)}` : 'Choose a delivery location'}</button><p class="small mute mt2" style="text-align:center">Online payment only. Cash on delivery is not available.</p>`;
  }
  document.addEventListener('change', (ev) => { if (ev.target.id !== 'locsel') return; const v = ev.target.value; if (v === 'gps') return; S.dest = v ? { location_id: Number(v) } : null; localStorage.setItem('pl.dest', JSON.stringify(S.dest)); PL.rerender(); });
  PL.actions.place = async (el) => { el.disabled = true; const r = await PL.run(() => PL.post('/api/customer/orders', body())); if (r) PL.go('/pay/' + r.order_code, true); else el.disabled = false; };

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
        <div class="li"><span>${PL.icon('pin')}</span><div class="grow"><b>Delivery location</b><div class="small mute">Change it from the home screen.</div></div></div></div>
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
      '/orders': { title: 'My orders', render: orders, poll: 5000 }, '/orders/:code': { title: 'Order', render: track, poll: 2000, after: () => PL.track.customerMount() }, '/me': { title: 'Account', render: account } } });
})();
