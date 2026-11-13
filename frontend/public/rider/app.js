(function () {
  const e = PL.esc, rs = PL.rs, S = PL.state; S.dismissed = new Set(); S.me = null;

  const detail = (o, full) => `<div class="row between"><div>${PL.code(o.order_code)}</div><span class="price" style="color:var(--ok)">${rs(o.fee_paise)}</span></div>
    <div class="small mute">${o.distance_km ? o.distance_km + ' km · ' : ''}${o.eta_at ? 'Customer expects ~' + PL.time(o.eta_at) : ''}</div>
    <div class="sec">Pickup</div><b>${e(o.restaurant.name)}</b><div class="small">${e(o.restaurant.address || '')}</div><div class="row wrap mt2">${PL.mapsBtn(o.restaurant.maps_link, 'Map')}${o.restaurant.phone ? `<a class="btn ghost sm" href="tel:${e(o.restaurant.phone)}">${PL.icon('phone', 'width="18" height="18"')} Call</a>` : ''}</div>
    <div class="sec">Items</div>${o.items.map((i) => `<div class="kv"><span>${i.qty} × ${e(i.name)}</span></div>`).join('')}
    <div class="sec">Drop-off</div><b>${e(o.customer.name || 'Customer')}</b><div class="small">${e(o.destination.text)}</div>${o.destination.lat != null ? `<div class="small mute">GPS ${o.destination.lat}, ${o.destination.lng}</div>` : ''}
    ${o.instructions ? `<div class="banner info mt2" style="margin-bottom:0"><b>Instructions:</b> ${e(o.instructions)}</div>` : ''}<div class="row wrap mt2">${PL.mapsBtn(o.destination.maps_link, 'Map')}<a class="btn ghost sm" href="tel:${e(o.customer.phone)}">${PL.icon('phone', 'width="18" height="18"')} Call customer</a></div>`;

  // ---------- offers: alert layer, 1s poll ----------
  async function tick() {
    let d; try { d = await PL.api('/api/rider/offers'); } catch { return; }
    S.last = d; PL.track.sync(d.active.length);      // share location only while a delivery is assigned
    const offers = d.offers.filter((o) => !S.dismissed.has(o.id)); PL.badge('/jobs', d.active.length + offers.length);
    const box = PL.$('#alerts'); if (!box) return;
    const html = offers.map((o) => `<div class="card"><div class="row between"><b>New delivery offer</b><span class="chip brand">Earn ${rs(o.fee_paise)}</span></div>${detail(o)}
      ${PL.sound.unlocked ? '' : '<button class="btn ghost block mt2" data-act="sound-on">Tap to enable alert sound</button>'}<div class="row mt2"><button class="btn ghost grow" data-act="dismiss" data-id="${o.id}">Not now</button><button class="btn grow" data-act="claim" data-id="${o.id}">Accept</button></div></div>`).join('');
    if (box.dataset.h !== html) { box.dataset.h = html; box.innerHTML = html; }
    box.classList.toggle('hide', !offers.length); PL.sound.sync(offers.length > 0);
  }
  PL.actions['sound-on'] = async () => { await PL.sound.enable(); tick(); };
  PL.actions.claim = async (el) => { const r = await PL.run(() => PL.post(`/api/rider/orders/${el.dataset.id}/accept`), 'Order accepted'); await tick(); if (r) PL.go('/jobs'); else PL.rerender(); };
  PL.actions.dismiss = async (el) => { S.dismissed.add(Number(el.dataset.id)); await PL.run(() => PL.post(`/api/rider/orders/${el.dataset.id}/dismiss`)); tick(); };

  // ---------- online switch ----------
  const sw = () => `<button class="sw ${S.me?.is_online ? 'on' : ''}" id="onl" data-act="online" aria-label="Online or offline"><span>${S.me?.is_online ? 'Online' : 'Offline'}</span><i></i></button>`;
  async function refreshMe() { try { S.me = (await PL.api('/api/rider/me')).rider; const s = PL.$('#side'); if (s) s.innerHTML = sw() + `<button class="iconbtn" data-act="sound-toggle" aria-label="Alert sound">${PL.icon(PL.sound.enabled() && PL.sound.unlocked ? 'sound' : 'mute')}</button>`; } catch {} }
  PL.actions.online = async () => { const on = !S.me?.is_online; if (on && !PL.sound.unlocked) await PL.sound.enable(); const r = await PL.run(() => PL.post('/api/rider/online', { online: on }), on ? 'You are online' : 'You are offline'); await refreshMe(); if (r) PL.rerender(); };

  // ---------- deliveries ----------
  async function jobs() {
    await refreshMe(); const d = S.last || (await PL.api('/api/rider/offers')); const act = (await PL.api('/api/rider/active')).active, me = S.me;
    const gate = me.verification_status !== 'approved' ? `<div class="banner warn">${me.verification_status === 'pending' ? 'Your account is waiting for approval by Pakka Local.' : 'Your account is ' + e(me.verification_status.replace('_', ' ')) + '.'} You can go online once approved. <button class="btn sm mt2" data-act="go" data-path="/profile">Open my profile</button></div>` : !me.is_online ? '<div class="banner info">You are offline. Switch Online (top right) to receive delivery offers.</div>' : '';
    const offers = d.offers.filter((o) => !S.dismissed.has(o.id) && !act.find((a) => a.id === o.id));
    return `${gate}${act.length ? PL.track.card() : ''}${S.push === 'on' ? '' : PL.push.card('rider')}${act.map((o) => `<div class="card" style="border-color:var(--brand)"><div class="row between"><b>Active delivery</b>${PL.chip(o.status)}</div>${detail(o)}
      ${o.status === 'ACCEPTED' || o.status === 'PREPARING' ? '<div class="banner info mt" style="margin-bottom:0">The restaurant is still preparing. You’ll get the pickup code when it’s ready.</div>' : ''}
      ${o.status === 'READY' ? `<form data-form="pickup" data-id="${o.id}" class="mt"><label>Pickup code from the restaurant</label><input name="otp" inputmode="numeric" maxlength="4" pattern="\\d{4}" required autocomplete="off"><button class="btn block mt2" type="submit">Confirm pickup</button></form>` : ''}
      ${o.status === 'PICKED_UP' ? `<form data-form="deliver" data-id="${o.id}" class="mt"><label>Delivery code from the customer</label><input name="otp" inputmode="numeric" maxlength="8" pattern="\\d{4,8}" required autocomplete="off"><button class="btn block mt2" type="submit">Complete delivery</button></form>` : ''}</div>`).join('')}
      ${offers.length ? `<div class="sec">Available offers</div>${offers.map((o) => `<div class="card">${detail(o)}<div class="row mt2"><button class="btn ghost grow" data-act="dismiss" data-id="${o.id}">Not now</button><button class="btn grow" data-act="claim" data-id="${o.id}">Accept</button></div></div>`).join('')}` : ''}
      ${!act.length && !offers.length ? `<div class="empty">${me.is_online ? 'Waiting for delivery offers…<br><span class="small">Keep this screen open for alerts.</span>' : 'No active deliveries.'}</div>` : ''}`;
  }
  PL.forms.pickup = async (f) => { const r = await PL.run(() => PL.post(`/api/rider/orders/${f.dataset.id}/pickup`, { otp: PL.form(f).otp }), 'Pickup confirmed'); if (r) PL.rerender(); };
  PL.forms.deliver = async (f) => { const r = await PL.run(() => PL.post(`/api/rider/orders/${f.dataset.id}/deliver`, { otp: PL.form(f).otp }), 'Delivered. Earnings added'); if (r) PL.rerender(); };


  // deep link target for offer notifications: shows the offer only if it is still genuinely available to this rider
  async function oneJob({ id }) {
    let d; try { d = await PL.api('/api/rider/orders/' + id); } catch { return '<div class="empty">This delivery is no longer available.<br><button class="btn mt" data-act="go" data-path="/jobs">See my deliveries</button></div>'; }
    const o = d.order; if (d.mine) return `<div class="card" style="border-color:var(--brand)"><div class="row between"><b>Your delivery</b>${PL.chip(o.status)}</div>${detail(o)}<button class="btn block mt" data-act="go" data-path="/jobs">Open delivery steps</button></div>`;
    return `<div class="card">${detail(o)}<div class="row mt2"><button class="btn ghost grow" data-act="dismiss" data-id="${o.id}">Not now</button><button class="btn grow" data-act="claim" data-id="${o.id}">Accept</button></div></div>`;
  }

  // ---------- earnings ----------
  async function earnings() { const d = await PL.api('/api/rider/earnings');
    return `${PL.balanceCards(d.balance, `<div class="stat"><div class="v">${rs(d.today_paise)}</div><div class="l">Today</div></div><div class="stat"><div class="v">${rs(d.week_paise)}</div><div class="l">Last 7 days</div></div><div class="stat"><div class="v">${d.completed_count}</div><div class="l">Completed deliveries</div></div>`)}
      <button class="btn block mt" data-act="cashout-new" data-ep="/api/rider/cashouts" data-methods="${e(d.methods.join(','))}" data-avail="${d.balance.available}" ${d.balance.available < 100 ? 'disabled' : ''}>Request cashout</button><div class="sec">Cashouts</div>${PL.cashoutList(d.cashouts)}
      <div class="sec">Completed deliveries</div>${d.deliveries.map((x) => `<div class="card row between"><div>${PL.code(x.order_code)}<div class="small mute">${PL.dt(x.created_at)}</div></div><b>${rs(x.amount_paise)}</b></div>`).join('') || '<div class="empty">No deliveries yet.</div>'}`; }

  // ---------- profile + verification ----------
  const DOCS = [['photo', 'Profile photo'], ['vehicle_photo', 'Vehicle photo'], ['rc', 'Registration certificate (RC)'], ['licence', 'Driving licence'], ['insurance', 'Insurance (if applicable)']];
  async function profile() { const { profile: p } = await PL.api('/api/rider/profile'); const me = (await PL.api('/api/rider/me')).rider;
    return `<div class="card"><div class="row between"><h3>Verification</h3>${PL.chip(p.verification_status)}</div>${p.history[0]?.note ? `<div class="banner warn mt2" style="margin-bottom:0">Admin note: ${e(p.history[0].note)}</div>` : ''}${!me.profile_complete ? '<p class="small mute mt2">Complete your vehicle details and upload your documents so Pakka Local can approve you.</p>' : ''}</div>
      <div class="card"><h3>Vehicle and personal details</h3><form data-form="vehicle"><label>Email (optional)</label><input name="email" type="email" autocomplete="email" value="${e(p.email || '')}"><label>Residential address</label><input name="address" value="${e(p.address || '')}" required minlength="5"><label>Emergency contact number</label><input name="emergency_phone" value="${e(p.emergency_phone || '')}" inputmode="tel" required>
        <label>Vehicle type</label><select name="vehicle_category">${['Motorcycle', 'Scooter', 'Electric Scooter', 'Other'].map((c) => `<option ${p.vehicle_category === c ? 'selected' : ''}>${c}</option>`).join('')}</select><div class="grid g2"><div><label>Manufacturer</label><input name="vehicle_make" value="${e(p.vehicle_make || '')}" required></div><div><label>Model</label><input name="vehicle_model" value="${e(p.vehicle_model || '')}" required></div></div>
        <label>Registration number</label><input name="vehicle_reg_no" value="${e(p.vehicle_reg_no || '')}" required minlength="5" style="text-transform:uppercase"><label>Driving licence number</label><input name="licence_no" value="${e(p.licence_no || '')}" required><label>Insurance policy number</label><input name="insurance_no" value="${e(p.insurance_no || '')}"><button class="btn block mt" type="submit">Save details</button></form></div>
      <div class="card"><h3>Documents</h3><p class="small mute">Private. Only you and Pakka Local admins can see them.</p>${DOCS.map(([k, l]) => `<form data-form="doc" data-kind="${k}" class="mt2"><div class="row between"><b class="small">${l}</b>${p.docs[k] ? '<span class="chip ok">Uploaded</span>' : '<span class="chip warn">Missing</span>'}</div><input type="file" name="f" accept="image/*,application/pdf" required><button class="btn ghost sm mt2" type="submit">${p.docs[k] ? 'Replace' : 'Upload'}</button></form>`).join('')}</div>
      ${PL.push.card('rider')}<button class="btn ghost block" data-act="logout">Sign out</button>`; }
  PL.forms.vehicle = async (f) => { const r = await PL.run(() => PL.put('/api/rider/profile', PL.form(f)), 'Details saved'); if (r) PL.rerender(); };
  PL.forms.doc = async (f) => { let data; try { data = await PL.readFile(f.f.files[0]); } catch (x) { return PL.toast(x.message, true); }
    const r = await PL.run(() => PL.post('/api/rider/documents', { kind: f.dataset.kind, data }), 'Uploaded'); if (r) PL.rerender(); };

  PL.start({ portal: 'rider', name: 'Rider', home: '/jobs', loginView: (root) => PL.staffLogin(root, { title: 'Delivery partner', blurb: 'Sign in with the account Pakka Local created for you.' }),
    right: () => '',
    tabs: [{ path: '/jobs', label: 'Deliveries', icon: 'bike' }, { path: '/earnings', label: 'Earnings', icon: 'wallet' }, { path: '/profile', label: 'Profile', icon: 'user' }],
    onReady: () => { refreshMe(); tick(); const a = setInterval(tick, 1000), b = setInterval(refreshMe, 15000); PL.hooks.stop = [() => { PL.track.stop(); clearInterval(a); clearInterval(b); const x = PL.$('#alerts'); if (x) { x.innerHTML = ''; x.dataset.h = ''; x.classList.add('hide'); } }]; },
    routes: { '/jobs': { title: 'Deliveries', render: jobs, poll: 2000 }, '/job/:id': { title: 'Delivery', render: oneJob, poll: 2000 }, '/earnings': { title: 'Earnings', render: earnings, poll: 6000 }, '/profile': { title: 'Profile', render: profile } } });
})();
