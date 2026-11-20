// Restaurant location picker (restaurant portal + admin): one sheet with three ways to set the point, all shown on the map
// before saving: A) this device's GPS (with permission, accuracy shown), B) tap the map / drag the pin, C) typed latitude and
// longitude. Plus the full address. Nothing is assumed: the map opens without a pin until a point is chosen.
// Map = vendored Leaflet + the server's configured free tile source; without them the GPS and typed options still work.
(function () {
  const e = PL.esc;
  const okIndia = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= 6 && lat <= 37.5 && lng >= 68 && lng <= 97.5;
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  let cfgP = null; const tiles = () => (cfgP = cfgP || PL.api('/api/tracking/config').catch(() => { cfgP = null; return {}; }));
  const PIN = '<svg viewBox="0 0 24 24" width="34" height="34"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7z" fill="#e23744" stroke="#fff" stroke-width="1.6"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg>';
  const FIELDS = [['line', 'Street address', 'e.g. 12-1-133, Jaipuri Colony Road', 200], ['building', 'Building / shop name', 'e.g. Laxmi Nilayam, Shop 3', 100], ['area', 'Area / locality', 'e.g. Nagole', 100],
    ['city', 'City', 'e.g. Hyderabad', 60], ['state', 'State', 'e.g. Telangana', 60], ['pin', 'PIN code', '6 digits', 6]];

  // opts: { title, current: {lat,lng,source,address{...}}, save: async(payload) => truthy on success, admin: bool }
  PL.locPicker = (opts) => {
    const cur = opts.current || {}, a = cur.address || {};
    const st = { lat: cur.lat ?? null, lng: cur.lng ?? null, source: cur.lat != null ? (cur.source === 'admin' ? 'map' : cur.source || 'map') : null, acc: null };
    const id = 'lp' + Date.now();
    const ov = PL.modal(`<h3>${e(opts.title || 'Restaurant location')}</h3>
      <p class="small mute">Choose one way below. Check the pin is on your entrance, then fill in the address and save.</p>
      <div class="row wrap mt2" style="gap:8px"><button type="button" class="btn grow" data-lp="gps">${PL.icon('nav', 'width="18" height="18"')} Use current location</button><button type="button" class="btn ghost grow" data-lp="typed">Enter coordinates</button></div>
      <div class="lp-typed hide mt2"><div class="row" style="gap:8px"><div class="grow"><label>Latitude</label><input class="lp-lat" inputmode="decimal" placeholder="17.385000" autocomplete="off"></div><div class="grow"><label>Longitude</label><input class="lp-lng" inputmode="decimal" placeholder="78.486700" autocomplete="off"></div></div>
        <button type="button" class="btn ghost sm mt2" data-lp="typed-go">Show on map</button><div class="small mute mt2">Tip: in Google Maps press and hold your restaurant; the two numbers appear at the top (latitude first).</div></div>
      <div class="lp-map mt2" aria-label="Map: tap to place the pin, drag it to adjust"></div>
      <div class="lp-pt small mt2"></div>
      <form data-form="${id}" class="mt2">${FIELDS.map(([k, label, ph, max]) => `<label>${label}</label><input name="${k}" value="${e(a[k] || '')}" placeholder="${e(ph)}" maxlength="${max}" ${k === 'pin' ? 'inputmode="numeric" pattern="[1-9][0-9]{5}"' : ''} required>`).join('')}
        <label class="row lp-ok" style="gap:10px;font-weight:600;margin-top:14px"><input type="checkbox" name="ok" required style="width:22px;min-height:22px"> ${opts.admin ? 'I have checked this location and address' : 'The pin is at my restaurant and the address is correct'}</label>
        <button class="btn block mt" type="submit">Save location</button></form>`, { cls: 'lp-sheet' });
    const $ = (s) => ov.querySelector(s), mapEl = $('.lp-map');
    let map = null, marker = null;
    const show = () => {
      $('.lp-pt').innerHTML = st.lat == null ? '<span class="mute">No point chosen yet.</span>'
        : `<b>${st.lat.toFixed(6)}, ${st.lng.toFixed(6)}</b> · <span class="mute">${{ gps: `GPS, accurate to about ${st.acc} m`, map: 'placed on the map', manual: 'typed in' }[st.source] || ''}</span> · <a href="https://www.google.com/maps?q=${st.lat},${st.lng}" target="_blank" rel="noopener">Check on Google Maps</a>
          ${st.source === 'gps' && st.acc > 200 ? '<div class="banner warn mt2">This GPS reading is not accurate enough (over 200 m). Drag the pin to the right spot, try again outside, or type the coordinates.</div>' : ''}`;
      if (map && st.lat != null) {
        if (!marker) { marker = L.marker([st.lat, st.lng], { draggable: true, icon: L.divIcon({ className: 'lp-pin', html: PIN, iconSize: [34, 34], iconAnchor: [17, 32] }) }).addTo(map);
          marker.on('dragend', () => { const p = marker.getLatLng(); set(p.lat, p.lng, 'map'); }); }
        marker.setLatLng([st.lat, st.lng]); map.setView([st.lat, st.lng], Math.max(map.getZoom(), 17));
      }
    };
    const set = (lat, lng, source, acc) => {
      lat = r6(lat); lng = r6(lng);
      if (!okIndia(lat, lng)) return PL.toast('That point is outside India. Check that latitude and longitude are not swapped (latitude ~8–37, longitude ~68–97).', true);
      Object.assign(st, { lat, lng, source, acc: acc ?? null }); show();
    };
    (async () => {
      const c = await tiles();
      if (!window.L || !c.tile_url) { mapEl.innerHTML = '<div class="empty small" style="padding:16px">The map is not available on this server, so use your current location or type the coordinates.</div>'; mapEl.style.height = 'auto'; show(); return; }
      // without a point the map shows the city (no pin): nothing is placed until the owner chooses
      map = L.map(mapEl, { zoomControl: true }).setView(st.lat != null ? [st.lat, st.lng] : [17.385, 78.4867], st.lat != null ? 17 : 11);
      L.tileLayer(c.tile_url, { maxZoom: 19, attribution: c.attribution, referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(map);
      map.on('click', (ev) => set(ev.latlng.lat, ev.latlng.lng, 'map'));
      setTimeout(() => map.invalidateSize(), 300); show();
    })();
    ov.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-lp]'); if (!b) return;
      if (b.dataset.lp === 'typed') { $('.lp-typed').classList.toggle('hide'); $('.lp-lat').focus(); }
      if (b.dataset.lp === 'typed-go') {
        const lat = Number($('.lp-lat').value.trim()), lng = Number($('.lp-lng').value.trim());
        if (!$('.lp-lat').value.trim() || !$('.lp-lng').value.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) return PL.toast('Enter both numbers, e.g. latitude 17.385000 and longitude 78.486700.', true);
        set(lat, lng, 'manual');
      }
      if (b.dataset.lp === 'gps') {
        if (!navigator.geolocation) return PL.toast('This browser cannot read your location. Use the map or type the coordinates.', true);
        b.disabled = true; b.classList.add('busy');
        navigator.geolocation.getCurrentPosition((p) => { b.disabled = false; b.classList.remove('busy'); set(p.coords.latitude, p.coords.longitude, 'gps', Math.round(p.coords.accuracy)); },
          (er) => { b.disabled = false; b.classList.remove('busy'); PL.toast(er.code === 1 ? 'Location permission is blocked. Allow location for this site (lock icon in the address bar), or use the map / type the coordinates.' : 'Could not read your location. Try again near a window or outside, or use the map.', true); },
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
      }
    });
    PL.forms[id] = async (f) => {
      if (st.lat == null) return PL.toast('Choose the location first: current location, tap the map, or type the coordinates.', true);
      if (st.source === 'gps' && st.acc > 200) return PL.toast('The GPS reading is not accurate enough. Drag the pin to the exact spot or type the coordinates.', true);
      const v = PL.form(f), address = Object.fromEntries(FIELDS.map(([k]) => [k, (v[k] || '').trim()]));
      if (!/^[1-9][0-9]{5}$/.test(address.pin)) return PL.toast('Enter a 6-digit PIN code.', true);
      const ok = await opts.save({ lat: st.lat, lng: st.lng, source: st.source, ...(st.source === 'gps' ? { accuracy_m: st.acc } : {}), address });
      if (ok) { await PL.closeModalAsync(); PL.rerender(); }
    };
    return ov;
  };
  // small read-only map (admin list / restaurant summary); falls back to text
  PL.locPreview = async (el, lat, lng) => { const c = await tiles(); if (!window.L || !c.tile_url || lat == null) return;
    const m = L.map(el, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, keyboard: false, attributionControl: true }).setView([lat, lng], 16);
    L.tileLayer(c.tile_url, { maxZoom: 19, attribution: c.attribution, referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(m);
    L.marker([lat, lng], { icon: L.divIcon({ className: 'lp-pin', html: PIN, iconSize: [34, 34], iconAnchor: [17, 32] }) }).addTo(m); setTimeout(() => m.invalidateSize(), 200); };
})();
