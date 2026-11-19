(function () {
  const e = PL.esc, rs = PL.rs, S = PL.state; let pending = [];
  const paise = (v) => Math.round(Number(v || 0) * 100);

  // ---------- real-time alerts (1s poll; backend is the authority) ----------
  // One alert card at a time, docked above the bottom navigation. Every PLACED order stays in the queue (and in the
  // "New" tab) until the server says it is no longer PLACED; the queue only changes which one is shown.
  let curId = null, collapsed = false;
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - new Date(String(t).replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(t) ? '' : 'Z')).getTime()) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };
  const setAlertSpace = (box) => document.documentElement.style.setProperty('--alert-h', box.classList.contains('hide') ? '0px' : box.offsetHeight + 'px');
  async function alertTick() {
    let d, list; try { d = await PL.api('/api/restaurant/orders'); list = d.orders; } catch { return; }
    S.timeout = d.accept_timeout_sec; S.skew = Date.parse(d.server_time) - Date.now();      // server clock is the reference
    pending = list.filter((o) => o.status === 'PLACED').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id);   // oldest first: it has waited longest
    PL.badge('/orders', pending.length);
    if (S.prevN != null && pending.length > S.prevN) { try { navigator.vibrate?.([220, 120, 220]); } catch {} }
    S.prevN = pending.length; document.title = pending.length ? `(${pending.length}) New order · Pakka Local` : 'Restaurant · Pakka Local';
    const box = PL.$('#alerts'); if (!box) return;
    box.classList.add('rq');
    let i = pending.findIndex((o) => o.id === curId); if (i < 0) i = 0;
    const o = pending[i]; curId = o ? o.id : null; if (!o) collapsed = false;
    const n = pending.length;
    const soundBtn = PL.sound.unlocked ? '' : `<button class="btn ghost sm block mt2" data-act="sound-on">${PL.icon('sound', 'width="18" height="18"')} Enable alert sound</button>`;
    const html = !o ? '' : collapsed
      ? `<div class="card rq-bar" role="status"><span class="dot"></span><b class="grow">${n} new order${n > 1 ? 's' : ''} waiting</b><button class="btn sm" data-act="rq-expand">Show</button></div>`
      : `<div class="card" role="alertdialog" aria-label="New order ${i + 1} of ${n}">
      <div class="row between"><b>New order${n > 1 ? ` <span class="mute">· ${i + 1} of ${n}</span>` : ''}</b><div class="row" style="gap:4px">${n > 1 ? `<button class="iconbtn" data-act="rq-prev" aria-label="Previous order" ${i === 0 ? 'disabled' : ''}>‹</button><button class="iconbtn" data-act="rq-next" aria-label="Next order" ${i === n - 1 ? 'disabled' : ''}>›</button>` : ''}<button class="iconbtn" data-act="rq-collapse" aria-label="Minimise alert" title="Minimise">${PL.icon('x')}</button></div></div>
      ${n > 1 ? `<div class="rq-list" role="tablist">${pending.map((p, k) => `<button role="tab" aria-selected="${k === i}" class="${k === i ? 'on' : ''}" data-act="rq-pick" data-id="${p.id}">${e(String(p.order_code).slice(-6))} · ${rs(p.total_items_paise)}</button>`).join('')}</div>` : ''}
      <div class="row between mt2 wrap">${PL.code(o.order_code)}<span class="small mute">Placed ${e(PL.time(o.placed_at || o.created_at))}</span></div>
      <div class="timer" data-placed="${e(o.placed_at || o.created_at)}" aria-live="polite"></div>
      <div class="rq-items">${o.items.map((it) => `<div class="kv"><span>${it.qty} × ${e(it.name)}</span><span class="mute small">~${it.prep_time_min} min</span></div>`).join('')}</div>
      <div class="kv tot"><span>Order amount</span><span>${rs(o.total_items_paise)}</span></div><div class="small mute">You receive ${rs(o.payout_paise)} after commission</div>
      ${soundBtn}<div class="row mt2"><button class="btn danger grow" data-act="reject" data-id="${o.id}">Reject</button><button class="btn green grow" data-act="accept" data-id="${o.id}">${PL.icon('check')} Accept</button></div></div>`;
    if (box.dataset.h !== html) { box.dataset.h = html; box.innerHTML = html; }
    // on the Orders screen the "New orders" box is the alert (same buttons); the pop-up is for the other screens. The ring plays everywhere.
    const onOrders = document.body.dataset.route === '/orders';
    box.classList.toggle('hide', !n || onOrders); setAlertSpace(box); PL.sound.sync(n > 0); paintTimers();
    const sb = PL.$('#k-sound'); if (sb) sb.classList.toggle('hide', !n || PL.sound.unlocked);
  }
  // Response timer. The limit is the admin setting "restaurant_accept_timeout_min"; with no setting only the waiting time is shown.
  // Only the text is updated each second (the card itself is not redrawn, so buttons never move under a finger).
  const mmss = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  function paintTimers() { const now = Date.now() + (S.skew || 0);
    document.querySelectorAll('[data-placed]').forEach((el) => { const waited = Math.max(0, Math.floor((now - Date.parse(el.dataset.placed)) / 1000));
      if (!S.timeout) { el.className = 'timer'; const m = Math.floor(waited / 60), long = m >= 1440 ? `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h` : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
        el.innerHTML = `${PL.icon('clock', 'width="16" height="16"')} Waiting ${waited < 60 ? 'less than a minute' : long}`; el.classList.toggle('over', m >= 30); return; }
      const left = S.timeout - waited, pct = Math.max(0, Math.min(100, (left / S.timeout) * 100));
      el.className = 'timer ' + (left <= 0 ? 'over' : left <= 60 ? 'soon' : '');
      el.innerHTML = left > 0 ? `<span>${PL.icon('clock', 'width="16" height="16"')} Respond within <b>${mmss(left)}</b></span><i style="width:${pct}%"></i>` : `<span>${PL.icon('clock', 'width="16" height="16"')} Response time passed ${mmss(-left)} ago. Accept or reject now.</span>`; }); }
  setInterval(paintTimers, 1000);
  const move = (d) => { const i = pending.findIndex((o) => o.id === curId); const nx = pending[Math.min(pending.length - 1, Math.max(0, i + d))]; if (nx) curId = nx.id; alertTick(); };
  PL.actions['rq-prev'] = () => move(-1);
  PL.actions['rq-next'] = () => move(1);
  PL.actions['rq-pick'] = (el) => { curId = Number(el.dataset.id); alertTick(); };
  PL.actions['rq-collapse'] = () => { collapsed = true; alertTick(); };
  PL.actions['rq-expand'] = () => { collapsed = false; alertTick(); };
  addEventListener('resize', () => { const b = PL.$('#alerts'); if (b) setAlertSpace(b); });
  PL.actions['sound-on'] = async () => { await PL.sound.enable(); alertTick(); };
  // one tap: accept and start cooking (the customer sees both steps); if the second step fails the order still shows under Cooking
  PL.actions.accept = (el) => PL.busy(el, async () => { const id = el.dataset.id; const r = await PL.run(() => PL.post(`/api/restaurant/orders/${id}/accept`));
    if (r) { await PL.post(`/api/restaurant/orders/${id}/preparing`).catch(() => {}); PL.toast('Order accepted. Start cooking!'); } await alertTick(); PL.rerender(); });
  PL.actions.reject = (el) => PL.modal(`<h3>Reject this order?</h3><p class="small mute">The customer is notified and a refund is started.</p><form data-form="reject" data-id="${el.dataset.id}"><label>Reason</label><select name="reason" required><option value="">Choose a reason</option>${['Items unavailable', 'Restaurant too busy', 'Restaurant temporarily closed', 'Technical issue', 'Other'].map((r) => `<option>${r}</option>`).join('')}</select><label>Details (optional)</label><textarea name="note" maxlength="300"></textarea><button class="btn danger block mt" type="submit">Reject order</button></form>`);
  PL.forms.reject = async (f) => { const v = PL.form(f); const r = await PL.run(() => PL.post(`/api/restaurant/orders/${f.dataset.id}/reject`, { reason: v.reason, note: v.note }), 'Order rejected'); if (r) { PL.closeModal(); await alertTick(); setTimeout(PL.rerender, 80); } };
  PL.actions.step = (el) => PL.busy(el, async () => { await PL.run(() => PL.post(`/api/restaurant/orders/${el.dataset.id}/${el.dataset.step}`), el.dataset.step === 'ready' ? 'Food is ready. Give the code to the rider.' : 'Cooking started'); PL.rerender(); });

  // ---------- orders + open/close ----------
  const statusCard = (s) => `<div class="card"><div class="row between"><div><div class="small mute">Restaurant status</div><h2>${s.is_open ? 'Open for orders' : 'Closed'}</h2>${!s.is_open ? `<div class="small mute">${s.reopen_mode === 'auto' && s.reopen_at ? `Reopens automatically at ${PL.dt(s.reopen_at)}` : 'Stays closed until you reopen'}</div>` : ''}</div>
    <button class="sw ${s.is_open ? 'on' : ''}" data-act="toggle-open" aria-label="Open or close restaurant"><i></i></button></div></div>`;
  PL.actions['toggle-open'] = async () => { S.et = null; const me = await PL.api('/api/restaurant/me'); if (!me.status.is_open) { const r = await PL.run(() => PL.post('/api/restaurant/status', { open: true }), 'Restaurant is open'); if (r) PL.rerender(); return; }
    PL.modal(`<h3>Close restaurant</h3><p class="small mute">Customers can’t order while you’re closed.</p><form data-form="close"><label class="row" style="font-weight:700"><input type="radio" name="mode" value="auto" checked style="width:22px;min-height:22px"> Reopen automatically after</label>
      <div class="grid" style="grid-template-columns:repeat(3,1fr)"><div><label>Days</label><input name="days" type="number" min="0" max="30" value="0"></div><div><label>Hours</label><input name="hours" type="number" min="0" max="23" value="1"></div><div><label>Minutes</label><input name="minutes" type="number" min="0" max="59" value="0"></div></div>
      <label class="row mt" style="font-weight:700"><input type="radio" name="mode" value="manual" style="width:22px;min-height:22px"> Stay closed until I reopen manually</label><button class="btn block mt" type="submit">Close restaurant</button></form>`); };
  PL.forms.close = async (f) => { const v = PL.form(f); const b = { open: false, mode: v.mode }; if (v.mode === 'auto') Object.assign(b, { days: +v.days || 0, hours: +v.hours || 0, minutes: +v.minutes || 0 });
    const r = await PL.run(() => PL.post('/api/restaurant/status', b), 'Restaurant closed'); if (r) { PL.closeModal(); setTimeout(PL.rerender, 80); } };
  // ---------- orders: one screen, three boxes, two taps (Accept -> Food is ready). No tabs. ----------
  const COOK = ['ACCEPTED', 'PREPARING'], PAST = ['PICKED_UP', 'DELIVERED', 'REJECTED', 'CANCELLED'];
  const sc = (o) => '#' + e(String(o.order_code).slice(-6));
  const itemsList = (o) => `<ul class="k-items">${o.items.map((i) => `<li><b>${i.qty}×</b><span>${e(i.name)}</span></li>`).join('')}</ul>`;
  const newCard = (o) => `<div class="k-card k-new"><div class="k-top"><b class="k-code">${sc(o)}</b><span class="timer" data-placed="${e(o.placed_at || o.created_at)}"></span></div>
      ${itemsList(o)}<div class="k-pay"><span>You get</span><b>${rs(o.payout_paise)}</b></div>
      <div class="k-acts"><button class="btn danger" data-act="reject" data-id="${o.id}">Reject</button><button class="btn green lg" data-act="accept" data-id="${o.id}">${PL.icon('check')} Accept</button></div></div>`;
  const cookCard = (o) => `<div class="k-card k-cook"><div class="k-top"><b class="k-code">${sc(o)}</b><span class="small mute">Accepted ${e(PL.ago(o.created_at))}</span></div>
      ${itemsList(o)}<button class="btn block lg k-big" data-act="step" data-step="ready" data-id="${o.id}">${PL.icon('box')} Food is ready</button></div>`;
  const readyCard = (o) => `<div class="k-card k-ready"><div class="k-top"><b class="k-code">${sc(o)}</b><span class="k-rider">${PL.icon('bike')} ${o.rider ? `${e(o.rider.name)} is coming` : 'Finding a rider…'}</span></div>
      ${itemsList(o)}<div class="k-pick"><span>Give this code to the rider</span><div class="k-otp">${String(o.pickup_otp || '').split('').map((d) => `<i>${e(d)}</i>`).join('')}</div></div></div>`;
  const pastRow = (o) => `<div class="k-past"><div class="grow"><b>${sc(o)}</b> <span class="small mute">${e(PL.dt(o.created_at))}</span><div class="small">${o.items.map((i) => `${i.qty}× ${e(i.name)}`).join(', ')}</div>
      ${o.rejection_reason ? `<div class="small" style="color:var(--bad)">${o.status === 'CANCELLED' ? '' : 'Rejected: '}${e(o.rejection_reason)}${o.refund ? ' ' + PL.chip(o.refund) : ''}</div>` : ''}${o.status === 'PICKED_UP' && o.rider ? `<div class="small mute">Picked up by ${e(o.rider.name)}</div>` : ''}</div>
      <div class="right">${PL.chip(o.status)}<div class="small mt2">${['REJECTED', 'CANCELLED'].includes(o.status) ? '' : rs(o.payout_paise)}</div></div></div>`;
  const anyCard = (o) => (o.status === 'PLACED' ? newCard(o) : COOK.includes(o.status) ? cookCard(o) : o.status === 'READY' ? readyCard(o) : `<div class="k-card">${pastRow(o)}</div>`);
  const box = (cls, title, hint, list, card, emptyText) => `<section class="k-sec ${cls}"><div class="k-h"><h2>${title}</h2><span class="k-n">${list.length}</span></div><p class="k-hint">${hint}</p>
      ${list.length ? `<div class="k-list">${list.map(card).join('')}</div>` : `<div class="k-empty">${emptyText}</div>`}</section>`;
  // today's earnings change only when an order is delivered: refresh at most every 30 s, not on every 2 s order refresh
  const earnToday = async () => { if (!S.et || Date.now() - S.et.t > 30000) { try { S.et = { t: Date.now(), d: (await PL.api('/api/restaurant/earnings')).today }; } catch { S.et = S.et || { t: Date.now(), d: null }; } } return S.et.d; };
  const headCard = (me, today) => { const st = me.status, r = me.restaurant;
    return `<div class="card r-head"><div class="row">${PL.img(r.logo_path, 'r-logo')}<div class="grow"><h2 class="ellip">${e(r.name)}</h2><div class="small mute">${today ? `Earned today <b style="color:var(--ok)">${rs(today.payout_paise)}</b>` : e(r.cuisine || '')}</div></div>
      <div class="r-open ${st.is_open ? 'on' : ''}"><span><i></i>${st.is_open ? 'Open' : 'Closed'}</span><button class="sw ${st.is_open ? 'on' : ''}" data-act="toggle-open" aria-label="${st.is_open ? 'Close restaurant' : 'Open restaurant'}"><i></i></button></div></div>
      ${!st.is_open ? `<div class="small mute mt2">${st.reopen_mode === 'auto' && st.reopen_at ? `Reopens automatically at ${PL.dt(st.reopen_at)}` : 'Customers can’t order until you reopen.'}</div>` : ''}</div>`; };
  async function orders() {
    const [me, { orders }, today] = await Promise.all([PL.api('/api/restaurant/me'), PL.api('/api/restaurant/orders'), earnToday()]);
    const warn = !me.restaurant.admin_visible || !me.restaurant.approved ? '<div class="banner warn">Pakka Local has hidden your restaurant from customers. Contact support.</div>' : '';
    const fresh = orders.filter((o) => o.status === 'PLACED').sort((a, b) => a.id - b.id), cook = orders.filter((o) => COOK.includes(o.status)).sort((a, b) => a.id - b.id), ready = orders.filter((o) => o.status === 'READY').sort((a, b) => a.id - b.id);
    const dayKey = (t) => new Date(String(t).replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(t) ? '' : 'Z')).toDateString(), todayKey = new Date().toDateString();
    const doneToday = orders.filter((o) => PAST.includes(o.status) && dayKey(o.created_at) === todayKey).length;
    return `${warn}${S.push === 'on' ? '' : PL.push.card('restaurant')}${headCard(me, today)}
      <button id="k-sound" class="btn block mt2 ${fresh.length && !PL.sound.unlocked ? '' : 'hide'}" data-act="sound-on">${PL.icon('sound')} Tap to turn on the new-order ring</button>
      <div class="k-board">
      ${box('s-new', 'New orders', 'Check the items, then tap Accept. Cooking starts right away.', fresh, newCard, me.status.is_open ? 'No new orders. New orders ring and appear here.' : 'You are closed. Open the restaurant to get orders.')}
      ${box('s-cook', 'Cooking', 'When the food is packed, tap “Food is ready”.', cook, cookCard, 'Nothing cooking right now.')}
      ${box('s-ready', 'Ready – give code to rider', 'Show the code to the rider when they arrive. The order disappears once it is picked up.', ready, readyCard, 'No orders waiting for pickup.')}</div>
      <button class="k-pastlink" data-act="go" data-path="/past">${PL.icon('receipt')}<span class="grow"><b>Past orders</b><small>${doneToday} finished today · picked up, delivered and rejected orders</small></span>${PL.icon('chev')}</button>`;
  }
  async function past() { const { orders } = await PL.api('/api/restaurant/orders'); const list = orders.filter((o) => PAST.includes(o.status));
    return `<p class="small mute">Your last ${list.length} finished orders (picked up, delivered or rejected).</p>${list.map((o) => `<div class="card">${pastRow(o)}</div>`).join('') || '<div class="empty">No past orders yet.</div>'}`; }
  // deep link target for notification taps
  async function oneOrder({ id }) { try { const { order } = await PL.api('/api/restaurant/orders/' + id); return `<div class="k-board">${anyCard(order)}</div><button class="btn ghost block mt" data-act="go" data-path="/orders">All orders</button>`; } catch { return '<div class="empty">That order was not found.<br><button class="btn mt" data-act="go" data-path="/orders">Back to orders</button></div>'; } }

  // ---------- menu ----------
  async function menu() { const { items, categories } = await PL.api('/api/restaurant/menu'); const known = new Set(categories.map((c) => c.id)), noPhoto = items.filter((i) => !i.image_path && i.available).length;
    const row = (i) => `<div class="r-dish ${i.available ? '' : 'off'}">${PL.img(i.image_path, 'r-dimg')}<div class="grow"><b class="ellip" style="display:block">${e(i.name)}</b><div class="small mute">${i.diet ? `<span class="diet ${i.diet}" title="${{ veg: 'Veg', nonveg: 'Non-veg', egg: 'Contains egg' }[i.diet]}"></span> ` : ''}${rs(i.base_price_paise)} · ${i.prep_time_min} min</div><div class="row" style="gap:4px;margin-top:4px">${i.available ? '<span class="chip ok">In stock</span>' : '<span class="chip bad">Sold out</span>'}${i.image_path ? '' : `<span class="chip warn">${i.available ? 'Photo needed' : 'No photo'}</span>`}</div></div>
      <div class="r-dact"><button class="sw ${i.available ? 'on' : ''}" data-act="item-avail" data-id="${i.id}" data-v="${i.available ? 0 : 1}" aria-label="${i.available ? 'Mark ' + e(i.name) + ' sold out' : 'Mark ' + e(i.name) + ' available'}"><i></i></button><button class="btn ghost sm" data-act="item-edit" data-id="${i.id}">Edit</button></div></div>`;
    const groups = [...categories.map((c) => [c.name, items.filter((i) => i.category_id === c.id)]), [categories.length ? 'Uncategorised' : '', items.filter((i) => !known.has(i.category_id))]].filter((g) => g[1].length);
    return `${noPhoto ? `<div class="banner warn">${noPhoto} dish${noPhoto > 1 ? 'es are' : ' is'} shown without a photo (added before photos became required). Add photos so customers can see them; new dishes need a photo before they can be shown.</div>` : ''}<div class="row between"><h2>Menu</h2><div class="row"><button class="btn ghost sm" data-act="cats">Categories</button><button class="btn sm" data-act="item-edit">${PL.icon('plus', 'width="18" height="18"')} Add item</button></div></div><p class="small mute mt2">${items.length} dish${items.length === 1 ? '' : 'es'} · ${items.filter((i) => !i.available).length} sold out. Use the switch to mark a dish sold out instantly.</p><div class="mt2">${groups.map(([n, l]) => (n ? `<div class="sec">${e(n)}</div>` : '') + `<div class="r-menu">${l.map(row).join('')}</div>`).join('') || '<div class="empty">Add your first item.</div>'}</div>`; }
  PL.actions.cats = async () => { const { categories } = await PL.api('/api/restaurant/menu');
    PL.modal(`<h3>Menu categories</h3>${categories.map((c) => `<div class="card row"><div class="grow"><b>${e(c.name)}</b></div><button class="btn ghost sm" data-act="cat-rename" data-id="${c.id}" data-n="${e(c.name)}">Rename</button><button class="btn danger sm" data-act="cat-del" data-id="${c.id}">Delete</button></div>`).join('') || '<p class="mute">No categories yet (e.g. Starters, Mains, Drinks).</p>'}
      <div class="sec">Quick add</div><div class="chips">${(await PL.api('/api/restaurant/category-presets')).presets.filter((p) => !categories.some((c) => c.name.toLowerCase() === p.toLowerCase())).map((p) => `<button class="chipbtn" data-act="cat-preset" data-n="${e(p)}">+ ${e(p)}</button>`).join('') || '<span class="small mute">All suggested categories are added.</span>'}</div>
      <div class="sec">Your own category</div><form data-form="cat" class="row"><input name="name" placeholder="e.g. Chef’s specials" maxlength="40" required><button class="btn" type="submit">Add</button></form>`); };
  PL.actions['cat-preset'] = async (el) => { const r = await PL.run(() => PL.post('/api/restaurant/categories', { name: el.dataset.n, sort_order: 50 }), `${el.dataset.n} added`); if (r) { PL.closeModal(); setTimeout(() => { PL.rerender(); PL.actions.cats(); }, 120); } };
  PL.forms.cat = async (f) => { const r = await PL.run(() => PL.post('/api/restaurant/categories', { name: PL.form(f).name, sort_order: 50 }), 'Category added'); if (r) { PL.closeModal(); setTimeout(() => { PL.rerender(); PL.actions.cats(); }, 120); } };
  PL.actions['cat-rename'] = (el) => PL.modal(`<h3>Rename category</h3><form data-form="cat-ren" data-id="${el.dataset.id}"><input name="name" value="${e(el.dataset.n)}" maxlength="40" required><button class="btn block mt" type="submit">Save</button></form>`);
  PL.forms['cat-ren'] = async (f) => { const r = await PL.run(() => PL.put('/api/restaurant/categories/' + f.dataset.id, { name: PL.form(f).name }), 'Saved'); if (r) { PL.closeModal(); setTimeout(PL.rerender, 100); } };
  PL.actions['cat-del'] = async (el) => { if (!(await PL.confirm('Delete this category? Items stay on the menu, uncategorised.', 'Delete'))) return; const r = await PL.run(() => PL.api('/api/restaurant/categories/' + el.dataset.id, { method: 'DELETE' }), 'Deleted'); if (r) { PL.closeModal(); setTimeout(PL.rerender, 100); } };
  PL.actions['item-edit'] = async (el) => { const it = el.dataset.id ? (await PL.api('/api/restaurant/menu')).items.find((x) => x.id == el.dataset.id) : {};
    PL.modal(`<h3>${it.id ? 'Edit' : 'Add'} item</h3><form data-form="item" data-id="${it.id || ''}"><label>Name</label><input name="name" value="${e(it.name || '')}" required maxlength="80"><label>Description</label><textarea name="description" maxlength="300">${e(it.description || '')}</textarea>
      <div class="grid g2"><div><label>Your price (₹)</label><input name="price" inputmode="decimal" value="${it.id ? it.base_price_paise / 100 : ''}" required></div><div><label>Cooking time (min)</label><input name="prep" type="number" min="1" max="180" value="${it.prep_time_min || 15}" required></div></div>
      <label>Food type <span class="small mute">(shown to customers)</span></label><div class="chips" role="radiogroup">${[['', 'Not set'], ['veg', 'Veg'], ['nonveg', 'Non-veg'], ['egg', 'Contains egg']].map(([v, l]) => `<label class="chipbtn"><input type="radio" name="diet" value="${v}" ${(it.diet || '') === v ? 'checked' : ''} style="width:auto;min-height:0;margin-right:6px">${l}</label>`).join('')}</div><label>Category</label><select name="category"><option value="">No category</option>${(await PL.api('/api/restaurant/menu')).categories.map((c) => `<option value="${c.id}" ${it.category_id === c.id ? 'selected' : ''}>${e(c.name)}</option>`).join('')}</select><label>Photo ${it.image_path ? '' : '<span class="chip warn">required to show the dish</span>'}</label>${it.image_path ? PL.img(it.image_path, 'thumb lg') : ''}<input type="file" name="image" accept="image/jpeg,image/png,image/webp"><p class="small mute">JPG, PNG or WebP, up to 3 MB. A clear photo of the actual dish.</p><label class="row" style="font-weight:600"><input type="checkbox" name="available" ${it.available !== 0 ? 'checked' : ''} style="width:22px;min-height:22px"> Available</label><button class="btn block mt" type="submit">Save</button>${it.id ? `<button type="button" class="btn danger block mt2" data-act="item-del" data-id="${it.id}">Delete item</button>` : ''}</form>`); };
  PL.forms.item = async (f) => { const v = PL.form(f), file = f.image.files[0]; let image; if (file && !/^image\/(jpeg|png|webp)$/.test(file.type)) return PL.toast('Use a JPG, PNG or WebP photo.', true); try { if (file) image = await PL.readFile(file); } catch (x) { return PL.toast(x.message, true); }
    const b = { name: v.name, description: v.description, base_price_paise: paise(v.price), prep_time_min: +v.prep, available: !!f.available.checked, category_id: v.category ? Number(v.category) : null, diet: v.diet || null, image };
    const r = await PL.run(() => (f.dataset.id ? PL.put('/api/restaurant/menu/' + f.dataset.id, b) : PL.post('/api/restaurant/menu', b)), 'Saved'); if (r) { PL.closeModal(); setTimeout(PL.rerender, 80); } };
  PL.actions['item-del'] = async (el) => { if (!(await PL.confirm('Delete this item?', 'Delete'))) return; const r = await PL.run(() => PL.api('/api/restaurant/menu/' + el.dataset.id, { method: 'DELETE' }), 'Deleted'); if (r) { PL.closeModal(); setTimeout(PL.rerender, 80); } };
  PL.actions['item-avail'] = async (el) => { el.classList.toggle('on', el.dataset.v === '1'); const it = (await PL.api('/api/restaurant/menu')).items.find((x) => x.id == el.dataset.id); await PL.run(() => PL.put('/api/restaurant/menu/' + it.id, { name: it.name, available: el.dataset.v === '1' }), el.dataset.v === '1' ? `${it.name} is available` : `${it.name} marked sold out`); PL.rerender(); };

  // ---------- earnings ----------
  const dayName = (d, i) => (i === 0 ? 'Today' : i === 1 ? 'Yesterday' : new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }));
  async function earnings() { const d = await PL.api('/api/restaurant/earnings'), t = d.today, y = d.yesterday;
    const max = Math.max(1, ...d.daily.map((x) => x.payout_paise));
    return `<div class="e-hero"><span>You earn today</span><b>${rs(t.payout_paise)}</b><div class="e-sub"><span><b>${t.orders}</b> order${t.orders === 1 ? '' : 's'} delivered</span><span>Sales <b>${rs(t.sales_paise)}</b></span><span>Commission <b>${rs(t.commission_paise)}</b></span></div></div>
      <p class="small mute">Yesterday you earned <b>${rs(y.payout_paise)}</b> from ${y.orders} order${y.orders === 1 ? '' : 's'}. Earnings count when an order is delivered (India time).</p>
      <div class="sec">Last 14 days</div><div class="card">${d.daily.map((x, i) => `<div class="dayrow"><span class="dn">${dayName(x.date, i)}</span><span class="bar"><i style="width:${(100 * x.payout_paise / max).toFixed(1)}%"></i></span><span class="right"><b>${rs(x.payout_paise)}</b><div class="small mute">${x.orders} order${x.orders === 1 ? '' : 's'} · sales ${rs(x.sales_paise)} − ${rs(x.commission_paise)}</div></span></div>`).join('')}</div>
      <div class="sec">Balance</div>${PL.balanceCards(d.balance, `<div class="stat"><div class="v">${rs(d.sales_paise)}</div><div class="l">All-time sales</div></div><div class="stat"><div class="v">${rs(d.commission_paise)}</div><div class="l">All-time commission</div></div>`)}
      <button class="btn block mt" data-act="cashout-new" data-ep="/api/restaurant/cashouts" data-methods="${e(d.methods.join(','))}" data-avail="${d.balance.available}" ${d.balance.available < 100 ? 'disabled' : ''}>Request cashout</button>
      <div class="sec">Cashouts</div>${PL.cashoutList(d.cashouts)}<div class="sec">Delivered orders</div>${d.orders.map((o) => `<div class="card"><div class="row between"><span>${PL.code(o.order_code)}</span><b>${rs(o.restaurant_payout_paise)}</b></div><div class="small mute">Sales ${rs(o.items_base_paise)} − commission ${rs(o.commission_paise)} · ${PL.dt(o.updated_at)}</div></div>`).join('') || '<div class="empty">Earnings appear after orders are delivered.</div>'}`; }

  // ---------- more: search, surge, profile ----------
  async function more() { const me = await PL.api('/api/restaurant/me'); const r = me.restaurant;
    return `<div class="card row">${PL.img(r.logo_path)}<div class="grow"><h3>${e(r.name)}</h3><div class="small mute">${e(r.address || '')}</div></div></div>
      <div class="card"><h3>Find an order</h3><form data-form="osearch" class="row mt2"><input name="code" placeholder="PL20261104A1B2C3" required style="text-transform:uppercase"><button class="btn" type="submit">Search</button></form><div id="sres"></div></div>

      <button class="card row" style="width:100%;text-align:left;cursor:pointer" data-act="edit-profile"><span style="color:var(--brand)">${PL.icon('shop')}</span><div class="grow"><b>Restaurant profile</b><div class="small mute">Name, address, contact, photos</div></div></button>${PL.push.card('restaurant')}<button class="btn ghost block mt" data-act="logout">Sign out</button>`; }
  PL.forms.osearch = async (f) => { const code = PL.form(f).code.trim().toUpperCase(); try { const { order: o } = await PL.api('/api/restaurant/orders/by-code/' + encodeURIComponent(code));
    PL.$('#sres').innerHTML = `<div class="mt2"><div class="row between">${PL.code(o.order_code)}${PL.chip(o.status)}</div>${o.items.map((i) => `<div class="kv"><span>${i.qty} × ${e(i.name)}</span></div>`).join('')}<div class="small mute">Payout ${rs(o.payout_paise)}</div>${o.events.map((x) => `<div class="small mute">${PL.dt(x.created_at)} · ${e(x.event_type.replace(/_/g, ' ').toLowerCase())}</div>`).join('')}</div>`; } catch (x) { PL.$('#sres').innerHTML = `<div class="banner bad mt2">${e(x.message)}</div>`; } };
  PL.actions['edit-profile'] = async () => { const r = (await PL.api('/api/restaurant/me')).restaurant;
    PL.modal(`<h3>Restaurant profile</h3><form data-form="profile"><label>Name</label><input name="name" value="${e(r.name)}" required><label>Cuisine</label><input name="cuisine" value="${e(r.cuisine || '')}"><label>Description</label><textarea name="description">${e(r.description || '')}</textarea><label>Address</label><input name="address" value="${e(r.address || '')}"><label>Operating information (hours, notes)</label><input name="operating_info" maxlength="200" value="${e(r.operating_info || '')}" placeholder="e.g. Closed on Mondays"><div class="row" style="gap:10px"><div class="grow"><label>Opens at</label><input type="time" name="opens_at" value="${e(r.opens_at || '')}"></div><div class="grow"><label>Closes at</label><input type="time" name="closes_at" value="${e(r.closes_at || '')}"></div></div><p class="small mute">Shown to customers. Your Open / Closed switch still decides when orders come in.</p><label>Contact phone</label><input name="phone" value="${e(r.phone || '')}"><label>Logo</label><input type="file" name="logo" accept="image/*"><label>Cover photo</label><input type="file" name="image" accept="image/*"><button class="btn block mt" type="submit">Save</button></form>`); };
  PL.forms.profile = async (f) => { const v = PL.form(f); let logo, image; try { if (f.logo.files[0]) logo = await PL.readFile(f.logo.files[0], { max: 600 }); if (f.image.files[0]) image = await PL.readFile(f.image.files[0]); } catch (x) { return PL.toast(x.message, true); }
    if (!!v.opens_at !== !!v.closes_at) return PL.toast('Set both the opening and the closing time, or leave both empty.', true);
    const r = await PL.run(() => PL.put('/api/restaurant/me', { ...v, opens_at: v.opens_at || null, closes_at: v.closes_at || null, logo, image }), 'Profile saved'); if (r) { PL.closeModal(); setTimeout(PL.rerender, 80); } };
  // (restaurant surge-charge requests were removed)

  // No mute button: new-order alerts always ring once sound is allowed. An old "muted" choice from the removed button is cleared.
  try { if (localStorage.getItem('pl.sound') === '0') localStorage.removeItem('pl.sound'); } catch {}
  PL.start({ portal: 'restaurant', name: 'Restaurant', home: '/orders', loginView: (root) => PL.staffLogin(root, { title: 'Restaurant portal', blurb: 'Manage your menu, orders and payouts.' }),
    tabs: [{ path: '/orders', label: 'Orders', icon: 'orders' }, { path: '/menu', label: 'Menu', icon: 'menu' }, { path: '/earnings', label: 'Earnings', icon: 'wallet' }, { path: '/more', label: 'More', icon: 'gear' }],
    onReady: () => { alertTick(); const iv = setInterval(alertTick, 1000); PL.hooks.stop = [() => { clearInterval(iv); const b = PL.$('#alerts'); if (b) { b.innerHTML = ''; b.dataset.h = ''; b.classList.add('hide'); setAlertSpace(b); } }]; },
    routes: { '/orders': { title: 'Orders', render: orders, poll: 2000, skel: 'dash', after: () => alertTick() }, '/order/:id': { title: 'Order', render: oneOrder, poll: 2000 }, '/past': { title: 'Past orders', render: past, poll: 10000 }, '/menu': { title: 'Menu', render: menu }, '/earnings': { title: 'Earnings', render: earnings, poll: 5000, skel: 'dash' }, '/more': { title: 'More', render: more } } });
})();
