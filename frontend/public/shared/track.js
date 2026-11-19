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
  // inside the Pakka Rider Android app (1.2+) a native service keeps sharing while the app is in the background
  const nativeBg = () => !!(window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.RiderNative);
  document.addEventListener('visibilitychange', () => { if (watchId === null) return; if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 20000 && !nativeBg()) PL.toast('Location sharing was paused while this screen was off or in the background. Keep the app open during deliveries.', true);      /* never pretend it kept running */
    hiddenAt = 0; wakeOn(); flush(); });
  T.card = () => ({ off: '', starting: `<div class="banner info">Getting your location…</div>`,
    sharing: `<div class="card flat row"><span style="color:var(--ok)">${PL.icon('pin')}</span><div class="grow"><b>Sharing live location</b><div class="small mute">${nativeBg() ? 'Only during this delivery. It keeps updating while you use Maps or lock the phone, as long as you stay online in Pakka Rider.' : 'Only during this delivery, and only while this screen is open and switched on. If you lock the phone, switch apps or close Chrome, sharing pauses and the customer sees your last position marked as old.'}</div></div></div>`,
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
    const map = L.map(el, { zoomControl: true, attributionControl: true }).setView([17.385, 78.4867], 13); const layer = L.tileLayer(c.tile_url, { maxZoom: 19, attribution: c.attribution, referrerPolicy: 'strict-origin-when-cross-origin' }); layer.addTo(map);   // tile servers (OpenStreetMap policy) need the site origin as Referer; never the page path or order code
    let bad = 0; layer.on && layer.on('tileerror', () => { if (++bad === 4) { const n = document.createElement('div'); n.className = 'small'; n.style.cssText = 'position:absolute;z-index:500;left:8px;right:8px;top:8px;padding:6px 10px;border-radius:8px;background:#fff;color:#8a1c1c'; n.textContent = 'Map images are not loading. Positions and status are still correct.'; el.appendChild(n); } });
    const marks = {}; let fitted = '';
    const lines = {};
    return { map, put(key, lat, lng, color, title, big, heading) { let m = marks[key]; const hd = Number.isFinite(heading) ? Math.round(heading / 10) * 10 : null, sig = color + '|' + hd, ic = () => (big ? riderIcon(color, hd) : dropIcon());
        if (!m) { m = marks[key] = L.marker([lat, lng], { icon: ic(), keyboard: false, riseOnHover: true, zIndexOffset: big ? 500 : 0 }).addTo(map); m._c = sig; }
        m.setLatLng([lat, lng]); if (m._c !== sig) { m.setIcon(ic()); m._c = sig; } if (title) { m.unbindTooltip(); m.bindTooltip(title); } },
      // road route from the delivery partner to the drop-off (points from the server's routing service); no route = no line
      line(key, pts, color) { if (!pts || pts.length < 2) { if (lines[key]) { lines[key].forEach((l) => map.removeLayer(l)); delete lines[key]; } return; }
        if (!lines[key]) { lines[key] = [L.polyline(pts, { color: '#fff', weight: 8, opacity: 0.9, interactive: false }).addTo(map), L.polyline(pts, { color, weight: 4, opacity: 0.95, dashArray: '2 9', lineCap: 'round', interactive: false, className: 'pl-route' }).addTo(map)]; }
        else lines[key].forEach((l, i) => { l.setLatLngs(pts); if (i) l.setStyle({ color }); }); },
      keep(keys) { for (const k of Object.keys(marks)) if (!keys.includes(k)) { map.removeLayer(marks[k]); delete marks[k]; } for (const k of Object.keys(lines)) if (!keys.includes(k)) { lines[k].forEach((l) => map.removeLayer(l)); delete lines[k]; } },
      // fit keeps the markers and the whole road route in view
      fit() { const pts = [...Object.values(marks).map((m) => m.getLatLng()), ...Object.values(lines).flatMap((l) => l[0].getLatLngs())], sig = [...Object.keys(marks), ...Object.keys(lines)].sort().join(','); if (!pts.length || sig === fitted) return; fitted = sig; pts.length === 1 ? map.setView(pts[0], 16) : map.fitBounds(L.latLngBounds(pts).pad(0.3)); } };
  }
  // Map markers: delivery partner = scooter badge whose ring colour shows live / last seen / offline; drop-off = home pin.
  // Inline SVG (no image download); class names let tests and screen readers tell them apart.
  const SCOOTER = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="2.6"/><circle cx="18" cy="17" r="2.6"/><path d="M8.6 17h6.8M15 17l-2-7h-3M13 10h3l2.2 4.6M6 14.4l2-4.4"/><path d="M15.5 6.5h2.5"/></svg>';
  const HOME = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7v9h-5v-6h-6v6H4z"/></svg>';
  // Delivery partner: a raised, shaded badge (3D look) with a rider on a scooter, a soft shadow under it, a pulse ring in the
  // live / last-seen / offline colour and, when the phone reports it, an arrow showing the direction of travel. Our own drawing.
  const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16), c = (x) => Math.max(0, Math.min(255, Math.round(x * f))); return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`; };
  const RIDER3D = (color) => { const id = 'g' + color.slice(1), dk = shade(color, 0.42); return `<svg class="r3d" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><defs>
      <radialGradient id="${id}b" cx="35%" cy="25%" r="80%"><stop offset="0" stop-color="${shade(color, 1.5)}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, 0.6)}"/></radialGradient>
      <radialGradient id="${id}h" cx="50%" cy="0%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <linearGradient id="${id}x" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a52"/><stop offset="1" stop-color="#d4500f"/></linearGradient></defs>
    <ellipse cx="32" cy="60" rx="16" ry="3.6" fill="#000" opacity=".25"/>
    <circle cx="32" cy="32" r="24" fill="${dk}"/><circle cx="32" cy="28" r="24" fill="url(#${id}b)"/><circle cx="32" cy="28" r="22.6" fill="none" stroke="#fff" stroke-width="2.6"/>
    <ellipse cx="32" cy="15" rx="15" ry="7.5" fill="url(#${id}h)"/>
    <g transform="translate(12 13)">
      <circle cx="9" cy="25" r="4.6" fill="#fff"/><circle cx="9" cy="25" r="2" fill="${dk}"/><circle cx="31" cy="25" r="4.6" fill="#fff"/><circle cx="31" cy="25" r="2" fill="${dk}"/>
      <path d="M5.5 21.5Q6.5 15.5 13.5 15.5H23l2 6z" fill="#fff"/><path d="M23 21.5L28.5 12H32" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="2" y="6.5" width="11.5" height="9" rx="2" fill="url(#${id}x)" stroke="#fff" stroke-width="1.4"/><path d="M2.8 10h10" stroke="#fff" stroke-width="1" opacity=".7"/>
      <path d="M15.5 15.5L18 7.5h5.5l3 6.5-3.2 1.2-1.6-3.1-2 3.4z" fill="#fff"/><path d="M23.2 9.2l4.4 2.6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="20.8" cy="4.2" r="3.7" fill="#fff"/><path d="M21.6 3.2h3.3" stroke="${dk}" stroke-width="1.6" stroke-linecap="round"/></g></svg>`; };
  const riderIcon = (color, heading) => L.divIcon({ className: 'pl-mk pl-mk-rider pl-mk-3d', html: `<span class="ring" style="--c:${color}"></span>${heading != null ? `<span class="hd" style="--h:${heading}deg;--c:${color}"></span>` : ''}${RIDER3D(color)}`, iconSize: [64, 66], iconAnchor: [32, 38], tooltipAnchor: [0, -34] });
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
    const et = PL.$('#trketa'); if (et) et.innerHTML = d.eta ? `<b>${d.eta.minutes <= 1 ? 'Arriving now' : `~${d.eta.minutes} min`}</b><span>${(() => { const m = d.route ? d.route.distance_m : d.eta.straight_m; return m < 1000 ? m + ' m' : (m / 1000).toFixed(1) + ' km'; })()} ${d.route ? 'by road' : 'away'}${d.eta.from === 'stale' ? ' · last known position' : ' · live'}</span>` : '';
    if (d.rider) { m.put('rider', d.rider.lat, d.rider.lng, COLORS[d.state], 'Delivery partner · ' + T.label(d.state, d.age_sec), true, d.rider.heading); keys.push('rider'); }
    if (d.destination) { m.put('dest', d.destination.lat, d.destination.lng, '#d4500f', 'Delivery location'); keys.push('dest'); }
    if (d.route && d.state !== 'offline') { m.line('route', d.route.coords, COLORS[d.state]); keys.push('route'); }
    m.keep(keys); m.fit(); if (d.rider && d.state === 'live' && !m.map.getBounds().pad(-0.15).contains([d.rider.lat, d.rider.lng])) m.map.panTo([d.rider.lat, d.rider.lng], { animate: true });      // follow the rider only when near the edge
  }, 5000); };

  // admin: all active deliveries
  T.adminMount = () => { const el = PL.$('#admap'); live(el, async (m) => {
    let d; try { d = await PL.api('/api/tracking/admin/active'); } catch { return; }
    const list = PL.$('#admlist'); if (!list) return; const keys = [];
    list.innerHTML = d.deliveries.map((x) => `<div class="card"><div class="row between"><div>${PL.code(x.order_code)}</div>${PL.chip(x.status)}</div><div class="small"><b>${e(x.rider.name)}</b> · <a href="tel:${e(x.rider.phone)}">${e(x.rider.phone)}</a> · ${e(x.restaurant)}</div><div class="small mute">To: ${e(x.destination.text || '')}</div><div class="mt2"><span class="chip ${{ live: 'ok', stale: 'warn', offline: 'bad' }[x.state] || ''}">${e(T.label(x.state, x.age_sec))}</span></div></div>`).join('') || '<div class="empty">No deliveries are in progress.</div>';
    if (!m) return;
    for (const x of d.deliveries) { if (x.location) { m.put('r' + x.rider.id, x.location.lat, x.location.lng, COLORS[x.state], `${x.rider.name} · ${x.order_code} · ${T.label(x.state, x.age_sec)}`, true); keys.push('r' + x.rider.id); }
      if (x.destination.lat != null) { m.put('d' + x.id, x.destination.lat, x.destination.lng, '#d4500f', `Drop-off · ${x.order_code}`); keys.push('d' + x.id); }
      if (x.route) { m.line('l' + x.id, x.route, COLORS[x.state]); keys.push('l' + x.id); } }
    m.keep(keys); m.fit();
  }, 5000, true); };
})();
