(function () {
  const e = PL.esc, rs = PL.rs, S = PL.state; S.dismissed = new Set(); S.me = null;
  try { localStorage.setItem('pl.sound', '1'); } catch {}      // riders always get the new-offer sound (no mute button)
  // Pakka Rider Android app: tell the native side when the rider is online / on a delivery, so offers, ringing,
  // the floating side icon and delivery location keep working while the app is in the background.
  // In a normal browser there is no native side and nothing happens.
  const RN = () => (window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.RiderNative) || null;
  // Offer ringing: in the Pakka Rider app (1.11+) the phone's own ringer plays at alarm volume, loops and vibrates until
  // Accept / Not now (same sound as on the lock screen). Older apps and the browser use the page sound.
  let ringNative = null, ringWant = null;
  const ringFor = (on) => { const p = RN();
    if (!p || ringNative === false) { PL.sound.sync(on); return; }
    if (on === ringWant && ringNative) return; ringWant = on;
    p.ring({ on }).then((r) => { ringNative = r?.ok ? true : null; PL.sound.sync(ringNative ? false : on); if (!ringNative) ringWant = null; })
      .catch(() => { ringNative = false; PL.sound.sync(on); }); };
  let nsig = '';
  // ---------- in-app update (Pakka Rider APK) ----------
  // On every app start the app compares its own version with /rider-app/latest.json. If a newer APK is there it offers
  // "Download update": the app downloads it and Android shows its normal "Update" screen (no uninstall, sign-in kept).
  // required: true in latest.json hides "Later" so the rider must update before continuing.
  const upd = { busy: false, shown: false };
  const updBox = (L, cur) => `<div class="cf upd"><span class="cf-ic" style="background:none"><img src="/assets/icon-192.png" alt="" width="56" height="56" style="border-radius:14px"></span>
      <h3>${L.required ? 'Update required' : 'Update available'}</h3><p class="small mute">Pakka Rider ${e(L.versionName)} is ready (you have ${e(cur.versionName || 'an older version')}).${L.required ? ' Please update to continue.' : ''}</p>
      ${L.notes?.length ? `<ul class="upd-notes">${L.notes.map((n) => `<li>${e(n)}</li>`).join('')}</ul>` : ''}
      <div class="upd-bar hide" id="upd-bar"><i id="upd-fill"></i></div><p class="small mute hide" id="upd-msg"></p></div>
    <button class="btn block lg mt" id="upd-go" data-act="upd-go">${PL.icon('refresh')} Download update</button>${L.required ? '' : '<button class="btn ghost block mt2" data-act="close-modal">Later</button>'}
    <p class="small mute mt2" style="text-align:center">Android will ask you to confirm <b>Update</b>. You stay signed in.</p>`;
  const checkUpdate = async () => {
    const rn = RN(); if (!rn || upd.shown) return;
    // v1.8 and older have no updater inside: they still get the box, and the download opens in the phone's browser
    let cur; try { cur = typeof rn.appInfo === 'function' ? await rn.appInfo() : null; } catch { cur = null; }
    if (!cur) cur = { versionCode: 9, versionName: '', old: true };
    let L; try { L = await (await fetch('/rider-app/latest.json', { cache: 'no-store' })).json(); } catch { return; }
    if (!L?.versionCode || !L.url || !(L.versionCode > (cur.versionCode || 0))) return;
    L.required = true;      // every update is required: no 'Later' (riders must be on the latest app to take deliveries)
    upd.shown = true; upd.L = L; upd.cur = cur;
    const open = () => PL.modal(updBox(L, cur), { cls: 'upd-ov', onClose: () => { if (L.required) setTimeout(open, 300); else upd.shown = false; } });
    open();
  };
  PL.actions['upd-go'] = async () => { const rn = RN(); if (!rn || upd.busy) return;
    const go = PL.$('#upd-go'), bar = PL.$('#upd-bar'), fill = PL.$('#upd-fill'), msg = PL.$('#upd-msg');
    if (upd.cur.old) {      // older app: a www. link leaves the app, so the phone's browser downloads the APK
      location.href = 'https://www.pakkalocal.online' + new URL(upd.L.url, location.origin).pathname;
      if (msg) { msg.innerHTML = 'Your browser is downloading the update. When it finishes, tap <b>Open</b>, then <b>Update</b>. If Android asks, allow installs from your browser.'; msg.classList.remove('hide'); }
      if (go) go.innerHTML = `${PL.icon('refresh')} Download again`; return; }
    upd.busy = true;
    if (go) { go.disabled = true; go.textContent = 'Downloading…'; } bar?.classList.remove('hide'); msg?.classList.add('hide');
    const h = await rn.addListener('updateProgress', (d) => { if (fill && d.pct >= 0) fill.style.width = d.pct + '%'; if (go && d.pct >= 0) go.textContent = `Downloading… ${d.pct}%`; });
    try { await rn.installUpdate({ url: new URL(upd.L.url, location.origin).href }); if (go) go.innerHTML = `${PL.icon('check')} Tap “Update” on the Android screen`; }
    catch (x) { const need = x?.code === 'NEED_PERMISSION'; if (msg) { msg.textContent = need ? 'Turn on “Allow from this source” for Pakka Rider, come back, then tap Download update again.' : (x?.message || 'Download failed. Check your internet and try again.'); msg.classList.remove('hide'); }
      if (go) { go.disabled = false; go.innerHTML = `${PL.icon('refresh')} Download update`; } bar?.classList.add('hide'); }
    finally { h?.remove?.(); upd.busy = false; } };
  setTimeout(checkUpdate, 1500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !upd.shown) checkUpdate(); });
  PL.hooks.beforeLogout = async () => { if (S.fcmTok) { await PL.post('/api/push/fcm/remove', { token: S.fcmTok }).catch(() => {}); S.fcmTok = S.fcmSent = null; } };      // this phone stops getting this rider's pushes
  // "Background check" (app only): what the phone allows, with a button to fix each item. Read from Android, nothing is guessed.
  const MAKERS = { xiaomi: 'Xiaomi / Redmi / POCO', redmi: 'Redmi', poco: 'POCO', oppo: 'OPPO', realme: 'realme', oneplus: 'OnePlus', vivo: 'vivo', iqoo: 'iQOO', huawei: 'Huawei', honor: 'Honor', samsung: 'Samsung', motorola: 'Motorola', infinix: 'Infinix', tecno: 'TECNO' };
  let bgAt = 0;
  const bgCheck = async (force) => { const p = RN(); if (!p || (!force && Date.now() - bgAt < 5000)) return; bgAt = Date.now();
    let s; try { s = await p.getStatus(); } catch { return; }
    if (s.notifications === undefined) { const h = '<div class="card flat small"><b>Update Pakka Rider</b><div class="mute mt2">Install the latest Pakka Rider app (1.3 or newer) for the background check and more reliable background alerts.</div></div>'; S.bgHtml = h; const el = PL.$('#bgcheck'); if (el && el.innerHTML !== h) el.innerHTML = h; return; }
    const online = !!S.me?.is_online, active = S.last?.active?.length || 0;
    const rows = [[s.locationOn && s.locationPermission, 'Location', s.locationOn ? 'Allow location for Pakka Rider' : 'Turn on your phone’s Location', 'location'],
      [s.notifications, 'Notifications', 'Needed to ring for new offers', 'notifications'],
      [s.battery, 'Background running', 'Allow Pakka Rider to run without battery restrictions', 'battery'],
      [s.fullScreen !== false, 'Ring on lock screen', 'Allow “Full screen notifications” so offers ring and show over the lock screen like a call', 'fullscreen'],
      [s.overlay, 'Floating icon', s.sdk >= 33 ? 'If Android says “App was denied access”: App info → ⋮ → Allow restricted settings, then allow again' : 'Allow “Display over other apps”', 'overlay'],
      [!(online || active) || s.running, 'Running in background', 'Not running. Tap Restart.', 'restart']];
    const bad = rows.filter((r) => !r[0]); const maker = Object.keys(MAKERS).find((k) => (s.maker || '').includes(k));
    const tip = maker ? `<div class="small mute mt2">${MAKERS[maker]} phones can also stop apps on their own: open <b>App info → Battery</b> and turn on <b>Allow background activity</b> / <b>Auto-launch</b> for Pakka Rider.</div><button class="btn ghost sm mt2" data-act="bg-fix" data-w="app">Open App info</button>` : '';
    const html = !bad.length
      ? `<div class="card flat row" style="gap:10px"><span style="color:var(--ok)">${PL.icon('check')}</span><div class="grow"><b>Background alerts ready</b><div class="small mute">${online ? 'Offers ring and your location updates even when you switch apps or lock the phone.' : 'Go online to start receiving offers in the background.'}</div>${tip ? `<details class="small mt2"><summary>${MAKERS[maker]} phone tips</summary>${tip}</details>` : ''}</div></div>`
      : `<div class="card" style="border-color:#f3cbc7"><b>Background check</b><div class="small mute">Fix these so offers keep ringing when you use other apps or lock the phone.</div>${rows.map(([ok, t, why, w]) => `<div class="row between mt2" style="align-items:flex-start;gap:10px"><div class="grow"><b class="small" style="color:${ok ? 'var(--ok)' : 'var(--bad)'}">${ok ? '✓' : '✗'} ${t}</b>${ok ? '' : `<div class="small mute">${why}</div>`}</div>${ok ? '' : `<button class="btn sm" data-act="bg-fix" data-w="${w}">${w === 'restart' ? 'Restart' : 'Fix'}</button>`}</div>`).join('')}${tip}</div>`;
    S.bgHtml = html; const el = PL.$('#bgcheck'); if (el && el.innerHTML !== html) el.innerHTML = html; };
  PL.actions['bg-fix'] = async (el) => { const p = RN(); if (!p) return; const w = el.dataset.w;
    if (w === 'restart') { nativeSync(true); setTimeout(() => bgCheck(true), 1500); return; }
    await p.openSettings({ what: w }).catch(() => {}); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => bgCheck(true), 600); });
  const nativeSync = (force) => { const p = RN(); if (!p) return; const s = PL.session(); const online = !!S.me?.is_online, active = S.last?.active?.length || 0, tok = s?.token || '';
    const sig = [online, active, tok].join('|'); if (sig === nsig && !force) return; nsig = sig;
    p.sync({ online, active, token: tok, api: location.origin }).catch(() => {});
    if (tok && p.getPushToken) p.getPushToken().then((r) => { if (r?.token && S.fcmSent !== r.token + tok) PL.post('/api/push/fcm', { token: r.token, label: 'Pakka Rider app' }).then(() => { S.fcmSent = r.token + tok; S.fcmTok = r.token; }).catch(() => {}); }).catch(() => {}); };

  // restaurant -> customer distance: by road when measured, otherwise the straight line between the two saved points (labelled)
  const tripTxt = (o) => (o.trip ? (o.trip.by_road ? `${o.trip.km} km by road · ` : `~${o.trip.km} km (straight line) · `) : o.distance_km ? o.distance_km + ' km · ' : '');
  const detail = (o, full) => `<div class="row between"><div>${PL.code(o.order_code)}</div><span class="d-fee">${rs(o.fee_paise)}<small>you earn</small></span></div>
    <div class="small mute">${tripTxt(o)}${o.eta_at ? 'Customer expects ~' + PL.time(o.eta_at) : ''}</div>
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
  const onWay = (o) => (o.on_the_way ? `<div class="d-onway">${PL.icon('nav')}<span><b>On your way</b> · restaurant ${o.on_the_way.pickup_km} km and drop-off ${o.on_the_way.drop_km} km from your current delivery</span></div>` : '');
  const brief = (o) => `${offerCard(o)}<div class="small mute mt2">Address, phone and map open after you accept.</div>`;
  async function tick() {
    let d; try { d = await PL.api('/api/rider/offers'); } catch { return; }
    S.last = d; PL.track?.sync?.(d.active.length); nativeSync(); bgCheck();      // share location only while a delivery is assigned
    const offers = d.offers.filter((o) => !S.dismissed.has(o.id)); PL.badge('/jobs', d.active.length + offers.length);
    if (S.prevN != null && offers.length > S.prevN) { try { navigator.vibrate?.([250, 120, 250, 120, 250]); } catch {} } S.prevN = offers.length;
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
    box.classList.toggle('hide', !n); setAlertSpace(box); ringFor(n > 0);
  }
  const move = (dlt) => { const offers = (S.last?.offers || []).filter((o) => !S.dismissed.has(o.id)); const i = offers.findIndex((o) => o.id === curId); const nx = offers[Math.min(offers.length - 1, Math.max(0, i + dlt))]; if (nx) curId = nx.id; tick(); };
  PL.actions['rq-prev'] = () => move(-1);
  PL.actions['rq-next'] = () => move(1);
  PL.actions['rq-pick'] = (el) => { curId = Number(el.dataset.id); tick(); };
  PL.actions['rq-collapse'] = () => { collapsed = true; tick(); };
  PL.actions['rq-expand'] = () => { collapsed = false; tick(); };
  addEventListener('resize', () => { const b = PL.$('#alerts'); if (b) setAlertSpace(b); });
  PL.actions['sound-on'] = async () => { await PL.sound.enable(); tick(); };
  // one accept request per order at a time: a double tap (or the pop-up and the list together) must not send a second one
  const claiming = new Set();
  PL.actions.claim = async (el) => {
    const id = Number(el.dataset.id); if (claiming.has(id)) return; claiming.add(id);
    document.querySelectorAll(`[data-act="claim"][data-id="${id}"]`).forEach((b) => { b.disabled = true; b.textContent = 'Accepting…'; });
    try { const r = await PL.run(() => PL.post(`/api/rider/orders/${id}/accept`), 'Order accepted'); await tick(); if (r) PL.go('/jobs'); else PL.rerender(); }
    finally { claiming.delete(id); }
  };
  PL.actions.dismiss = async (el) => { S.dismissed.add(Number(el.dataset.id)); await PL.run(() => PL.post(`/api/rider/orders/${el.dataset.id}/dismiss`)); tick(); };

  // ---------- online switch ----------
  const sw = () => (S.me && !S.me.can_take_orders ? '' : `<button class="sw ${S.me?.is_online ? 'on' : ''}" id="onl" data-act="online" aria-label="Online or offline"><span>${S.me?.is_online ? 'Online' : 'Offline'}</span><i></i></button>`);
  async function refreshMe() { try { S.me = (await PL.api('/api/rider/me')).rider; const s = PL.$('#side'); if (s) s.innerHTML = sw(); nativeSync(); } catch {} }
  // Location must be allowed before going online (and staying online): a rider who cannot share location is never shown as available.
  // App: read from Android. Browser: the Permissions API, then one real location request. Returns null when OK, else what to fix.
  const locProblem = async (ask) => { const p = RN();
    if (p) { try { const s = await p.getStatus(); if (!s.locationOn) return ['Turn on Location', 'Your phone’s Location (GPS) is off. Turn it on in quick settings, then go online.', 'location']; if (!s.locationPermission) return ['Allow location', 'Pakka Rider needs location permission (“Allow all the time” is best) to show you offers and share delivery progress.', 'location']; } catch {} return null; }
    if (!navigator.geolocation) return ['Location not available', 'This browser cannot share location. Use the Pakka Rider app or Chrome.', null];
    try { const st = (await navigator.permissions?.query({ name: 'geolocation' }))?.state; if (st === 'denied') return ['Location is blocked', 'Allow location for this site: tap the lock icon next to the web address → Permissions → Location → Allow, then try again.', null]; if (st === 'granted' || !ask) return null; } catch { if (!ask) return null; }
    return new Promise((ok) => navigator.geolocation.getCurrentPosition(() => ok(null), (er) => ok(er.code === 1 ? ['Location is blocked', 'You chose not to share location. Allow it to go online.', null] : null), { timeout: 12000, maximumAge: 60000 })); };
  const locGuide = ([t, why, w]) => PL.modal(`<div class="cf bad"><span class="cf-ic">${PL.icon('pin')}</span><h3>${e(t)}</h3><p class="small mute">${e(why)}</p></div>${w && RN() ? `<button class="btn block mt" data-act="loc-fix" data-w="${w}">Open settings</button>` : ''}<button class="btn ghost block mt2" data-act="close-modal">OK</button>`);
  PL.actions['loc-fix'] = async (el) => { PL.closeModal(); await RN()?.openSettings({ what: el.dataset.w }).catch(() => {}); };
  // while online: if location is switched off or blocked, go offline (with a clear message) instead of looking available
  const locWatch = async () => { if (!PL.session() || !S.me?.is_online || S.locBusy) return; S.locBusy = true;
    try { const bad = await locProblem(false); if (bad && S.me?.is_online && !(S.last?.active?.length)) { await PL.post('/api/rider/online', { online: false }).catch(() => {}); await refreshMe(); PL.rerender(); locGuide([`${bad[0]} — you are offline`, bad[1], bad[2]]); } } finally { S.locBusy = false; } };
  setInterval(locWatch, 20000);
  PL.actions.online = async (el) => { el?.classList.add('busy'); const on = !S.me?.is_online;
    if (on) { const bad = await locProblem(true); if (bad) { el?.classList.remove('busy'); return locGuide(bad); } }
    if (on && !PL.sound.unlocked) await PL.sound.enable(); const r = await PL.run(() => PL.post('/api/rider/online', { online: on }), on ? 'You are online' : 'You are offline'); await refreshMe(); if (r) PL.rerender(); };

  // ---------- deliveries ----------
  // ---------- simple screens: payout up front, one step at a time ----------
  let codeForm = () => '';
  const kmOf = (o) => o.pay_parts?.km ?? o.trip?.km ?? o.distance_km ?? null;
  const r2 = (v) => (v % 100 ? (v / 100).toFixed(2) : String(v / 100));      // ₹7, ₹2.50
  const payNote = (o) => { const p = o.pay_parts; if (!p) return ''; return p.minimum_applied ? `Minimum ₹${r2(p.minimum_paise)} per delivery`
    : `₹${r2(p.base_rate_paise)}/km + ₹${r2(p.route_rate_paise)}/km ${e(p.route_label)}`; };
  // How the payout is made up (partner payout plan, Model A): Base Delivery Payout ₹7/km + route support ₹2.50/km
  // (SRSA up to 5 km, ERA above), topped up to the ₹20 minimum, rounded up to the rupee. The lines always add up to the total.
  const legs = (o) => { const p = o.pay_parts, t = Number(o.fee_paise) || 0; if (!p || !t) return null;
    const b = Math.round(p.base_paise), r = Math.round(p.route_paise), x = t - b - r;
    const rows = [[`Base Delivery Payout · ₹${r2(p.base_rate_paise)} × ${p.km} km`, b], [`${e(p.route_name)} (${e(p.route_label)}) · ₹${r2(p.route_rate_paise)} × ${p.km} km`, r]];
    if (x > 0) rows.push([p.minimum_applied ? `Minimum guarantee top-up (₹${r2(p.minimum_paise)} minimum)` : 'Rounded up to the whole rupee', x]);
    return x < 0 ? null : rows; };
  const rp = (v) => '₹' + r2(v);
  const offerCard = (o) => { const km = kmOf(o), l = legs(o);
    return `<div class="ro">${onWay(o)}<div class="ro-top"><div><span class="ro-fee">${rs(o.fee_paise)}</span><span class="ro-pay">${payNote(o) || 'you earn'}</span></div>${km != null ? `<span class="ro-km">${km} km</span>` : ''}</div>
      ${l ? `<div class="ro-legs">${l.map(([t, v]) => `<div><span>${t}</span><b>${rp(v)}</b></div>`).join('')}<div class="tot"><span>Total you earn</span><b>${rs(o.fee_paise)}</b></div></div>` : ''}
      <div class="ro-route"><div class="ro-pt"><i class="a"></i><div><b>${e(o.restaurant.name)}</b><small>${e(o.restaurant.address || '')}</small></div></div>
        <div class="ro-pt"><i class="b"></i><div><b>${e(o.destination.text || 'Customer')}</b><small>${o.items.reduce((n, i) => n + i.qty, 0)} item${o.items.reduce((n, i) => n + i.qty, 0) > 1 ? 's' : ''}${o.eta_at ? ' · expected ~' + PL.time(o.eta_at) : ''}</small></div></div></div></div>`; };
  const stepCard = (o) => { const st = o.status, n = st === 'PICKED_UP' ? 2 : st === 'READY' ? 1 : 0, d = o.destination;
    const titles = ['Go to the restaurant', 'Collect the order', 'Deliver to the customer'];
    const big = (href, icon, label, cls = '') => href ? `<a class="btn ${cls} grow" href="${e(href)}" ${href.startsWith('tel:') ? '' : 'target="_blank" rel="noopener" data-nav'}>${PL.icon(icon, 'width="18" height="18"')} ${label}</a>` : '';
    const place = n < 2 ? `<div class="rs-place"><span class="rs-ic">${PL.icon('shop')}</span><div><b>${e(o.restaurant.name)}</b><small>${e(o.restaurant.address || '')}</small></div></div>
        <div class="row mt2">${big(o.restaurant.maps_link, 'pin', 'Navigate')}${o.restaurant.phone ? big('tel:' + o.restaurant.phone, 'phone', 'Call', 'ghost') : ''}</div>`
      : `<div class="rs-place"><span class="rs-ic green">${PL.icon('pin')}</span><div><b>${e(d.place_name || d.building || d.text || 'Customer')}</b><small>${e([d.block && 'Block ' + d.block, d.floor && 'Floor ' + d.floor, d.room && 'Room ' + d.room].filter(Boolean).join(' · ') || d.landmark || '')}</small></div></div>
        <div class="row mt2">${big(d.nav_url, 'pin', 'Navigate')}${o.customer.phone ? big('tel:' + o.customer.phone, 'phone', 'Call', 'ghost') : ''}</div>`;
    const wait = (st === 'ACCEPTED' || st === 'PREPARING') ? '<div class="rs-wait">The kitchen is preparing. Enter the pickup code here when it’s ready.</div>' : '';
    const items = o.items.map((i) => `<div class="kv"><span>${i.qty} × ${e(i.name)}</span></div>`).join('');
    return `<div class="card rs">
      <div class="rs-head"><span class="rs-n">Step ${n + 1} of 3</span><span class="rs-fee">${rs(o.fee_paise)}</span></div>
      <div class="rs-bar"><i style="width:${(n + 1) * 33.34}%"></i></div>
      <h3 class="rs-title">${titles[n]}</h3>${place}${wait}${codeForm(o)}
      ${chatBtn(o.id, o.unread_messages)}
      <details class="rs-more"><summary>Order details · ${PL.code(o.order_code)}</summary>
        <div class="sec">Items</div>${items}${o.instructions ? `<div class="sec">Instructions</div><div class="small">${e(o.instructions)}</div>` : ''}
        ${n < 2 && !d.area_only ? `<div class="sec">Drop-off</div>${destCard(o)}` : n === 2 ? `<div class="sec">Address details</div>${destCard(o)}` : ''}
        ${payNote(o) ? `<div class="sec">Your payout</div><div class="small">${rs(o.fee_paise)} · ${payNote(o)}${kmOf(o) != null ? ` · ${kmOf(o)} km` : ''}</div>` : ''}
      </details></div>`; };
  async function jobs() {
    await refreshMe(); const d = S.last || (await PL.api('/api/rider/offers')); const act = (await PL.api('/api/rider/active')).active, me = S.me;
    const vs = me.verification_status, gate = vs !== 'approved' ? `<div class="card status-card st-${vs}"><b>${e(PL.LABEL[vs] || vs)}</b>
      <p class="small mt2">${{ draft: `Finish your application to start delivering.${me.missing_count ? ` ${me.missing_count} item${me.missing_count > 1 ? 's' : ''} still needed.` : ''}`, pending: 'Pakka Local is checking your application. You cannot receive deliveries until it is approved.', corrections_requested: 'Pakka Local asked you to correct some details.', reverification_required: 'Please update your application. You can finish deliveries you already have, but you will not get new ones until it is approved.', rejected: 'Your application was not approved.', suspended: 'Your account is suspended. Contact Pakka Local.' }[vs] || ''}</p>
      ${['draft', 'corrections_requested', 'reverification_required'].includes(vs) ? '<button class="btn sm mt2" data-act="go" data-path="/profile">Continue my application</button>' : vs === 'pending' ? '<button class="btn ghost sm mt2" data-act="go" data-path="/profile">View my application</button>' : ''}</div>` : !me.is_online ? '<div class="banner info">You are offline. Switch Online (top right) to receive delivery offers.</div>' : '';
    const offers = d.offers.filter((o) => !S.dismissed.has(o.id) && !act.find((a) => a.id === o.id));
    act.forEach((o) => { S.fee[o.id] = o.fee_paise; });
    const today = await earnToday(), can = me.can_take_orders !== false && vs === 'approved';
    const hero = can ? `<div class="d-hero ${me.is_online ? 'on' : ''}"><div class="grow"><span class="d-state"><i></i>${me.is_online ? 'You’re online' : 'You’re offline'}</span><div class="small">${me.is_online ? (act.length ? 'Finish your delivery. Orders on your way still arrive.' : 'Waiting for delivery offers near you.') : 'Go online to start receiving delivery offers.'}</div></div>
        <button class="d-go" data-act="online" aria-pressed="${!!me.is_online}">${me.is_online ? 'Go offline' : 'Go online'}</button></div>
      ${act.length ? '' : `<div class="d-kpis"><div><b>${today ? rs(today.today_paise) : '–'}</b><span>Earned today</span></div><div><b>${today ? rs(today.week_paise) : '–'}</b><span>Last 7 days</span></div><div><b>${act.length}</b><span>Active now</span></div></div>`}` : '';      // during a delivery the step card comes first
    const stepOf = (st) => (st === 'PICKED_UP' ? 2 : st === 'READY' ? 1 : 0);
    const track = (o) => `<ol class="d-steps">${['Go to restaurant', 'Collect order', 'Deliver to customer'].map((l, i) => `<li class="${i < stepOf(o.status) ? 'done' : i === stepOf(o.status) ? 'cur' : ''}"><span>${i < stepOf(o.status) ? PL.icon('check') : i + 1}</span>${l}</li>`).join('')}</ol>`;
    // the code box comes first (right under the steps), as 4 big boxes; typing the 4th digit submits it
    codeForm = (o) => o.status === 'READY' ? `<form data-form="pickup" data-id="${o.id}" class="mt d-code d-code-top"><label>${PL.icon('box')}<span>Ask the restaurant for the <b>pickup code</b></span></label>${digits()}<button class="btn block lg mt2" type="submit">Confirm pickup</button></form>`
      : o.status === 'PICKED_UP' ? `<form data-form="deliver" data-id="${o.id}" class="mt d-code d-code-top green"><label>${PL.icon('check')}<span>Ask the customer for the <b>delivery code</b></span></label>${digits()}<button class="btn green block lg mt2" type="submit">Complete delivery</button></form>` : '';
    return `${gate}${hero}${RN() ? `<div id="bgcheck">${S.bgHtml || ''}</div>` : ''}${act.length ? (PL.track?.card?.() || '') : ''}${S.push === 'on' || RN() ? '' : (PL.push?.card?.('rider') || '')}${act.map((o) => stepCard(o)).join('')}
      ${act.length && me.is_online && d.can_add ? `<div class="small mute" style="margin:10px 2px 0">You can add another order if it’s on your way (restaurant and drop-off within ${d.batch_radius_km || 2} km of your current delivery).</div>` : ''}
      ${offers.length ? `<div class="sec">${act.length ? 'Orders on your way' : 'Available offers'}</div>${offers.map((o) => `<div class="card">${offerCard(o)}<div class="row mt2"><button class="btn ghost grow" data-act="dismiss" data-id="${o.id}">Not now</button><button class="btn grow lg" data-act="claim" data-id="${o.id}">Accept ${rs(o.fee_paise)}</button></div></div>`).join('')}` : ''}
      ${!act.length && !offers.length ? `<div class="empty">${me.is_online ? `<span class="d-radar" aria-hidden="true">${PL.icon('bike')}</span><b>Looking for deliveries…</b><span class="small">Keep this screen open. New offers ring and appear here.</span>` : `${PL.icon('bike', 'width="36" height="36"')}<b>No active deliveries</b>`}</div>` : ''}`;
  }
  // ---------- 4-box code entry (numbers only; paste fills all; 4th digit submits) ----------
  const digits = () => `<div class="d-digits" role="group" aria-label="4-digit code">${[0, 1, 2, 3].map((i) => `<input class="d-dg" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" aria-label="Digit ${i + 1}">`).join('')}<input type="hidden" name="otp"></div>`;
  const dgSync = (box) => { const v = [...box.querySelectorAll('.d-dg')].map((x) => x.value).join(''); box.querySelector('[name=otp]').value = v; box.querySelectorAll('.d-dg').forEach((x) => x.classList.toggle('on', !!x.value)); return v; };
  const dgFill = (box, str, from = 0) => { const ds = [...box.querySelectorAll('.d-dg')], t = String(str).replace(/\D/g, ''); let k = from; for (const c of t) { if (k >= ds.length) break; ds[k++].value = c; }
    const v = dgSync(box); (ds[Math.min(k, ds.length - 1)])?.focus(); if (v.length === 4) { const f = box.closest('form'); if (f && !f.dataset.sent) { f.dataset.sent = 1; f.requestSubmit(); setTimeout(() => { delete f.dataset.sent; }, 1500); } } };
  document.addEventListener('input', (ev) => { const t = ev.target; if (!t.classList?.contains('d-dg')) return; const box = t.closest('.d-digits'), ds = [...box.querySelectorAll('.d-dg')], i = ds.indexOf(t), raw = t.value.replace(/\D/g, ''), prev = t.dataset.v || '';
    const v = raw.length > 1 && prev && raw.startsWith(prev) ? raw.slice(prev.length) : raw.length > 1 && prev && raw.endsWith(prev) ? raw.slice(0, -prev.length) : raw;
    t.value = ''; if (v) dgFill(box, v, raw.length > 1 && prev && v.length === 1 ? i + 1 : i); else dgSync(box); ds.forEach((x) => { x.dataset.v = x.value; }); });
  document.addEventListener('keydown', (ev) => { const t = ev.target; if (!t.classList?.contains('d-dg') || ev.key !== 'Backspace' || t.value) return; const ds = [...t.closest('.d-digits').querySelectorAll('.d-dg')], i = ds.indexOf(t); if (i > 0) { ds[i - 1].value = ''; ds[i - 1].focus(); dgSync(t.closest('.d-digits')); ev.preventDefault(); } });
  document.addEventListener('paste', (ev) => { const t = ev.target; if (!t.classList?.contains('d-dg')) return; ev.preventDefault(); dgFill(t.closest('.d-digits'), (ev.clipboardData || window.clipboardData).getData('text'), 0); });
  const dgCheck = (f) => { const v = PL.form(f).otp || ''; if (!/^\d{4}$/.test(v)) { PL.toast('Enter all 4 digits of the code.', true); f.querySelector('.d-dg')?.focus(); return null; } return v; };
  const dgClear = (f) => { f.querySelectorAll('.d-dg').forEach((x) => { x.value = ''; x.classList.remove('on'); }); f.querySelector('.d-dg')?.focus(); };
  PL.forms.pickup = async (f) => { const otp = dgCheck(f); if (!otp) return; const r = await PL.run(() => PL.post(`/api/rider/orders/${f.dataset.id}/pickup`, { otp }), 'Pickup confirmed'); if (r) PL.rerender(); else dgClear(f); };
  PL.forms.deliver = async (f) => { const otp = dgCheck(f); if (!otp) return; const r = await PL.run(() => PL.post(`/api/rider/orders/${f.dataset.id}/deliver`, { otp })); if (!r) { dgClear(f); return; } S.et = null;
    await PL.celebrate({ title: 'Delivered!', sub: S.fee[f.dataset.id] ? `${rs(S.fee[f.dataset.id])} added to your earnings.` : 'Earnings added to your balance.' }); PL.rerender(); };
  S.fee = {};
  const earnToday = async () => { if (!S.et || Date.now() - S.et.t > 30000) { try { S.et = { t: Date.now(), d: await PL.api('/api/rider/earnings') }; } catch { S.et = S.et || { t: Date.now(), d: null }; } } return S.et.d; };


  const chatBtn = (id, n) => `<button class="btn ghost block mt2 r-chat" data-act="rchat" data-id="${id}">${PL.icon('chat', 'width="18" height="18"')} ${n ? `<b>${n} new message${n > 1 ? 's' : ''}</b>` : 'Message customer'}</button>`;
  PL.actions.rchat = (el) => PL.chat.open(`/api/rider/orders/${el.dataset.id}/messages`, 'Customer', 'Only you and this customer can see these messages.');
  // deep link target for offer notifications: shows the offer only if it is still genuinely available to this rider
  async function oneJob({ id }) {
    let d; try { d = await PL.api('/api/rider/orders/' + id); } catch { return '<div class="empty">This delivery is no longer available.<br><button class="btn mt" data-act="go" data-path="/jobs">See my deliveries</button></div>'; }
    const o = d.order; if (d.mine) return `<div class="card" style="border-color:var(--brand)"><div class="row between"><b>Your delivery</b>${PL.chip(o.status)}</div>${detail(o)}${d.chat ? chatBtn(o.id, d.chat.unread) : ''}<button class="btn block mt" data-act="go" data-path="/jobs">Open delivery steps</button></div>`;
    return `<div class="card">${detail(o)}<div class="row mt2"><button class="btn ghost grow" data-act="dismiss" data-id="${o.id}">Not now</button><button class="btn grow" data-act="claim" data-id="${o.id}">Accept</button></div></div>`;
  }

  // ---------- earnings ----------
  async function earnings() { const d = await PL.api('/api/rider/earnings');
    return `<div class="e-hero"><span>Earned today</span><b>${rs(d.today_paise)}</b><div class="e-sub"><span>Last 7 days <b>${rs(d.week_paise)}</b></span><span><b>${d.completed_count}</b> deliveries completed</span></div></div>
      <div class="card flat small"><b>How payouts work</b><div class="mute mt2">Request a cashout from your available balance. Pakka Local reviews each request and pays it to your UPI or bank account; the payment reference and proof appear below once it is paid.</div></div>
      ${PL.balanceCards(d.balance)}
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
      ${hist}${RN() ? '<div class="card flat small"><b>Alerts in the Pakka Rider app</b><div class="mute mt2">While you are online, new offers ring and show a notification even when you use other apps or the screen is off. The round Pakka Rider icon on the side of the screen brings you back.</div></div>' : (PL.push?.card?.('rider') || '')}<button class="btn ghost block" data-act="logout">Sign out</button>`;
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

  // ---------- sign in / join with an SMS code (like Swiggy / Zomato partner apps) ----------
  // New numbers get a draft application (mobile already verified) and go straight to it; Pakka Local reviews it before any delivery.
  let rlTimer = null;
  const rlPhoneStep = () => `<h2>Sign in or join</h2><p class="mute">Enter your mobile number. We’ll send a 6-digit code by SMS.</p>
    <form data-form="rl-req"><div class="field pre"><span>+91</span><input name="phone" inputmode="numeric" maxlength="10" autocomplete="tel-national" placeholder="98765 43210" required autofocus aria-label="Mobile number"></div>
    <button class="btn block lg mt" type="submit">Send OTP</button></form>
    <p class="rl-fine">New delivery partner? Sign in with your number, then add your details and documents. Pakka Local checks them before you can take deliveries.</p>
    <button class="linkbtn mt2" data-act="rl-pw">Sign in with password instead</button>`;
  const rlCodeStep = (phone, wait) => `<h2>Enter the 6-digit code</h2><p class="mute">Sent by SMS to <b>+91 ${e(phone.slice(-10))}</b></p>
    <form data-form="rl-ver" data-p="${e(phone)}"><input class="rl-otp" name="otp" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" required autofocus aria-label="6-digit code" placeholder="••••••">
    <button class="btn block lg mt" type="submit">Verify and continue</button></form>
    <div class="row between mt2"><button class="linkbtn" data-act="rl-back">Change number</button><button class="linkbtn" id="rl-resend" data-act="rl-resend" data-p="${e(phone)}" disabled>Resend in ${wait}s</button></div>`;
  const rlSheet = (html) => { const el = PL.$('#rl-sheet'); if (el) { el.innerHTML = html; setTimeout(() => el.querySelector('input:not([type=hidden])')?.focus(), 50); } };
  const rlCount = (wait) => { clearInterval(rlTimer); let t = wait; rlTimer = setInterval(() => { const b = PL.$('#rl-resend'); if (!b) return clearInterval(rlTimer); t--; if (t <= 0) { b.disabled = false; b.textContent = 'Resend code'; clearInterval(rlTimer); } else b.textContent = `Resend in ${t}s`; }, 1000); };
  const riderLogin = (root) => {
    root.innerHTML = `<div class="rl"><div class="rl-hero"><img class="rl-logo" src="/assets/logo.png" alt="Pakka Local"><span class="rl-tag">${PL.icon('bike')} Delivery partner</span>
        <h1>Ride with<br>Pakka Local</h1><p>Deliver hot food from local kitchens near you.</p>
        <ul class="rl-pts"><li>${PL.icon('wallet')}<span><b>At least ₹20</b> for every delivery</span></li><li>${PL.icon('nav')}<span>See your payout <b>before you accept</b></span></li><li>${PL.icon('check')}<span>Quick sign-up with your <b>mobile number</b></span></li></ul></div>
      <div class="rl-sheet" id="rl-sheet">${rlPhoneStep()}</div></div>`;
  };
  PL.forms['rl-req'] = async (f) => { const d = f.phone.value.replace(/\D/g, '').slice(-10); if (!/^[6-9]\d{9}$/.test(d)) return PL.toast('Enter your 10-digit mobile number.', true);
    const r = await PL.run(() => PL.post('/api/auth/rider/otp/request', { phone: '+91' + d })); if (!r) return; rlSheet(rlCodeStep('+91' + d, r.resendAfterSec || 45)); rlCount(r.resendAfterSec || 45); };
  PL.actions['rl-resend'] = async (el) => { const r = await PL.run(() => PL.post('/api/auth/rider/otp/request', { phone: el.dataset.p }), 'New code sent'); if (r) { rlSheet(rlCodeStep(el.dataset.p, r.resendAfterSec || 45)); rlCount(r.resendAfterSec || 45); } };
  PL.actions['rl-back'] = () => { clearInterval(rlTimer); rlSheet(rlPhoneStep()); };
  PL.actions['rl-pw'] = () => PL.staffLogin(PL.$('#root'), { title: 'Delivery partner', blurb: 'Sign in with your mobile number and password.' });
  PL.forms['rl-ver'] = async (f) => { const otp = f.otp.value.replace(/\D/g, ''); if (otp.length !== 6) return PL.toast('Enter the 6-digit code.', true);
    const r = await PL.run(() => PL.post('/api/auth/rider/otp/verify', { phone: f.dataset.p, otp })); if (!r) { f.otp.value = ''; f.otp.focus(); return; }
    clearInterval(rlTimer); PL.setSession(r);
    history.replaceState({ idx: 0 }, '', r.is_new ? '#/profile' : '#/jobs');      // new partners go straight to their application
    PL.toast(r.is_new ? 'Welcome! Let’s set up your delivery partner profile.' : 'Welcome back!', 'ok'); PL.boot(); };
  document.addEventListener('input', (ev) => { if (ev.target.classList?.contains('rl-otp')) { ev.target.value = ev.target.value.replace(/\D/g, '').slice(0, 6); if (ev.target.value.length === 6) ev.target.form?.requestSubmit(); } });

  PL.start({ portal: 'rider', name: 'Rider', home: '/jobs', loginView: riderLogin,
    right: () => '',
    tabs: [{ path: '/jobs', label: 'Deliveries', icon: 'bike' }, { path: '/earnings', label: 'Earnings', icon: 'wallet' }, { path: '/profile', label: 'Account', icon: 'user' }],
    onReady: () => { refreshMe(); tick(); const a = setInterval(tick, 1000), b = setInterval(refreshMe, 15000); PL.hooks.stop = [() => { nsig = ''; RN()?.sync({ online: false, active: 0, token: '', api: '' }).catch(() => {}); S.fcmSent = null; PL.track.stop(); clearInterval(a); clearInterval(b); const x = PL.$('#alerts'); if (x) { x.innerHTML = ''; x.dataset.h = ''; x.classList.add('hide'); setAlertSpace(x); } }]; },
    routes: { '/jobs': { title: 'Deliveries', render: jobs, poll: 2000, skel: 'dash' }, '/job/:id': { title: 'Delivery', render: oneJob, poll: 2000 }, '/earnings': { title: 'Earnings', render: earnings, poll: 6000, skel: 'dash' }, '/profile': { title: 'My application', render: profile }, '/profile/:step': { title: 'My application', render: profile } } });
})();
