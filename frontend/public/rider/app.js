(function () {
  const e = PL.esc, rs = PL.rs, S = PL.state; S.dismissed = new Set(); S.me = null;

  const detail = (o, full) => `<div class="row between"><div>${PL.code(o.order_code)}</div><span class="price" style="color:var(--ok)">${rs(o.fee_paise)}</span></div>
    <div class="small mute">${o.distance_km ? o.distance_km + ' km · ' : ''}${o.eta_at ? 'Customer expects ~' + PL.time(o.eta_at) : ''}</div>
    <div class="sec">Pickup</div><b>${e(o.restaurant.name)}</b><div class="small">${e(o.restaurant.address || '')}</div><div class="row wrap mt2">${PL.mapsBtn(o.restaurant.maps_link, 'Map')}${o.restaurant.phone ? `<a class="btn ghost sm" href="tel:${e(o.restaurant.phone)}">${PL.icon('phone', 'width="18" height="18"')} Call</a>` : ''}</div>
    <div class="sec">Items</div>${o.items.map((i) => `<div class="kv"><span>${i.qty} × ${e(i.name)}</span></div>`).join('')}
    <div class="sec">Drop-off</div>${o.destination.area_only ? `<b>${e(o.destination.text)}</b><div class="small mute">Exact address, phone number and instructions appear after you accept.</div>`
      : destCard(o)}`;
  // Assigned delivery: where exactly to go. Coordinates and the navigation link come only from the server for the assigned rider.
  function destCard(o) { const d = o.destination, cell = (v, l) => (v ? `<div><b>${e(v)}</b><span>${l}</span></div>` : '');
    const line = (ic, label, v) => (v ? `<div class="dest-line">${PL.icon(ic, 'width="18" height="18"')}<div><span class="small mute">${label}</span><div>${e(v)}</div></div></div>` : '');
    const has = d.lat != null && d.lng != null, coords = has ? `${(+d.lat).toFixed(6)},${(+d.lng).toFixed(6)}` : '';
    return `<div class="dest-card"><div class="small mute">${e(o.customer.name || 'Customer')}${d.label ? ' · ' + e({ home: 'Home', hostel: 'Hostel', pg: 'PG', college: 'College', other: 'Other' }[d.label] || d.label) : ''}</div>
      <div class="place">${e(d.place_name || d.building || d.text || 'Customer location')}</div>${d.place_name && d.building ? `<div class="small">${e(d.building)}</div>` : ''}
      ${d.block || d.floor || d.room ? `<div class="dest-grid">${cell(d.block, 'Block')}${cell(d.floor, 'Floor')}${cell(d.room, 'Room')}</div>` : ''}
      ${line('pin', 'Gate / entrance', d.entrance)}${line('shop', 'Landmark', d.landmark)}${line('bell', 'Instructions', o.instructions)}
      ${d.nav_url ? `<a class="btn block nav-btn" href="${e(d.nav_url)}" target="_blank" rel="noopener" data-nav>${PL.icon('pin')} NAVIGATE IN GOOGLE MAPS</a>`
        : '<div class="banner warn mt2" style="margin-bottom:0">This order has no usable GPS point. Call the customer for directions.</div>'}
      ${has ? `<div class="coords"><span>GPS ${coords}${d.accuracy_m != null ? ` · ±${Math.round(d.accuracy_m)} m` : ''}</span><span class="row" style="gap:4px"><button class="copy" data-act="copy" data-v="${coords}">Copy GPS</button>${d.nav_url ? `<button class="copy" data-act="copy" data-v="${e(d.nav_url)}">Copy link</button>` : ''}</span></div>` : ''}
      ${o.customer.phone ? `<a class="btn ghost block mt2" href="tel:${e(o.customer.phone)}">${PL.icon('phone', 'width="18" height="18"')} Call customer</a>` : ''}</div>`; }

  // ---------- offers: alert layer, 1s poll ----------
  // One offer card at a time, docked above the bottom navigation (same queue layout as the restaurant portal).
  // Every open offer stays in the queue and in "Available offers" on the Deliveries tab; the queue only changes which one is shown.
  let curId = null, collapsed = false;
  const setAlertSpace = (box) => document.documentElement.style.setProperty('--alert-h', box.classList.contains('hide') ? '0px' : box.offsetHeight + 'px');
  const brief = (o) => `<div class="row between mt2 wrap">${PL.code(o.order_code)}<b class="price" style="color:var(--ok)">${rs(o.fee_paise)}</b></div>
    <div class="small mute">${o.distance_km ? o.distance_km + ' km · ' : ''}${o.eta_at ? 'Customer expects ~' + PL.time(o.eta_at) : ''}</div>
    <div class="rq-items"><div class="kv"><span class="mute small">Pickup</span><span class="right"><b>${e(o.restaurant.name)}</b><br><span class="small">${e(o.restaurant.address || '')}</span></span></div>
    <div class="kv"><span class="mute small">Drop-off</span><span class="right small">${e(o.destination.text || '')}</span></div>
    <div class="kv"><span class="mute small">Items</span><span class="right small">${o.items.map((i) => `${i.qty} × ${e(i.name)}`).join(', ')}</span></div></div>
    <div class="small mute">Maps, phone numbers and instructions are on the Deliveries tab.</div>`;
  async function tick() {
    let d; try { d = await PL.api('/api/rider/offers'); } catch { return; }
    S.last = d; PL.track.sync(d.active.length);      // share location only while a delivery is assigned
    const offers = d.offers.filter((o) => !S.dismissed.has(o.id)); PL.badge('/jobs', d.active.length + offers.length);
    const box = PL.$('#alerts'); if (!box) return;
    box.classList.add('rq');
    let i = offers.findIndex((o) => o.id === curId); if (i < 0) i = 0;
    const o = offers[i], n = offers.length; curId = o ? o.id : null; if (!o) collapsed = false;
    const html = !o ? '' : collapsed
      ? `<div class="card rq-bar" role="status"><span class="dot"></span><b class="grow">${n} delivery offer${n > 1 ? 's' : ''} waiting</b><button class="btn sm" data-act="rq-expand">Show</button></div>`
      : `<div class="card" role="alertdialog" aria-label="Delivery offer ${i + 1} of ${n}">
      <div class="row between"><b>${n > 1 ? `New offer <span class="mute">· ${i + 1} of ${n}</span>` : 'New delivery offer'}</b><div class="row" style="gap:4px">${n > 1 ? `<button class="iconbtn" data-act="rq-prev" aria-label="Previous offer" ${i === 0 ? 'disabled' : ''}>‹</button><button class="iconbtn" data-act="rq-next" aria-label="Next offer" ${i === n - 1 ? 'disabled' : ''}>›</button>` : ''}<button class="iconbtn" data-act="rq-collapse" aria-label="Minimise alert" title="Minimise">${PL.icon('x')}</button></div></div>
      ${n > 1 ? `<div class="rq-list" role="tablist">${offers.map((p, k) => `<button role="tab" aria-selected="${k === i}" class="${k === i ? 'on' : ''}" data-act="rq-pick" data-id="${p.id}">${e(String(p.order_code).slice(-6))} · ${rs(p.fee_paise)}</button>`).join('')}</div>` : ''}
      ${brief(o)}
      ${PL.sound.unlocked ? '' : '<button class="btn ghost sm block mt2" data-act="sound-on">Tap to enable alert sound</button>'}<div class="row mt2"><button class="btn ghost grow" data-act="dismiss" data-id="${o.id}">Not now</button><button class="btn grow" data-act="claim" data-id="${o.id}">Accept</button></div></div>`;
    if (box.dataset.h !== html) { box.dataset.h = html; box.innerHTML = html; }
    box.classList.toggle('hide', !n); setAlertSpace(box); PL.sound.sync(n > 0);
  }
  const move = (dlt) => { const offers = (S.last?.offers || []).filter((o) => !S.dismissed.has(o.id)); const i = offers.findIndex((o) => o.id === curId); const nx = offers[Math.min(offers.length - 1, Math.max(0, i + dlt))]; if (nx) curId = nx.id; tick(); };
  PL.actions['rq-prev'] = () => move(-1);
  PL.actions['rq-next'] = () => move(1);
  PL.actions['rq-pick'] = (el) => { curId = Number(el.dataset.id); tick(); };
  PL.actions['rq-collapse'] = () => { collapsed = true; tick(); };
  PL.actions['rq-expand'] = () => { collapsed = false; tick(); };
  addEventListener('resize', () => { const b = PL.$('#alerts'); if (b) setAlertSpace(b); });
  PL.actions['sound-on'] = async () => { await PL.sound.enable(); tick(); };
  PL.actions.claim = async (el) => { const r = await PL.run(() => PL.post(`/api/rider/orders/${el.dataset.id}/accept`), 'Order accepted'); await tick(); if (r) PL.go('/jobs'); else PL.rerender(); };
  PL.actions.dismiss = async (el) => { S.dismissed.add(Number(el.dataset.id)); await PL.run(() => PL.post(`/api/rider/orders/${el.dataset.id}/dismiss`)); tick(); };

  // ---------- online switch ----------
  const sw = () => (S.me && !S.me.can_take_orders ? '' : `<button class="sw ${S.me?.is_online ? 'on' : ''}" id="onl" data-act="online" aria-label="Online or offline"><span>${S.me?.is_online ? 'Online' : 'Offline'}</span><i></i></button>`);
  async function refreshMe() { try { S.me = (await PL.api('/api/rider/me')).rider; const s = PL.$('#side'); if (s) s.innerHTML = sw() + `<button class="iconbtn" data-act="sound-toggle" aria-label="Alert sound">${PL.icon(PL.sound.enabled() && PL.sound.unlocked ? 'sound' : 'mute')}</button>`; } catch {} }
  PL.actions.online = async () => { const on = !S.me?.is_online; if (on && !PL.sound.unlocked) await PL.sound.enable(); const r = await PL.run(() => PL.post('/api/rider/online', { online: on }), on ? 'You are online' : 'You are offline'); await refreshMe(); if (r) PL.rerender(); };

  // ---------- deliveries ----------
  async function jobs() {
    await refreshMe(); const d = S.last || (await PL.api('/api/rider/offers')); const act = (await PL.api('/api/rider/active')).active, me = S.me;
    const vs = me.verification_status, gate = vs !== 'approved' ? `<div class="card status-card st-${vs}"><b>${e(PL.LABEL[vs] || vs)}</b>
      <p class="small mt2">${{ draft: `Finish your application to start delivering.${me.missing_count ? ` ${me.missing_count} item${me.missing_count > 1 ? 's' : ''} still needed.` : ''}`, pending: 'Pakka Local is checking your application. You cannot receive deliveries until it is approved.', corrections_requested: 'Pakka Local asked you to correct some details.', reverification_required: 'Please update your application. You can finish deliveries you already have, but you will not get new ones until it is approved.', rejected: 'Your application was not approved.', suspended: 'Your account is suspended. Contact Pakka Local.' }[vs] || ''}</p>
      ${['draft', 'corrections_requested', 'reverification_required'].includes(vs) ? '<button class="btn sm mt2" data-act="go" data-path="/profile">Continue my application</button>' : vs === 'pending' ? '<button class="btn ghost sm mt2" data-act="go" data-path="/profile">View my application</button>' : ''}</div>` : !me.is_online ? '<div class="banner info">You are offline. Switch Online (top right) to receive delivery offers.</div>' : '';
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

  // ---------- application + verification (saved on the server as you type; resume any time) ----------
  const STEPS = [['personal', 'Personal details'], ['identity', 'Identity'], ['vehicle', 'Vehicle and licence'], ['payout', 'Payout'], ['review', 'Review and submit']];
  const STATUS_TEXT = {
    draft: 'Fill in every section and submit. Your progress is saved automatically, so you can stop and come back later.',
    pending: 'Thank you. Pakka Local is checking your documents. You will get delivery offers only after approval.',
    approved: 'You are verified. Go online from the Deliveries tab to receive delivery offers.',
    corrections_requested: 'Pakka Local asked you to correct the items marked below. Update them and submit again.',
    rejected: 'Your application was not approved. Contact Pakka Local if you think this is a mistake.',
    suspended: 'Your account is suspended. Contact Pakka Local.',
    reverification_required: 'We now need a few more details from every delivery partner. You can finish deliveries you already have, but you will not get new ones until you complete this and Pakka Local approves it.' };
  let A = null;    // last application snapshot
  const fixes = () => new Set(A?.correction_fields || []);
  const lbl = (key, text) => `<label for="f-${key}">${text}${fixes().has(key) ? ' <span class="chip warn">Needs correction</span>' : ''}</label>`;
  const inp = (key, text, v, attrs = '') => `${lbl(key, text)}<input id="f-${key}" name="${key}" value="${e(v ?? '')}" ${attrs} ${A.editable ? '' : 'disabled'}>`;
  const docRow = (kind, opt) => { const have = A.docs[kind], label = (S.docLabels || {})[kind] || kind;
    return `<div class="doc ${fixes().has(kind) ? 'fix' : ''}"><div class="grow"><b class="small">${e(label)}${opt ? ' <span class="mute">(optional)</span>' : ''}</b><div class="small ${have ? 'ok-t' : 'mute'}">${have ? 'Uploaded' : 'Not uploaded yet'}${fixes().has(kind) ? ' · needs correction' : ''}</div></div>
      ${have ? `<button type="button" class="btn ghost sm" data-act="doc-view" data-kind="${kind}">View</button>` : ''}
      ${A.editable ? `<label class="btn sm ${have ? 'ghost' : ''}" style="margin:0">${have ? 'Replace' : 'Upload'}<input type="file" hidden data-doc="${kind}" accept="${kind === 'photo' || kind === 'vehicle_photo' ? 'image/*' : 'image/*,application/pdf'}"></label>` : ''}</div>`; };
  const stepDone = (key) => !A.missing.some((m) => m.section === key);
  async function profile({ step } = {}) {
    const d = await PL.api('/api/rider/application'); A = d.application; S.docLabels = d.doc_labels; S.idTypes = d.id_types; S.vehicles = d.vehicles;
    const cur = STEPS.find(([k]) => k === step) ? step : (A.missing[0]?.section || 'review'), total = 19, left = A.missing.length, pct = Math.round(100 * Math.max(0, total - left) / total);
    const motor = A.vehicle_category && A.vehicle_category !== 'Bicycle', two = A.id_type === 'aadhaar' || A.id_type === 'voter_id';
    const head = `<div class="card status-card st-${A.status}"><div class="row between wrap"><div><div class="small mute">Verification status</div><h2>${e(PL.LABEL[A.status] || A.status)}</h2></div>${PL.chip(A.status)}</div>
      <p class="small mt2">${STATUS_TEXT[A.status] || ''}</p>${A.decision_note && A.status !== 'approved' ? `<div class="banner warn mt2" style="margin-bottom:0"><b>Message from Pakka Local:</b> ${e(A.decision_note)}</div>` : ''}
      ${A.editable ? `<div class="progress mt"><i style="width:${pct}%"></i></div><div class="small mute mt2">${left ? `${left} item${left > 1 ? 's' : ''} still needed` : 'Everything is filled in. Review and submit.'}</div>` : ''}
      ${A.problems.length ? `<div class="banner bad mt2" style="margin-bottom:0">${A.problems.map(e).join('<br>')}</div>` : ''}</div>`;
    const nav = `<div class="steps" role="tablist">${STEPS.map(([k, l], i) => `<button role="tab" aria-selected="${k === cur}" class="${k === cur ? 'on' : ''} ${stepDone(k) ? 'done' : ''}" data-act="go" data-path="/profile/${k}"><span class="n">${stepDone(k) ? '✓' : i + 1}</span>${l}</button>`).join('')}</div>`;
    const missingHere = A.missing.filter((m) => m.section === cur);
    const pending = missingHere.length && A.editable ? `<div class="banner info">Still needed here: ${missingHere.map((m) => e(m.label)).join(', ')}</div>` : '';
    const sec = {
      personal: `<form data-form="app" class="autosave"><h3>Personal details</h3>${inp('legal_name', 'Full legal name (as on your ID)', A.legal_name, 'autocomplete="name" maxlength="80"')}
        <div class="grid g2"><div>${inp('date_of_birth', 'Date of birth', A.date_of_birth, 'type="date"')}</div><div>${inp('emergency_phone', 'Emergency contact number', A.emergency_phone, 'inputmode="tel" maxlength="16"')}</div></div>
        ${lbl('address', 'Current address with PIN code')}<textarea id="f-address" name="address" maxlength="300" ${A.editable ? '' : 'disabled'}>${e(A.address || '')}</textarea>
        ${inp('email', 'Email (optional)', A.email, 'type="email" autocomplete="email"')}</form>
        <div class="card flat mt"><div class="row between wrap"><div><b>Mobile number</b><div class="small mute">${e(A.phone)}</div></div>${A.phone_verified ? '<span class="chip ok">Verified</span>' : A.editable ? '<button class="btn sm" data-act="phone-code">Send code</button>' : '<span class="chip warn">Not verified</span>'}</div>
        ${!A.phone_verified && A.editable ? `<form data-form="phone-verify" class="row mt2"><input name="otp" inputmode="numeric" maxlength="6" placeholder="6-digit code" autocomplete="one-time-code" required><button class="btn" type="submit">Verify</button></form>` : ''}</div>
        <div class="mt">${docRow('photo')}</div><p class="small mute">A clear, recent photo of your face. Customers see it only after you pick up their order.</p>`,
      identity: `<form data-form="app" class="autosave"><h3>Identity</h3>${lbl('id_type', 'Identity document')}<select id="f-id_type" name="id_type" ${A.editable ? '' : 'disabled'}><option value="">Choose a document</option>${Object.entries(S.idTypes).map(([k, l]) => `<option value="${k}" ${A.id_type === k ? 'selected' : ''}>${e(l)}</option>`).join('')}</select>
        ${inp('id_last4', 'Last 4 characters of the document number', A.id_last4, 'maxlength="4" autocomplete="off" style="max-width:160px;text-transform:uppercase"')}
        <p class="small mute">We store only the last 4 characters, never the full number. For Aadhaar, upload a <b>masked</b> copy (first 8 digits hidden); you can download one from the UIDAI website.</p></form>
        <div class="mt">${docRow('id_front')}${two ? docRow('id_back') : ''}</div>`,
      vehicle: `<form data-form="app" class="autosave"><h3>Vehicle and licence</h3>${lbl('vehicle_category', 'Vehicle type')}<select id="f-vehicle_category" name="vehicle_category" ${A.editable ? '' : 'disabled'}><option value="">Choose</option>${S.vehicles.map((v) => `<option ${A.vehicle_category === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
        ${motor ? `<div class="grid g2"><div>${inp('vehicle_make', 'Manufacturer', A.vehicle_make, 'maxlength="40"')}</div><div>${inp('vehicle_model', 'Model', A.vehicle_model, 'maxlength="40"')}</div></div>
        ${inp('vehicle_reg_no', 'Registration number', A.vehicle_reg_no, 'maxlength="16" style="text-transform:uppercase" placeholder="TS 09 AB 1234"')}
        <div class="grid g2"><div>${inp('licence_no', 'Driving licence number', A.licence_no, 'maxlength="20" style="text-transform:uppercase"')}</div><div>${inp('licence_expiry', 'Licence valid until', A.licence_expiry, 'type="date"')}</div></div>
        ${inp('insurance_no', 'Insurance policy number (optional)', A.insurance_no, 'maxlength="30"')}` : A.vehicle_category === 'Bicycle' ? '<p class="small mute">No driving licence or registration is needed for a bicycle.</p>' : ''}</form>
        <div class="mt">${docRow('vehicle_photo')}${motor ? docRow('rc') + docRow('licence') + docRow('insurance', true) : ''}</div>`,
      payout: `<form data-form="app" class="autosave"><h3>Payout details</h3><p class="small mute">Where Pakka Local sends your earnings. Stored encrypted; only the last digits are shown here.</p>
        <div class="seg">${[['upi', 'UPI ID'], ['bank', 'Bank account']].map(([k, l]) => `<label class="${A.payout_method === k ? 'on' : ''}"><input type="radio" name="payout_method" value="${k}" ${A.payout_method === k ? 'checked' : ''} ${A.editable ? '' : 'disabled'}> ${l}</label>`).join('')}</div>
        ${A.payout_method === 'upi' ? `${A.payout_upi_hint ? `<p class="small">Saved: <b>${e(A.payout_upi_hint)}</b></p>` : ''}${inp('payout_upi', A.payout_upi_hint ? 'Change UPI ID' : 'UPI ID', '', 'autocomplete="off" placeholder="name@bank"')}` : ''}
        ${A.payout_method === 'bank' ? `${inp('bank_holder', 'Account holder name', A.bank_holder, 'maxlength="80"')}${A.bank_account_last4 ? `<p class="small">Saved account ending <b>${e(A.bank_account_last4)}</b></p>` : ''}
          ${inp('bank_account', A.bank_account_last4 ? 'Change account number' : 'Account number', '', 'inputmode="numeric" autocomplete="off" maxlength="18"')}${inp('bank_ifsc', 'IFSC code', A.bank_ifsc, 'maxlength="11" style="text-transform:uppercase"')}` : ''}</form>`,
      review: `<h3>Review and submit</h3>${A.missing.length ? `<div class="banner warn">Complete these before submitting:<ul class="miss">${A.missing.map((m) => `<li><a href="#/profile/${m.section}">${e(m.label)}</a></li>`).join('')}</ul></div>` : '<div class="banner ok">All required details and documents are in.</div>'}
        <dl class="summary">${[['Name', A.legal_name], ['Date of birth', A.date_of_birth], ['Mobile', A.phone + (A.phone_verified ? ' (verified)' : '')], ['Identity', A.id_type ? `${S.idTypes[A.id_type]} ending ${A.id_last4 || '—'}` : ''], ['Vehicle', [A.vehicle_category, A.vehicle_make, A.vehicle_model, A.vehicle_reg_no].filter(Boolean).join(' · ')], ['Licence', A.licence_no ? `${A.licence_no}, valid until ${A.licence_expiry || '—'}` : ''], ['Payout', A.payout_method === 'upi' ? A.payout_upi_hint : A.payout_method === 'bank' ? `${A.bank_holder || ''} · account ending ${A.bank_account_last4 || '—'} · ${A.bank_ifsc || ''}` : '']].map(([k, v]) => `<dt>${k}</dt><dd>${e(v || '—')}</dd>`).join('')}</dl>
        ${A.editable ? `<form data-form="app" class="autosave"><label class="check"><input type="checkbox" name="consent" ${A.consent ? 'checked' : ''}> I confirm these details and documents are true and mine, and I agree that Pakka Local may check them for verification.</label></form>
        <button class="btn block mt" data-act="app-submit" ${A.missing.length || A.problems.length ? 'disabled' : ''}>${A.status === 'draft' ? 'Submit for verification' : 'Submit again'}</button>` : ''}`
    };
    const hist = d.history.length ? `<div class="sec">History</div><div class="card">${d.history.map((h) => `<div class="hist"><div class="row between wrap">${PL.chip(h.status)}<span class="small mute">${PL.dt(h.created_at)}</span></div>${h.note ? `<div class="small mt2">${e(h.note)}</div>` : ''}</div>`).join('')}</div>` : '';
    return `${head}${A.editable || A.status === 'pending' ? nav : ''}${A.editable || A.status === 'pending' ? `<div class="card app-sec">${pending}${sec[cur]}${A.editable ? `<div class="row between mt"><span class="small mute" id="savest">${A.updated_at ? 'Saved ' + PL.dt(A.updated_at) : ''}</span>${cur !== 'review' ? `<button class="btn ghost sm" data-act="go" data-path="/profile/${STEPS[STEPS.findIndex(([k]) => k === cur) + 1][0]}">Next ›</button>` : ''}</div>` : ''}</div>` : ''}
      ${hist}${PL.push.card('rider')}<button class="btn ghost block" data-act="logout">Sign out</button>`;
  }
  // autosave: every change in an application form is sent straight away (only the changed field)
  const saveField = async (f, el) => { const st = PL.$('#savest'); if (st) st.textContent = 'Saving…';
    const v = el.type === 'checkbox' ? el.checked : el.value.trim(); if ((el.name === 'payout_upi' || el.name === 'bank_account') && !v) { if (st) st.textContent = ''; return; }
    try { const r = await PL.put('/api/rider/application', { [el.name]: v }); A = r.application; el.closest('.app-sec')?.classList.remove('err'); if (st) st.textContent = 'Saved just now';
      if (['payout_method', 'vehicle_category', 'id_type', 'payout_upi', 'bank_account', 'consent'].includes(el.name)) PL.rerender(); }
    catch (x) { if (st) st.textContent = ''; PL.toast(x.message, true); el.focus(); } };
  document.addEventListener('change', (ev) => { const el = ev.target; const f = el.closest('form.autosave'); if (f && el.name) return saveField(f, el);
    if (el.dataset?.doc) upload(el); });
  PL.forms.app = () => {};
  async function upload(el) { let data; try { data = await PL.readFile(el.files[0], { max: 1800 }); } catch (x) { return PL.toast(x.message, true); }
    const r = await PL.run(() => PL.post('/api/rider/application/documents', { kind: el.dataset.doc, data }), 'Uploaded'); if (r) PL.rerender(); }
  PL.actions['doc-view'] = (el) => PL.openDoc(`/api/files/rider-doc/${PL.session().user.id}/${el.dataset.kind}`);
  PL.actions['phone-code'] = async () => { const r = await PL.run(() => PL.post('/api/rider/application/phone/request'), 'Code sent to your mobile number'); if (r) PL.$('[name=otp]')?.focus(); };
  PL.forms['phone-verify'] = async (f) => { const r = await PL.run(() => PL.post('/api/rider/application/phone/verify', { otp: PL.form(f).otp }), 'Mobile number verified'); if (r) PL.rerender(); };
  PL.actions['app-submit'] = async () => { if (!(await PL.confirm('Submit your application for verification? You cannot edit it while it is being reviewed.', 'Submit'))) return;
    const r = await PL.run(() => PL.post('/api/rider/application/submit'), 'Submitted for verification'); if (r) PL.go('/profile'); };

  PL.start({ portal: 'rider', name: 'Rider', home: '/jobs', loginView: (root) => PL.staffLogin(root, { title: 'Delivery partner', blurb: 'Sign in with the account Pakka Local created for you.' }),
    right: () => '',
    tabs: [{ path: '/jobs', label: 'Deliveries', icon: 'bike' }, { path: '/earnings', label: 'Earnings', icon: 'wallet' }, { path: '/profile', label: 'Account', icon: 'user' }],
    onReady: () => { refreshMe(); tick(); const a = setInterval(tick, 1000), b = setInterval(refreshMe, 15000); PL.hooks.stop = [() => { PL.track.stop(); clearInterval(a); clearInterval(b); const x = PL.$('#alerts'); if (x) { x.innerHTML = ''; x.dataset.h = ''; x.classList.add('hide'); setAlertSpace(x); } }]; },
    routes: { '/jobs': { title: 'Deliveries', render: jobs, poll: 2000 }, '/job/:id': { title: 'Delivery', render: oneJob, poll: 2000 }, '/earnings': { title: 'Earnings', render: earnings, poll: 6000 }, '/profile': { title: 'My application', render: profile }, '/profile/:step': { title: 'My application', render: profile } } });
})();
