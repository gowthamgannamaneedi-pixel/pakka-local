(function () {
  const e = PL.esc, rs = PL.rs, S = PL.state; S.otab = 'new'; let pending = [];
  const paise = (v) => Math.round(Number(v || 0) * 100);
  const ST = { new: ['PLACED'], accepted: ['ACCEPTED'], preparing: ['PREPARING'], ready: ['READY'], picked: ['PICKED_UP'], done: ['DELIVERED'], rejected: ['REJECTED', 'CANCELLED'] };
  const TABS = [['new', 'New'], ['accepted', 'Accepted'], ['preparing', 'Preparing'], ['ready', 'Ready'], ['picked', 'Picked up'], ['done', 'Completed'], ['rejected', 'Rejected']];

  // ---------- real-time alerts (1s poll; backend is the authority) ----------
  // One alert card at a time, docked above the bottom navigation. Every PLACED order stays in the queue (and in the
  // "New" tab) until the server says it is no longer PLACED; the queue only changes which one is shown.
  let curId = null, collapsed = false;
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - new Date(String(t).replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(t) ? '' : 'Z')).getTime()) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };
  const setAlertSpace = (box) => document.documentElement.style.setProperty('--alert-h', box.classList.contains('hide') ? '0px' : box.offsetHeight + 'px');
  async function alertTick() {
    let list; try { list = (await PL.api('/api/restaurant/orders')).orders; } catch { return; }
    pending = list.filter((o) => o.status === 'PLACED').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id);   // oldest first: it has waited longest
    PL.badge('/orders', pending.length);
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
      <div class="row between mt2 wrap">${PL.code(o.order_code)}<span class="small mute" title="${e(PL.dt(o.created_at))}">${e(PL.dt(o.created_at))} · ${ago(o.created_at)}</span></div>
      <div class="rq-items">${o.items.map((it) => `<div class="kv"><span>${it.qty} × ${e(it.name)}</span><span class="mute small">~${it.prep_time_min} min</span></div>`).join('')}</div>
      <div class="kv tot"><span>Order amount</span><span>${rs(o.total_items_paise)}</span></div><div class="small mute">You receive ${rs(o.payout_paise)} after commission</div>
      ${soundBtn}<div class="row mt2"><button class="btn danger grow" data-act="reject" data-id="${o.id}">Reject</button><button class="btn grow" data-act="accept" data-id="${o.id}">Accept order</button></div></div>`;
    if (box.dataset.h !== html) { box.dataset.h = html; box.innerHTML = html; }
    box.classList.toggle('hide', !n); setAlertSpace(box); PL.sound.sync(n > 0);
  }
  const move = (d) => { const i = pending.findIndex((o) => o.id === curId); const nx = pending[Math.min(pending.length - 1, Math.max(0, i + d))]; if (nx) curId = nx.id; alertTick(); };
  PL.actions['rq-prev'] = () => move(-1);
  PL.actions['rq-next'] = () => move(1);
  PL.actions['rq-pick'] = (el) => { curId = Number(el.dataset.id); alertTick(); };
  PL.actions['rq-collapse'] = () => { collapsed = true; alertTick(); };
  PL.actions['rq-expand'] = () => { collapsed = false; alertTick(); };
  addEventListener('resize', () => { const b = PL.$('#alerts'); if (b) setAlertSpace(b); });
  PL.actions['sound-on'] = async () => { await PL.sound.enable(); const b = PL.$('#sbtn'); if (b) b.innerHTML = PL.icon('sound'); alertTick(); };
  PL.actions.accept = async (el) => { await PL.run(() => PL.post(`/api/restaurant/orders/${el.dataset.id}/accept`), 'Order accepted'); await alertTick(); PL.rerender(); };
  PL.actions.reject = (el) => PL.modal(`<h3>Reject this order?</h3><p class="small mute">The customer is notified and a refund is started.</p><form data-form="reject" data-id="${el.dataset.id}"><label>Reason</label><select name="reason" required><option value="">Choose a reason</option>${['Items unavailable', 'Restaurant too busy', 'Restaurant temporarily closed', 'Technical issue', 'Other'].map((r) => `<option>${r}</option>`).join('')}</select><label>Details (optional)</label><textarea name="note" maxlength="300"></textarea><button class="btn danger block mt" type="submit">Reject order</button></form>`);
  PL.forms.reject = async (f) => { const v = PL.form(f); const r = await PL.run(() => PL.post(`/api/restaurant/orders/${f.dataset.id}/reject`, { reason: v.reason, note: v.note }), 'Order rejected'); if (r) { PL.closeModal(); await alertTick(); setTimeout(PL.rerender, 80); } };
  PL.actions.step = async (el) => { await PL.run(() => PL.post(`/api/restaurant/orders/${el.dataset.id}/${el.dataset.step}`), 'Updated'); PL.rerender(); };

  // ---------- orders + open/close ----------
  const statusCard = (s) => `<div class="card"><div class="row between"><div><div class="small mute">Restaurant status</div><h2>${s.is_open ? 'Open for orders' : 'Closed'}</h2>${!s.is_open ? `<div class="small mute">${s.reopen_mode === 'auto' && s.reopen_at ? `Reopens automatically at ${PL.dt(s.reopen_at)}` : 'Stays closed until you reopen'}</div>` : ''}</div>
    <button class="sw ${s.is_open ? 'on' : ''}" data-act="toggle-open" aria-label="Open or close restaurant"><i></i></button></div></div>`;
  PL.actions['toggle-open'] = async () => { const me = await PL.api('/api/restaurant/me'); if (!me.status.is_open) { const r = await PL.run(() => PL.post('/api/restaurant/status', { open: true }), 'Restaurant is open'); if (r) PL.rerender(); return; }
    PL.modal(`<h3>Close restaurant</h3><p class="small mute">Customers can’t order while you’re closed.</p><form data-form="close"><label class="row" style="font-weight:700"><input type="radio" name="mode" value="auto" checked style="width:22px;min-height:22px"> Reopen automatically after</label>
      <div class="grid" style="grid-template-columns:repeat(3,1fr)"><div><label>Days</label><input name="days" type="number" min="0" max="30" value="0"></div><div><label>Hours</label><input name="hours" type="number" min="0" max="23" value="1"></div><div><label>Minutes</label><input name="minutes" type="number" min="0" max="59" value="0"></div></div>
      <label class="row mt" style="font-weight:700"><input type="radio" name="mode" value="manual" style="width:22px;min-height:22px"> Stay closed until I reopen manually</label><button class="btn block mt" type="submit">Close restaurant</button></form>`); };
  PL.forms.close = async (f) => { const v = PL.form(f); const b = { open: false, mode: v.mode }; if (v.mode === 'auto') Object.assign(b, { days: +v.days || 0, hours: +v.hours || 0, minutes: +v.minutes || 0 });
    const r = await PL.run(() => PL.post('/api/restaurant/status', b), 'Restaurant closed'); if (r) { PL.closeModal(); setTimeout(PL.rerender, 80); } };
  PL.actions.otab = (el) => { S.otab = el.dataset.t; PL.rerender(); };
  const orderCard = (o) => `<div class="card"><div class="row between"><div>${PL.code(o.order_code)}</div>${PL.chip(o.status)}</div><div class="small mute">${PL.dt(o.created_at)}</div>
        <div class="mt2">${o.items.map((i) => `<div class="kv"><span>${i.qty} × ${e(i.name)}</span><span class="mute small">~${i.prep_time_min} min</span></div>`).join('')}</div><div class="small mute">Payout ${rs(o.payout_paise)} (commission ${rs(o.commission_paise)})</div>
        ${o.rejection_reason ? `<div class="small" style="color:var(--bad)">${o.status === 'CANCELLED' ? '' : 'Rejected: '}${e(o.rejection_reason)} ${o.refund ? PL.chip(o.refund) : ''}</div>` : ''}
        ${o.status === 'PLACED' ? `<div class="row mt2"><button class="btn danger grow" data-act="reject" data-id="${o.id}">Reject</button><button class="btn grow" data-act="accept" data-id="${o.id}">Accept</button></div>` : ''}
        ${o.status === 'ACCEPTED' ? `<div class="row mt2"><button class="btn ghost grow" data-act="step" data-step="preparing" data-id="${o.id}">Start preparing</button><button class="btn grow" data-act="step" data-step="ready" data-id="${o.id}">Food ready</button></div>` : ''}
        ${o.status === 'PREPARING' ? `<button class="btn block mt2" data-act="step" data-step="ready" data-id="${o.id}">Mark ready for pickup</button>` : ''}
        ${o.status === 'READY' ? `<div class="mt2 small mute">Give this pickup code to the rider${o.rider ? ' (' + e(o.rider.name) + ')' : ''}</div><div class="otp">${e(o.pickup_otp)}</div>${o.rider ? '' : '<div class="small mute mt2">Waiting for a rider to accept…</div>'}` : ''}
        ${o.status === 'PICKED_UP' && o.rider ? `<div class="small mt2">Picked up by ${e(o.rider.name)}</div>` : ''}</div>`;
  async function orders() {
    const [me, { orders }] = await Promise.all([PL.api('/api/restaurant/me'), PL.api('/api/restaurant/orders')]); const list = orders.filter((o) => ST[S.otab].includes(o.status));
    const warn = !me.restaurant.admin_visible || !me.restaurant.approved ? '<div class="banner warn">Pakka Local has hidden your restaurant from customers. Contact support.</div>' : '';
    return `${warn}${S.push === 'on' ? '' : PL.push.card('restaurant')}${statusCard(me.status)}<div class="tabs">${TABS.map(([k, l]) => `<button class="${S.otab === k ? 'on' : ''}" data-act="otab" data-t="${k}">${l}${k === 'new' && pending.length ? ` (${pending.length})` : ''}</button>`).join('')}</div>
      ${list.map(orderCard).join('') || '<div class="empty">No orders here.</div>'}`;
  }
  // deep link target for notification taps
  async function oneOrder({ id }) { try { const { order } = await PL.api('/api/restaurant/orders/' + id); return orderCard(order); } catch { return '<div class="empty">That order was not found.<br><button class="btn mt" data-act="go" data-path="/orders">Back to orders</button></div>'; } }

  // ---------- menu ----------
  async function menu() { const { items, categories } = await PL.api('/api/restaurant/menu'); const known = new Set(categories.map((c) => c.id));
    const row = (i) => `<div class="card row">${PL.img(i.image_path)}<div class="grow"><b>${e(i.name)}</b><div class="small mute">${rs(i.base_price_paise)} · ${i.prep_time_min} min</div>${i.available ? '' : '<span class="chip bad">Sold out</span>'}</div>
      <div style="display:grid;gap:6px"><button class="btn ghost sm" data-act="item-edit" data-id="${i.id}">Edit</button><button class="btn ghost sm" data-act="item-avail" data-id="${i.id}" data-v="${i.available ? 0 : 1}">${i.available ? 'Mark sold out' : 'Available'}</button></div></div>`;
    const groups = [...categories.map((c) => [c.name, items.filter((i) => i.category_id === c.id)]), [categories.length ? 'Uncategorised' : '', items.filter((i) => !known.has(i.category_id))]].filter((g) => g[1].length);
    return `<div class="row between"><h2>Menu</h2><div class="row"><button class="btn ghost sm" data-act="cats">Categories</button><button class="btn sm" data-act="item-edit">${PL.icon('plus', 'width="18" height="18"')} Add item</button></div></div><div class="mt2">${groups.map(([n, l]) => (n ? `<div class="sec">${e(n)}</div>` : '') + l.map(row).join('')).join('') || '<div class="empty">Add your first item.</div>'}</div>`; }
  PL.actions.cats = async () => { const { categories } = await PL.api('/api/restaurant/menu');
    PL.modal(`<h3>Menu categories</h3>${categories.map((c) => `<div class="card row"><div class="grow"><b>${e(c.name)}</b></div><button class="btn ghost sm" data-act="cat-rename" data-id="${c.id}" data-n="${e(c.name)}">Rename</button><button class="btn danger sm" data-act="cat-del" data-id="${c.id}">Delete</button></div>`).join('') || '<p class="mute">No categories yet (e.g. Starters, Mains, Drinks).</p>'}
      <form data-form="cat" class="row mt"><input name="name" placeholder="New category" maxlength="40" required><button class="btn" type="submit">Add</button></form>`); };
  PL.forms.cat = async (f) => { const r = await PL.run(() => PL.post('/api/restaurant/categories', { name: PL.form(f).name, sort_order: 50 }), 'Category added'); if (r) { PL.closeModal(); setTimeout(() => { PL.rerender(); PL.actions.cats(); }, 120); } };
  PL.actions['cat-rename'] = (el) => PL.modal(`<h3>Rename category</h3><form data-form="cat-ren" data-id="${el.dataset.id}"><input name="name" value="${e(el.dataset.n)}" maxlength="40" required><button class="btn block mt" type="submit">Save</button></form>`);
  PL.forms['cat-ren'] = async (f) => { const r = await PL.run(() => PL.put('/api/restaurant/categories/' + f.dataset.id, { name: PL.form(f).name }), 'Saved'); if (r) { PL.closeModal(); setTimeout(PL.rerender, 100); } };
  PL.actions['cat-del'] = async (el) => { if (!(await PL.confirm('Delete this category? Items stay on the menu, uncategorised.', 'Delete'))) return; const r = await PL.run(() => PL.api('/api/restaurant/categories/' + el.dataset.id, { method: 'DELETE' }), 'Deleted'); if (r) { PL.closeModal(); setTimeout(PL.rerender, 100); } };
  PL.actions['item-edit'] = async (el) => { const it = el.dataset.id ? (await PL.api('/api/restaurant/menu')).items.find((x) => x.id == el.dataset.id) : {};
    PL.modal(`<h3>${it.id ? 'Edit' : 'Add'} item</h3><form data-form="item" data-id="${it.id || ''}"><label>Name</label><input name="name" value="${e(it.name || '')}" required maxlength="80"><label>Description</label><textarea name="description" maxlength="300">${e(it.description || '')}</textarea>
      <div class="grid g2"><div><label>Your price (₹)</label><input name="price" inputmode="decimal" value="${it.id ? it.base_price_paise / 100 : ''}" required></div><div><label>Cooking time (min)</label><input name="prep" type="number" min="1" max="180" value="${it.prep_time_min || 15}" required></div></div>
      <label>Category</label><select name="category"><option value="">No category</option>${(await PL.api('/api/restaurant/menu')).categories.map((c) => `<option value="${c.id}" ${it.category_id === c.id ? 'selected' : ''}>${e(c.name)}</option>`).join('')}</select><label>Photo</label><input type="file" name="image" accept="image/*"><label class="row" style="font-weight:600"><input type="checkbox" name="available" ${it.available !== 0 ? 'checked' : ''} style="width:22px;min-height:22px"> Available</label><button class="btn block mt" type="submit">Save</button>${it.id ? `<button type="button" class="btn danger block mt2" data-act="item-del" data-id="${it.id}">Delete item</button>` : ''}</form>`); };
  PL.forms.item = async (f) => { const v = PL.form(f), file = f.image.files[0]; let image; try { if (file) image = await PL.readFile(file); } catch (x) { return PL.toast(x.message, true); }
    const b = { name: v.name, description: v.description, base_price_paise: paise(v.price), prep_time_min: +v.prep, available: !!f.available.checked, category_id: v.category ? Number(v.category) : null, image };
    const r = await PL.run(() => (f.dataset.id ? PL.put('/api/restaurant/menu/' + f.dataset.id, b) : PL.post('/api/restaurant/menu', b)), 'Saved'); if (r) { PL.closeModal(); setTimeout(PL.rerender, 80); } };
  PL.actions['item-del'] = async (el) => { if (!(await PL.confirm('Delete this item?', 'Delete'))) return; const r = await PL.run(() => PL.api('/api/restaurant/menu/' + el.dataset.id, { method: 'DELETE' }), 'Deleted'); if (r) { PL.closeModal(); setTimeout(PL.rerender, 80); } };
  PL.actions['item-avail'] = async (el) => { const it = (await PL.api('/api/restaurant/menu')).items.find((x) => x.id == el.dataset.id); await PL.run(() => PL.put('/api/restaurant/menu/' + it.id, { name: it.name, available: el.dataset.v === '1' })); PL.rerender(); };

  // ---------- earnings ----------
  async function earnings() { const d = await PL.api('/api/restaurant/earnings');
    return `${PL.balanceCards(d.balance, `<div class="stat"><div class="v">${rs(d.sales_paise)}</div><div class="l">Total sales</div></div><div class="stat"><div class="v">${rs(d.commission_paise)}</div><div class="l">Commission deducted</div></div>`)}
      <button class="btn block mt" data-act="cashout-new" data-ep="/api/restaurant/cashouts" data-methods="${e(d.methods.join(','))}" data-avail="${d.balance.available}" ${d.balance.available < 100 ? 'disabled' : ''}>Request cashout</button>
      <div class="sec">Cashouts</div>${PL.cashoutList(d.cashouts)}<div class="sec">Order earnings</div>${d.orders.map((o) => `<div class="card"><div class="row between"><span>${PL.code(o.order_code)}</span><b>${rs(o.restaurant_payout_paise)}</b></div><div class="small mute">Sales ${rs(o.items_base_paise)} − commission ${rs(o.commission_paise)} · ${PL.dt(o.updated_at)}</div></div>`).join('') || '<div class="empty">Earnings appear after orders are delivered.</div>'}`; }

  // ---------- more: search, surge, profile ----------
  async function more() { const me = await PL.api('/api/restaurant/me'); const r = me.restaurant;
    return `<div class="card row">${PL.img(r.logo_path)}<div class="grow"><h3>${e(r.name)}</h3><div class="small mute">${e(r.address || '')}</div></div></div>
      <div class="card"><h3>Find an order</h3><form data-form="osearch" class="row mt2"><input name="code" placeholder="PL20261104A1B2C3" required style="text-transform:uppercase"><button class="btn" type="submit">Search</button></form><div id="sres"></div></div>
      <button class="card row" style="width:100%;text-align:left;cursor:pointer" data-act="go" data-path="/surge"><span style="color:var(--brand)">${PL.icon('bolt')}</span><div class="grow"><b>Surge charge requests</b><div class="small mute">Ask Pakka Local to apply a surge during busy hours</div></div></button>
      <button class="card row" style="width:100%;text-align:left;cursor:pointer" data-act="edit-profile"><span style="color:var(--brand)">${PL.icon('shop')}</span><div class="grow"><b>Restaurant profile</b><div class="small mute">Name, address, contact, photos</div></div></button>${PL.push.card('restaurant')}<button class="btn ghost block mt" data-act="logout">Sign out</button>`; }
  PL.forms.osearch = async (f) => { const code = PL.form(f).code.trim().toUpperCase(); try { const { order: o } = await PL.api('/api/restaurant/orders/by-code/' + encodeURIComponent(code));
    PL.$('#sres').innerHTML = `<div class="mt2"><div class="row between">${PL.code(o.order_code)}${PL.chip(o.status)}</div>${o.items.map((i) => `<div class="kv"><span>${i.qty} × ${e(i.name)}</span></div>`).join('')}<div class="small mute">Payout ${rs(o.payout_paise)}</div>${o.events.map((x) => `<div class="small mute">${PL.dt(x.created_at)} · ${e(x.event_type.replace(/_/g, ' ').toLowerCase())}</div>`).join('')}</div>`; } catch (x) { PL.$('#sres').innerHTML = `<div class="banner bad mt2">${e(x.message)}</div>`; } };
  PL.actions['edit-profile'] = async () => { const r = (await PL.api('/api/restaurant/me')).restaurant;
    PL.modal(`<h3>Restaurant profile</h3><form data-form="profile"><label>Name</label><input name="name" value="${e(r.name)}" required><label>Cuisine</label><input name="cuisine" value="${e(r.cuisine || '')}"><label>Description</label><textarea name="description">${e(r.description || '')}</textarea><label>Address</label><input name="address" value="${e(r.address || '')}"><label>Operating information (hours, notes)</label><input name="operating_info" maxlength="200" value="${e(r.operating_info || '')}" placeholder="e.g. 11 am to 11 pm, closed Mondays"><label>Contact phone</label><input name="phone" value="${e(r.phone || '')}"><label>Logo</label><input type="file" name="logo" accept="image/*"><label>Cover photo</label><input type="file" name="image" accept="image/*"><button class="btn block mt" type="submit">Save</button></form>`); };
  PL.forms.profile = async (f) => { const v = PL.form(f); let logo, image; try { if (f.logo.files[0]) logo = await PL.readFile(f.logo.files[0], { max: 600 }); if (f.image.files[0]) image = await PL.readFile(f.image.files[0]); } catch (x) { return PL.toast(x.message, true); }
    const r = await PL.run(() => PL.put('/api/restaurant/me', { ...v, logo, image }), 'Profile saved'); if (r) { PL.closeModal(); setTimeout(PL.rerender, 80); } };
  async function surge() { const { requests } = await PL.api('/api/restaurant/surge-requests');
    return `<div class="card"><h3>Request a surge charge</h3><p class="small mute">Only charges approved and activated by Pakka Local apply to customers.</p><form data-form="surgereq"><label>Why do you need it?</label><textarea name="reason" required minlength="5" maxlength="300"></textarea><label>Suggested amount (₹, optional)</label><input name="amt" inputmode="decimal"><button class="btn block mt" type="submit">Send request</button></form></div>
      <div class="sec">Your requests</div>${requests.map((r) => `<div class="card"><div class="row between"><b>${r.requested_paise ? rs(r.requested_paise) : 'No amount given'}</b>${PL.chip(r.status)}</div><div class="small">${e(r.reason)}</div>${r.decision_note ? `<div class="small mute">Admin: ${e(r.decision_note)}</div>` : ''}<div class="small mute">${PL.dt(r.created_at)}</div></div>`).join('') || '<div class="empty">No requests yet.</div>'}`; }
  PL.forms.surgereq = async (f) => { const v = PL.form(f); const r = await PL.run(() => PL.post('/api/restaurant/surge-requests', { reason: v.reason, requested_paise: v.amt ? paise(v.amt) : undefined }), 'Request sent'); if (r) PL.rerender(); };

  PL.start({ portal: 'restaurant', name: 'Restaurant', home: '/orders', loginView: (root) => PL.staffLogin(root, { title: 'Restaurant portal', blurb: 'Manage your menu, orders and payouts.' }),
    right: () => `<button class="iconbtn" id="sbtn" data-act="sound-toggle" aria-label="Alert sound">${PL.icon(PL.sound.enabled() && PL.sound.unlocked ? 'sound' : 'mute')}</button>`,
    tabs: [{ path: '/orders', label: 'Orders', icon: 'orders' }, { path: '/menu', label: 'Menu', icon: 'menu' }, { path: '/earnings', label: 'Earnings', icon: 'wallet' }, { path: '/more', label: 'More', icon: 'gear' }],
    onReady: () => { alertTick(); const iv = setInterval(alertTick, 1000); PL.hooks.stop = [() => { clearInterval(iv); const b = PL.$('#alerts'); if (b) { b.innerHTML = ''; b.dataset.h = ''; b.classList.add('hide'); setAlertSpace(b); } }]; },
    routes: { '/orders': { title: 'Orders', render: orders, poll: 2000 }, '/order/:id': { title: 'Order', render: oneOrder, poll: 2000 }, '/menu': { title: 'Menu', render: menu }, '/earnings': { title: 'Earnings', render: earnings, poll: 5000 }, '/more': { title: 'More', render: more }, '/surge': { title: 'Surge requests', render: surge, poll: 6000 } } });
})();
