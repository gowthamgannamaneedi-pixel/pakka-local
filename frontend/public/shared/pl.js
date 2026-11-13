/* Pakka Local shared kit. No secrets here; the API base comes from config.js. */
(function () {
  const PL = (window.PL = { actions: {}, forms: {}, state: {} });
  const API = (window.PL_CONFIG && window.PL_CONFIG.API_BASE) || '';
  PL.API = API;
  PL.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const e = PL.esc;
  PL.rs = (p) => { p = p || 0; return (p < 0 ? '-' : '') + '₹' + (Math.abs(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: Math.abs(p) % 100 ? 2 : 0, maximumFractionDigits: 2 }); };
  PL.time = (i) => (i ? new Date(i).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');
  PL.dt = (i) => (i ? new Date(i).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  PL.$ = (s, r = document) => r.querySelector(s);

  const ICONS = {
    home: 'M3 11l9-8 9 8M5 10v10h14V10', orders: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6', bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4', clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2', camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z', check: 'M5 12l5 5L20 7', alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
    cart: 'M3 4h3l2 11h10l2-8H7M9 20h.01M17 20h.01', menu: 'M4 6h16M4 12h16M4 18h10', wallet: 'M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7l12-3v3M16 14h2', bike: 'M5 18a3 3 0 100-6 3 3 0 000 6zM19 18a3 3 0 100-6 3 3 0 000 6zM12 18l-2-6h6l3 6M8 8h3',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5', shop: 'M4 9l1-5h14l1 5M4 9v11h16V9M4 9a3 3 0 006 0 3 3 0 006 0 3 3 0 004 0', pin: 'M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11zM12 12a2 2 0 100-4 2 2 0 000 4z',
    chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2', check: 'M5 12l5 5 9-10', bolt: 'M13 2L4 14h7l-1 8 9-12h-7z', gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 00-1.7-1L14.5 3h-4l-.4 3a7 7 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 000 2l-2 1.6 2 3.4 2.4-1a7 7 0 001.7 1l.4 3h4l.4-3a7 7 0 001.7-1l2.4 1 2-3.4-2-1.6c.1-.3.1-.7.1-1z',
    sound: 'M4 9v6h4l5 4V5L8 9zM16 8a5 5 0 010 8', mute: 'M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18', phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z'
  };
  PL.icon = (n, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}><path d="${ICONS[n] || ''}"/></svg>`;

  // ---------- sessions: one independent slot per portal ----------
  PL.portal = null;
  const key = () => `pl.session.${PL.portal}`;
  PL.session = () => { try { return JSON.parse(localStorage.getItem(key())); } catch { return null; } };
  PL.setSession = (s) => localStorage.setItem(key(), JSON.stringify(s));
  PL.clearSession = () => localStorage.removeItem(key());

  PL.api = async (path, opts = {}) => {
    const s = PL.session();
    let res;
    try {
      res = await fetch(API + path, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: 'Bearer ' + s.token } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    } catch { throw new Error('No connection. Please check your internet.'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && s && !path.startsWith('/api/auth/')) { PL.clearSession(); PL.stopAll(); PL.boot(); throw new Error('Your session has expired. Please sign in again.'); }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status, code: data.code });
    return data;
  };
  PL.post = (p, body) => PL.api(p, { method: 'POST', body: body || {} });
  PL.put = (p, body) => PL.api(p, { method: 'PUT', body });

  PL.toast = (msg, bad) => { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 3200); };
  // run an action, toast on failure, only show success text when the backend says OK
  PL.run = async (fn, ok) => { try { const r = await fn(); if (ok) PL.toast(ok); return r; } catch (err) { PL.toast(err.message, true); return null; } };
  PL.copy = (t) => { navigator.clipboard?.writeText(t).then(() => PL.toast('Copied')).catch(() => PL.toast('Copy failed', true)); };
  PL.code = (c) => `<span class="code">${e(c)}</span><button class="copy" data-act="copy" data-v="${e(c)}">Copy</button>`;
  PL.chip = (s) => { const m = { DELIVERED: 'ok', PICKED_UP: 'brand', READY: 'brand', PREPARING: 'warn', ACCEPTED: 'warn', PLACED: 'warn', REJECTED: 'bad', EXPIRED: 'bad', PAYMENT_FAILED: 'bad', approved: 'ok', pending: 'warn', rejected: 'bad', suspended: 'bad', corrections_requested: 'warn', draft: '', reverification_required: 'warn', PAID: 'ok', APPROVED: 'brand', PENDING: 'warn', REFUND_COMPLETED: 'ok', REFUND_INITIATED: 'warn', REFUND_FAILED: 'bad' }; return `<span class="chip ${m[s] || ''}">${e(PL.LABEL[s] || String(s).replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()))}</span>`; };
  // agent verification states, worded the same way in every portal
  PL.LABEL = { draft: 'Application not submitted', pending: 'Pending verification', approved: 'Approved', rejected: 'Rejected', corrections_requested: 'Corrections requested', suspended: 'Suspended', reverification_required: 'Re-verification required' };
  // private file (identity document, proof): fetched with the session token and opened in a new tab; never a public URL
  PL.openDoc = async (url) => { const w = window.open('', '_blank'); try { const r = await fetch(API + url, { headers: { Authorization: 'Bearer ' + PL.session().token } }); if (!r.ok) throw new Error(); const b = URL.createObjectURL(await r.blob()); if (w) w.location = b; else location.href = b; } catch { if (w) w.close(); PL.toast('Could not open the document.', true); } };
  // sensitive admin actions: ask for the password (and authenticator code if MFA is on) and send them with the request
  PL.reauth = (title, run) => new Promise((done) => { const id = 'ra' + Date.now(); PL.forms[id] = async (f) => { const v = PL.form(f); const r = await PL.run(() => run({ reauth_password: v.pw, ...(v.totp ? { reauth_totp: v.totp } : {}) })); if (r) { PL.closeModal(); done(r); } };
    PL.modal(`<h3>${e(title)}</h3><p class="small mute">This action is logged. Confirm it is you.</p><form data-form="${id}"><label>Your password</label><input name="pw" type="password" autocomplete="current-password" required><label>Authenticator code (only if you turned on two-step sign-in)</label><input name="totp" inputmode="numeric" maxlength="6" autocomplete="one-time-code"><button class="btn block mt" type="submit">Confirm</button></form>`, { onClose: () => done(null) }); });
  PL.img = (p, cls = 'thumb') => (p ? `<img class="${cls}" loading="lazy" alt="" src="${API}/api/files/public/${e(p)}">` : `<div class="${cls}" style="display:grid;place-items:center;color:#b9b3a8">${PL.icon('shop', 'width="28" height="28"')}</div>`);
  PL.mapsBtn = (url, label) => (url ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="${e(url)}">${PL.icon('pin', 'width="18" height="18"')} ${e(label)}</a>` : '');

  // authenticated images (private files)
  const AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#f1ece4"/><circle cx="32" cy="25" r="11" fill="#c9bfae"/><path d="M10 60c2-14 12-20 22-20s20 6 22 20z" fill="#c9bfae"/></svg>');
  const blobCache = {};
  PL.hydrate = (root = document) => root.querySelectorAll('img[data-authimg]').forEach(async (img) => {
    const u = img.dataset.authimg; if (!u) return;
    try { if (!blobCache[u]) blobCache[u] = fetch(API + u, { headers: { Authorization: 'Bearer ' + PL.session().token } }).then((r) => (r.ok ? r.blob() : Promise.reject())).then((b) => URL.createObjectURL(b)); img.src = await blobCache[u]; img.removeAttribute('data-authimg'); } catch { img.src = AVATAR; delete blobCache[u]; }
  });
  PL.readFile = (file, { max = 1400 } = {}) => new Promise((ok, no) => {
    if (!file) return no(new Error('Choose a file first.'));
    if (file.size > 6e6) return no(new Error('File is too large (max 6 MB).'));
    const fr = new FileReader();
    fr.onerror = () => no(new Error('Could not read file.'));
    fr.onload = () => {
      if (!file.type.startsWith('image/')) return ok(String(fr.result).split(',')[1]);
      const im = new Image(); im.onerror = () => no(new Error('Not a valid image.'));
      im.onload = () => { const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); ok(c.toDataURL('image/jpeg', 0.85).split(',')[1]); };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
  PL.form = (f) => { const o = {}; new FormData(f).forEach((v, k) => { if (!(v instanceof File)) o[k] = v; }); return o; };

  // ---------- history-aware navigation + modals ----------
  let routes = [], cfg, view, idx = 0, modals = [], pollT = null, lastHtml = '', cur = null;
  const compile = (p) => { const names = []; const re = new RegExp('^' + p.replace(/:([a-z]+)/g, (_, n) => (names.push(n), '([^/]+)')) + '$'); return { re, names }; };
  const here = () => (location.hash.slice(1) || cfg.home).split('?')[0];
  PL.go = (path, replace) => { const st = { idx: replace ? idx : idx + 1 }; if (replace) history.replaceState(st, '', '#' + path); else history.pushState(st, '', '#' + path); idx = st.idx; render(); };
  PL.back = () => { if (modals.length) return PL.closeModal(); if (idx > 0) history.back(); else PL.go(cfg.home, true); };
  PL.rerender = () => render(true);
  PL.modal = (html, { onClose } = {}) => {
    const ov = document.createElement('div'); ov.className = 'ov';
    ov.innerHTML = `<div class="sheet" role="dialog">${html}</div>`; ov.addEventListener('mousedown', (ev) => { if (ev.target === ov) PL.closeModal(); });
    document.body.append(ov); modals.push({ ov, onClose }); history.pushState({ idx, modal: modals.length }, ''); PL.hydrate(ov); return ov;
  };
  const dropTop = () => { const m = modals.pop(); if (m) { m.ov.remove(); m.onClose && m.onClose(); } };
  // Idempotent: a second close request while history.back() is still in flight must not pop another real page.
  let closing = false;
  PL.closeModal = () => { if (!modals.length || closing) return; if (history.state && history.state.modal) { closing = true; history.back(); setTimeout(() => { closing = false; }, 500); } else dropTop(); };
  PL.confirm = (msg, label = 'Confirm') => new Promise((ok) => { let done = false; const ov = PL.modal(`<h3>${e(msg)}</h3><div class="row mt"><button class="btn ghost grow" data-x="0">Cancel</button><button class="btn grow" data-x="1">${e(label)}</button></div>`, { onClose: () => !done && ok(false) });
    ov.addEventListener('click', (ev) => { const b = ev.target.closest('[data-x]'); if (b) { done = true; ok(b.dataset.x === '1'); PL.closeModal(); } }); });
  window.addEventListener('popstate', (ev) => {
    const st = ev.state || { idx: 0 };
    closing = false;
    if (modals.length > (st.modal || 0)) { dropTop(); return; }
    idx = st.idx || 0; render();
  });

  async function render(soft) {
    const path = here(); let match = null;
    for (const r of routes) { const m = r.re.exec(path); if (m) { match = { r, params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) }; break; } }
    if (!match) return PL.go(cfg.home, true);
    const { r, params } = match; clearInterval(pollT); const token = ++PL.state.rtoken;     // a newer navigation supersedes this one
    const top = PL.$('#top .title'); if (top) top.textContent = typeof r.def.title === 'function' ? r.def.title(params) : r.def.title || cfg.name;
    PL.$('#top .back').classList.toggle('hidden', cfg.tabs.some((t) => t.path === path) && idx === 0);
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', path === b.dataset.path || path.startsWith(b.dataset.path + '/')));
    document.querySelector('.shell').classList.toggle('nonav', !!r.def.noNav);
    PL.$('#nav').classList.toggle('hide', !!r.def.noNav);
    const paint = async (first) => {
      const sig = ++PL.state.sig;
      try {
        const html = await r.def.render(params);
        if (sig !== PL.state.sig) return;
        if (html !== lastHtml || first) { const keepY = window.scrollY; view.innerHTML = html; lastHtml = html; PL.hydrate(view); r.def.after && r.def.after(view, params); if (!first) window.scrollTo(0, keepY); }
      } catch (err) { if (first) view.innerHTML = `<div class="empty">${e(err.message)}<br><button class="btn mt" data-act="reload">Try again</button></div>`; }
    };
    if (!soft) { lastHtml = ''; view.innerHTML = '<div class="loading">Loading…</div>'; window.scrollTo(0, 0); }
    cur = r; await paint(true);
    if (token !== PL.state.rtoken) return;          // superseded while loading: never start a poll for a stale route
    if (r.def.poll) pollT = setInterval(() => { const a = document.activeElement; if (document.hidden || modals.length || (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && view.contains(a)) || [...view.querySelectorAll('form[data-form] input[type=text],form[data-form] input:not([type])')].some((i) => i.value)) return; paint(false); }, r.def.poll);
  }
  PL.state.sig = 0; PL.state.rtoken = 0;
  PL.stopAll = () => { clearInterval(pollT); (PL.hooks.stop || []).forEach((f) => f()); PL.sound.sync(false); };
  PL.hooks = {};

  // ---------- sound & alerts ----------
  const audio = new Audio('/assets/ringing_sound.mp3'); audio.loop = true; audio.preload = 'auto';
  let want = false;
  PL.sound = {
    enabled: () => localStorage.getItem('pl.sound') === '1',
    unlocked: false, playing: () => !audio.paused,
    async enable() { try { await audio.play(); audio.pause(); audio.currentTime = 0; PL.sound.unlocked = true; localStorage.setItem('pl.sound', '1'); PL.sound.sync(want); return true; } catch { PL.toast('Your browser blocked sound. Tap again.', true); return false; } },
    disable() { localStorage.setItem('pl.sound', '0'); PL.sound.sync(false, true); },
    // one loop for ALL outstanding alerts; stops the moment nothing needs action
    sync(active, keep) { if (!keep) want = active; if (active && PL.sound.enabled() && PL.sound.unlocked && !document.hidden) audio.play().catch(() => {}); else { audio.pause(); audio.currentTime = 0; } }
  };
  document.addEventListener('visibilitychange', () => PL.sound.sync(want, true));

  // ---------- PWA install ----------
  let deferred;
  window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); deferred = ev; showInstall(); });
  window.addEventListener('appinstalled', () => { localStorage.setItem(`pl.installed.${PL.portal}`, '1'); PL.$('#install')?.remove(); });
  function showInstall() {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone || localStorage.getItem(`pl.installed.${PL.portal}`) || Date.now() - Number(localStorage.getItem(`pl.install.dismissed.${PL.portal}`) || 0) < 7 * 864e5 || PL.$('#install')) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !deferred;
    if (!deferred && !ios) return;
    const d = document.createElement('div'); d.id = 'install'; d.className = 'install';
    d.innerHTML = `<img src="/assets/icon-192.png" alt=""><div class="grow"><b>Install Pakka Local</b><div class="small mute">${ios ? 'Tap Share, then “Add to Home Screen”.' : 'Add the app to your home screen.'}</div></div>${deferred ? '<button class="btn sm" data-act="install">Install</button>' : ''}<button class="iconbtn" data-act="install-dismiss" aria-label="Dismiss">${PL.icon('x')}</button>`;
    document.body.append(d);
  }
  PL.actions.install = async () => { if (!deferred) return; deferred.prompt(); const r = await deferred.userChoice; deferred = null; PL.$('#install')?.remove(); if (r.outcome === 'dismissed') localStorage.setItem(`pl.install.dismissed.${PL.portal}`, Date.now()); };
  PL.actions['install-dismiss'] = () => { localStorage.setItem(`pl.install.dismissed.${PL.portal}`, Date.now()); PL.$('#install')?.remove(); };
  PL.actions.copy = (el) => PL.copy(el.dataset.v);
  PL.actions.back = () => PL.back();
  PL.actions.reload = () => render();
  PL.actions.nav = (el) => { if (here() !== el.dataset.path) PL.go(el.dataset.path); };
  PL.actions.go = (el) => PL.go(el.dataset.path);
  PL.actions['close-modal'] = () => PL.closeModal();
  PL.actions.logout = async () => { if (!(await PL.confirm('Sign out of this portal?', 'Sign out'))) return; try { PL.track && PL.track.stop(); if (PL.push) await PL.push.disable(); } catch {}      /* a signed-out device must stop sharing location and stop receiving this account's notifications */
    try { await PL.post('/api/auth/logout-all'); } catch {} PL.stopAll(); PL.clearSession(); PL.boot(); };
  PL.actions['sound-toggle'] = async (el) => { if (PL.sound.enabled() && PL.sound.unlocked) { PL.sound.disable(); } else await PL.sound.enable(); el.innerHTML = PL.icon(PL.sound.enabled() ? 'sound' : 'mute'); };

  document.addEventListener('click', (ev) => { const el = ev.target.closest('[data-act]'); if (!el) return; const a = PL.actions[el.dataset.act]; if (a) { ev.preventDefault(); a(el, ev); } });
  document.addEventListener('submit', (ev) => { const f = ev.target.closest('form[data-form]'); if (!f) return; ev.preventDefault(); const h = PL.forms[f.dataset.form]; if (h) { const b = f.querySelector('button[type=submit]'); if (b?.disabled) return; if (b) b.disabled = true; Promise.resolve(h(f, ev)).finally(() => { if (b) b.disabled = false; }); } });

  // ---------- shell ----------
  // cfg: { portal, name, home, tabs:[{path,label,icon,badge?}], routes:{path:{title,render,after,poll,noNav}}, loginView(), onReady(), right() }
  PL.start = (c) => { cfg = c; PL.portal = c.portal; if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); PL.boot(); setTimeout(showInstall, 1500); };
  PL.boot = () => {
    document.title = `${cfg.name} · Pakka Local`;
    const root = PL.$('#root'); modals.splice(0).forEach((m) => m.ov.remove());
    if (!PL.session()) { clearInterval(pollT); root.innerHTML = ''; return cfg.loginView(root); }
    routes = Object.entries({ ...cfg.routes, ...(PL.extraRoutes || {}) }).map(([p, def]) => ({ ...compile(p), def }));
    root.innerHTML = `<header class="top" id="top"><button class="back" data-act="back" aria-label="Back">‹ Back</button><div class="title"></div><div class="side" id="side">${cfg.right ? cfg.right() : ''}</div></header>
      <div class="shell"><main id="view"></main></div>
      <nav class="bottom" id="nav">${cfg.tabs.map((t) => `<button data-act="nav" data-path="${t.path}">${PL.icon(t.icon)}<span>${e(t.label)}</span><i class="badge hide" id="bd-${t.path.slice(1)}"></i></button>`).join('')}</nav>`;
    view = PL.$('#view'); idx = (history.state && history.state.idx) || 0;
    history.replaceState({ idx }, '', location.hash || '#' + cfg.home);
    cfg.onReady && cfg.onReady(); render(); PL.push && PL.push.boot();
  };
  PL.badge = (path, n) => { const b = PL.$('#bd-' + path.slice(1)); if (b) { b.textContent = n; b.classList.toggle('hide', !n); } };

  // Staff login (restaurant / rider / admin): accounts are created by an admin, no sign-up.
  PL.staffLogin = (root, { title, blurb }) => {
    root.innerHTML = `<div class="loginbox"><img class="logo" src="/assets/logo.png" alt="Pakka Local"><h1 style="text-align:center">${e(title)}</h1><p class="mute" style="text-align:center">${e(blurb)}</p>
      <form data-form="login"><label>Mobile number</label><input name="phone" inputmode="tel" autocomplete="username" placeholder="+91 98765 43210" required>
      <label>Password</label><input name="password" type="password" autocomplete="current-password" required><div id="mfa" class="hide"><label>Authenticator code</label><input name="totp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6-digit code"></div><button class="btn block mt" type="submit">Sign in</button></form>
      <p class="small mute mt" style="text-align:center">Accounts are created by Pakka Local. Contact the team if you need access.</p></div>`;
    PL.forms.login = async (f) => { const v = PL.form(f); let phone = v.phone.replace(/[\s-]/g, ''); if (/^\d{10}$/.test(phone)) phone = '+91' + phone;
      const body = { portal: PL.portal, phone, password: v.password }; if (v.totp) body.totp = v.totp;
      try { const r = await PL.post('/api/auth/login', body); PL.setSession(r); history.replaceState({ idx: 0 }, '', location.hash || '#'); PL.boot(); }
      catch (err) { if (err.code === 'MFA_REQUIRED') { PL.$('#mfa').classList.remove('hide'); PL.$('#mfa input').focus(); } PL.toast(err.message, !!v.totp || err.code !== 'MFA_REQUIRED'); } };
  };
})();
