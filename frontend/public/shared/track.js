/* Priority 2: live tracking client. Rider side shares location ONLY while a delivery is assigned; map side never shows an old position as live. */
(function () {
  const e = PL.esc, T = (PL.track = { state: 'off', lastSentAt: 0 });
  let watchId = null, timer = null, latest = null, sentStamp = 0, wake = null, busy = false, every = 7000;

  // ---------- rider: share location during an active delivery ----------
  const wakeOn = async () => { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { /* not supported or not allowed: tracking still works while the screen is on */ } };
  const set = (s) => { if (T.state !== s) { T.state = s; PL.rerender && PL.$('#view') && PL.rerender(); } };
  async function flush() {
    if (busy || !latest || latest.timestamp === sentStamp || !PL.session()) return;
    busy = true; const p = latest, c = p.coords;
    try {
      const r = await PL.api('/api/tracking/rider/location', { method: 'POST', body: { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy ?? undefined, heading: Number.isFinite(c.heading) ? c.heading : undefined, speed: Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : undefined, recorded_at: Math.min(p.timestamp, Date.now()) } });
      sentStamp = p.timestamp; T.lastSentAt = Date.now(); if (r.next_ms && r.next_ms !== every) { every = r.next_ms; clearInterval(timer); timer = setInterval(flush, every); } set('sharing');
    } catch (x) { if (x.code === 'NOT_TRACKING' || x.code === 'NOT_ALLOWED') T.stop(); else if (x.code !== 'TOO_FREQUENT' && x.code !== 'OLD_FIX') set('retrying'); }
    finally { busy = false; }
  }
  T.start = () => {
    if (watchId !== null) return;
    if (!navigator.geolocation) return set('unsupported');
    set('starting'); wakeOn();
    watchId = navigator.geolocation.watchPosition((p) => { latest = p; if (!sentStamp || Date.now() - T.lastSentAt >= every) flush(); },
      (err) => { if (err.code === 1) { T.stop(false); set('denied'); }      /* browser-side failure: keep the last position on the server so it shows as old, not as missing */ else if (T.state !== 'sharing' || Date.now() - T.lastSentAt > 30000) set('nofix'); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    timer = setInterval(flush, every);
  };
  T.stop = (tellServer = true) => { if (watchId !== null) { navigator.geolocation.clearWatch(watchId); if (tellServer && PL.session()) PL.api('/api/tracking/rider/stop', { method: 'POST' }).catch(() => {}); }      /* ask the server to forget the last position straight away */
    watchId = null; clearInterval(timer); timer = null; latest = null; sentStamp = 0; if (wake) { wake.release().catch(() => {}); wake = null; } set('off'); };
  // called by the rider portal with the number of assigned, unfinished deliveries
  T.sync = (active) => { if (active > 0) { if (watchId === null && T.state !== 'denied' && T.state !== 'unsupported') T.start(); } else if (watchId !== null || T.state === 'denied') { T.stop(); } };
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => { if (watchId === null) return; if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 20000) PL.toast('Location sharing was paused while this screen was off or in the background. Keep the app open during deliveries.', true);      /* never pretend it kept running */
    hiddenAt = 0; wakeOn(); flush(); });
  T.card = () => ({ off: '', starting: `<div class="banner info">Getting your location…</div>`,
    sharing: `<div class="card flat row"><span style="color:var(--ok)">${PL.icon('pin')}</span><div class="grow"><b>Sharing live location</b><div class="small mute">Only during this delivery, and only while this screen is open and switched on. If you lock the phone, switch apps or close Chrome, sharing pauses and the customer sees your last position marked as old.</div></div></div>`,
    nofix: `<div class="banner warn">No GPS signal yet. Move to open sky and keep this screen on.</div>`, retrying: `<div class="banner warn">Can’t reach the server. Your location will resume when the connection is back.</div>`,
    denied: `<div class="banner bad">Location is blocked, so the customer can’t see where you are. Allow location for this site in Chrome settings, then tap <button class="btn sm" data-act="track-retry">Try again</button></div>`,
    unsupported: `<div class="banner bad">This browser cannot share location.</div>` }[T.state] || '');
  PL.actions['track-retry'] = () => { T.state = 'off'; T.start(); };

  // ---------- maps (Leaflet, vendored under /vendor/leaflet; degrades to text when it is not available) ----------
  let cfgP = null; const cfg = () => (cfgP = cfgP || PL.api('/api/tracking/config').catch(() => { cfgP = null; return {}; }));
  const COLORS = { live: '#1e8e3e', stale: '#e9a100', offline: '#8a8a8a', unavailable: '#8a8a8a' };
  const mmss = (s) => (s == null ? '' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`);
  T.label = (st, age) => ({ live: 'Live', stale: `Last seen ${mmss(age)}`, offline: `Offline · last seen ${mmss(age)}`, unavailable: 'Location not available yet' }[st] || '');
  async function makeMap(el, admin) {
    const c = await cfg(), why = !window.L ? 'The map library (Leaflet) is not installed on this server. Run node scripts/vendor-leaflet.mjs and redeploy.' : !c.tile_url ? 'No map tile provider is configured. Set MAP_TILE_URL on the server.' : '';
    if (why) { el.style.height = 'auto'; el.innerHTML = `<div class="empty small" style="padding:20px 10px">${admin ? e(why) : 'The map is not available right now. The live status shown here is still accurate.'}</div>`; return null; }
    const map = L.map(el, { zoomControl: true, attributionControl: true }).setView([17.385, 78.4867], 13); const layer = L.tileLayer(c.tile_url, { maxZoom: 19, attribution: c.attribution }); layer.addTo(map);
    let bad = 0; layer.on && layer.on('tileerror', () => { if (++bad === 4) { const n = document.createElement('div'); n.className = 'small'; n.style.cssText = 'position:absolute;z-index:500;left:8px;right:8px;top:8px;padding:6px 10px;border-radius:8px;background:#fff;color:#8a1c1c'; n.textContent = 'Map images are not loading. Positions and status are still correct.'; el.appendChild(n); } });
    const marks = {}; let fitted = '';
    return { map, put(key, lat, lng, color, title, big) { let m = marks[key]; const ic = big ? riderIcon(color) : dropIcon();
        if (!m) { m = marks[key] = L.marker([lat, lng], { icon: ic, keyboard: false, riseOnHover: true, zIndexOffset: big ? 500 : 0 }).addTo(map); m._c = color; }
        m.setLatLng([lat, lng]); if (m._c !== color) { m.setIcon(ic); m._c = color; } if (title) { m.unbindTooltip(); m.bindTooltip(title); } },
      keep(keys) { for (const k of Object.keys(marks)) if (!keys.includes(k)) { map.removeLayer(marks[k]); delete marks[k]; } },
      fit() { const pts = Object.values(marks).map((m) => m.getLatLng()), sig = Object.keys(marks).sort().join(','); if (!pts.length || sig === fitted) return; fitted = sig; pts.length === 1 ? map.setView(pts[0], 16) : map.fitBounds(L.latLngBounds(pts).pad(0.3)); } };
  }
  // Map markers: delivery partner = scooter badge whose ring colour shows live / last seen / offline; drop-off = home pin.
  // Inline SVG (no image download); class names let tests and screen readers tell them apart.
  const SCOOTER = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="2.6"/><circle cx="18" cy="17" r="2.6"/><path d="M8.6 17h6.8M15 17l-2-7h-3M13 10h3l2.2 4.6M6 14.4l2-4.4"/><path d="M15.5 6.5h2.5"/></svg>';
  const HOME = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7v9h-5v-6h-6v6H4z"/></svg>';
  const riderIcon = (color) => L.divIcon({ className: 'pl-mk pl-mk-rider', html: `<span class="ring" style="--c:${color}"><span class="core" style="background:${color}">${SCOOTER}</span></span>`, iconSize: [44, 44], iconAnchor: [22, 22], tooltipAnchor: [0, -22] });
  const dropIcon = () => L.divIcon({ className: 'pl-mk pl-mk-drop', html: `<span class="pin">${HOME}</span>`, iconSize: [32, 40], iconAnchor: [16, 38], tooltipAnchor: [0, -36] });
  const live = (el, fn, ms, admin) => { if (!el || el._pl) return; el._pl = true; let m; const run = async () => { if (!document.body.contains(el)) return clearInterval(iv); if (m === undefined) m = await makeMap(el, admin); if (!document.hidden) fn(m); }; const iv = setInterval(run, ms); run(); };

  // customer: card on the order page, shown only while the order is out for delivery
  T.customerCard = (o) => (o.status === 'PICKED_UP' ? `<div class="card"><div class="row between"><h3>Live tracking</h3><span class="chip" id="trkst">Checking…</span></div><div id="trkmap" data-code="${e(o.order_code)}" style="height:260px;border-radius:12px;margin-top:10px;overflow:hidden;background:#eee9df"></div><div class="small mute mt2" id="trknote"></div></div>` : '');
  T.customerMount = () => { const el = PL.$('#trkmap'); live(el, async (m) => {
    let d; try { d = await PL.api('/api/tracking/orders/' + el.dataset.code); } catch { return; }
    const st = PL.$('#trkst'), note = PL.$('#trknote'); if (!st) return;
    if (!d.tracking) { st.textContent = 'Not tracking'; st.className = 'chip'; return; }
    st.textContent = T.label(d.state, d.age_sec); st.className = 'chip ' + ({ live: 'ok', stale: 'warn' }[d.state] || '');
    note.textContent = d.state === 'live' ? 'Your delivery partner’s position updates every few seconds.' : d.state === 'stale' ? 'We have not heard from your delivery partner’s phone for a short while. The position shown may be out of date.' : d.state === 'offline' ? 'Your delivery partner’s phone is not sending its location. The marker shows the last known position, not where they are now.' : 'Your delivery partner’s location has not arrived yet.';
    if (!m) return; const keys = [];
    if (d.rider) { m.put('rider', d.rider.lat, d.rider.lng, COLORS[d.state], 'Delivery partner · ' + T.label(d.state, d.age_sec), true); keys.push('rider'); }
    if (d.destination) { m.put('dest', d.destination.lat, d.destination.lng, '#d4500f', 'Delivery location'); keys.push('dest'); }
    m.keep(keys); m.fit(); if (d.rider && d.state === 'live') m.map.panTo([d.rider.lat, d.rider.lng], { animate: true });
  }, 5000); };

  // admin: all active deliveries
  T.adminMount = () => { const el = PL.$('#admap'); live(el, async (m) => {
    let d; try { d = await PL.api('/api/tracking/admin/active'); } catch { return; }
    const list = PL.$('#admlist'); if (!list) return; const keys = [];
    list.innerHTML = d.deliveries.map((x) => `<div class="card"><div class="row between"><div>${PL.code(x.order_code)}</div>${PL.chip(x.status)}</div><div class="small"><b>${e(x.rider.name)}</b> · <a href="tel:${e(x.rider.phone)}">${e(x.rider.phone)}</a> · ${e(x.restaurant)}</div><div class="small mute">To: ${e(x.destination.text || '')}</div><div class="mt2"><span class="chip ${{ live: 'ok', stale: 'warn', offline: 'bad' }[x.state] || ''}">${e(T.label(x.state, x.age_sec))}</span></div></div>`).join('') || '<div class="empty">No deliveries are in progress.</div>';
    if (!m) return;
    for (const x of d.deliveries) { if (x.location) { m.put('r' + x.rider.id, x.location.lat, x.location.lng, COLORS[x.state], `${x.rider.name} · ${x.order_code} · ${T.label(x.state, x.age_sec)}`, true); keys.push('r' + x.rider.id); }
      if (x.destination.lat != null) { m.put('d' + x.id, x.destination.lat, x.destination.lng, '#d4500f', `Drop-off · ${x.order_code}`); keys.push('d' + x.id); } }
    m.keep(keys); m.fit();
  }, 5000, true); };
})();
