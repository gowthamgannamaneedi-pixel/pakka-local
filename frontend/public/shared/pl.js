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

  const ICONS = { chat: 'M4 5h16v11H9l-5 4z M8 10h8 M8 13h5',
    home: 'M3 11l9-8 9 8M5 10v10h14V10', orders: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6', bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4', clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2', camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z', check: 'M5 12l5 5L20 7', alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
    cart: 'M3 4h3l2 11h10l2-8H7M9 20h.01M17 20h.01', menu: 'M4 6h16M4 12h16M4 18h10', wallet: 'M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7l12-3v3M16 14h2', bike: 'M5 18a3 3 0 100-6 3 3 0 000 6zM19 18a3 3 0 100-6 3 3 0 000 6zM12 18l-2-6h6l3 6M8 8h3',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5', shop: 'M4 9l1-5h14l1 5M4 9v11h16V9M4 9a3 3 0 006 0 3 3 0 006 0 3 3 0 004 0', pin: 'M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11zM12 12a2 2 0 100-4 2 2 0 000 4z',
    chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2', check: 'M5 12l5 5 9-10', bolt: 'M13 2L4 14h7l-1 8 9-12h-7z', gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 00-1.7-1L14.5 3h-4l-.4 3a7 7 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 000 2l-2 1.6 2 3.4 2.4-1a7 7 0 001.7 1l.4 3h4l.4-3a7 7 0 001.7-1l2.4 1 2-3.4-2-1.6c.1-.3.1-.7.1-1z',
    sound: 'M4 9v6h4l5 4V5L8 9zM16 8a5 5 0 010 8', mute: 'M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18', chev: 'M9 5l7 7-7 7', logout: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h11', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
    users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21c0-4 3-6 7-6s7 2 7 6M16 3.5a4 4 0 010 7.5M18 15c2.4.6 4 2.4 4 6', map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14', trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3', info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01', filter: 'M3 5h18M6 12h12M10 19h4', nav: 'M3 11l18-8-8 18-2-8z',
    refresh: 'M20 11a8 8 0 10-2.3 5.7M20 5v6h-6', chef: 'M7 14h10v6H7zM7 14a4 4 0 01-1-7.9A5 5 0 0116 5a4 4 0 011 9', box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10', percent: 'M19 5L5 19M7 9a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z', phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z'
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
    if (res.status === 401 && s && !path.startsWith('/api/auth/') && !/^REAUTH/.test(data.code || ''))   /* a wrong confirmation password is not a lost session */ { PL.clearSession(); PL.stopAll(); PL.boot(); throw new Error('Your session has expired. Please sign in again.'); }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status, code: data.code, retryAfterSec: data.retryAfterSec });
    return data;
  };
  PL.post = (p, body) => PL.api(p, { method: 'POST', body: body || {} });
  PL.put = (p, body) => PL.api(p, { method: 'PUT', body });

  // ---------- toasts: stacked, typed (ok | bad | info), announced to screen readers, optional action ----------
  // PL.toast(msg)            success style
  // PL.toast(msg, true)      error style (kept for older calls)
  // PL.toast(msg, 'info', { title, path, label, ms })
  const toastBox = () => PL.$('#toasts') || (() => { const b = document.createElement('div'); b.id = 'toasts'; b.className = 'toasts'; b.setAttribute('aria-live', 'polite'); b.setAttribute('role', 'status'); document.body.append(b); return b; })();
  const TICON = { ok: 'check', bad: 'alert', info: 'bell' };
  PL.toast = (msg, kind, o = {}) => {
    const k = kind === true ? 'bad' : kind || 'ok', box = toastBox(), key = k + '|' + (o.title || '') + '|' + msg;
    [...box.children].forEach((x) => { if (x.dataset.k === key) x.remove(); });            // never stack the same message twice
    while (box.children.length >= 3) box.firstElementChild.remove();
    const t = document.createElement('div'); t.className = 'toast t-' + k; t.dataset.k = key; if (k === 'bad') t.setAttribute('role', 'alert');
    t.innerHTML = `<span class="ti">${PL.icon(TICON[k] || 'check')}</span><span class="tx">${o.title ? `<b>${e(o.title)}</b>` : ''}<span>${e(msg)}</span></span>${o.path ? `<button class="ta" data-act="go" data-path="${e(o.path)}">${e(o.label || 'View')}</button>` : ''}<button class="tc" aria-label="Dismiss">${PL.icon('x')}</button>`;
    const out = () => { if (!t.isConnected || t.classList.contains('out')) return; t.classList.add('out'); setTimeout(() => t.remove(), 220); };
    t.querySelector('.tc').onclick = out; t.addEventListener('click', (ev) => { if (ev.target.closest('.ta')) out(); });
    box.append(t); setTimeout(out, o.ms || (k === 'bad' ? 5200 : o.title ? 5200 : 3000)); return t;
  };
  // run an action, toast on failure, only show success text when the backend says OK
  PL.run = async (fn, ok) => { try { const r = await fn(); if (ok) PL.toast(ok, 'ok'); return r; } catch (err) { PL.toast(err.message, true); return null; } };
  // Full-screen result animation (order placed, payment, delivery done). Call ONLY after the backend confirmed the result.
  PL.celebrate = ({ ok = true, title, sub = '', ms = 1900 } = {}) => new Promise((done) => {
    const d = document.createElement('div'); d.className = 'celebrate ' + (ok ? 'ok' : 'bad'); d.setAttribute('role', 'alert');
    d.innerHTML = `<div class="cb"><svg class="mark" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/>${ok ? '<path d="M15 27l7 7 15-16"/>' : '<path d="M18 18l16 16M34 18L18 34"/>'}</svg><h2>${e(title || (ok ? 'Done' : 'Something went wrong'))}</h2>${sub ? `<p>${e(sub)}</p>` : ''}</div>${ok ? '<i class="burst" aria-hidden="true">' + Array.from({ length: 12 }, (_, i) => `<b style="--a:${i * 30}deg"></b>`).join('') + '</i>' : ''}`;
    const close = () => { if (!d.isConnected) return; d.classList.add('out'); setTimeout(() => { d.remove(); done(); }, 240); };
    d.addEventListener('click', close); document.body.append(d); setTimeout(close, ms);
  });
  // button busy state for actions that are not forms (forms get it automatically)
  PL.busy = async (el, fn) => { if (!el || el.classList.contains('busy')) return; el.classList.add('busy'); el.disabled = true; try { return await fn(); } finally { if (el.isConnected) { el.classList.remove('busy'); el.disabled = false; } } };
  // skeleton placeholders shaped like the screen that is loading
  PL.skel = (kind = 'list') => {
    const line = (w, h = 12) => `<i class="sk" style="width:${w};height:${h}px"></i>`;
    const row = () => `<div class="sk-row"><i class="sk sk-sq"></i><div class="grow">${line('62%', 14)}${line('38%')}</div>${line('48px', 14)}</div>`;
    const card = () => `<div><i class="sk sk-img"></i>${line('70%', 15)}${line('45%')}</div>`;
    if (kind === 'cards') return `<div class="sk-wrap">${line('46%', 22)}${line('100%', 46)}<div class="sk-grid">${card()}${card()}${card()}</div></div>`;
    if (kind === 'dash') return `<div class="sk-wrap"><div class="sk-tiles">${'<i class="sk sk-tile"></i>'.repeat(4)}</div><i class="sk" style="height:180px;border-radius:16px"></i>${row()}${row()}${row()}</div>`;
    if (kind === 'detail') return `<div class="sk-wrap"><i class="sk" style="height:132px;border-radius:18px"></i>${line('40%', 16)}${row()}${row()}<i class="sk" style="height:96px;border-radius:16px"></i></div>`;
    if (kind === 'menu') return `<div class="sk-wrap">${line('55%', 24)}${line('35%')}<i class="sk" style="height:56px;border-radius:14px"></i>${'<div class="sk-dish"><div class="grow">' + line('60%', 15) + line('25%') + line('85%') + '</div><i class="sk sk-ph"></i></div>'.repeat(3)}</div>`;
    return `<div class="sk-wrap">${row()}${row()}${row()}${row()}</div>`;
  };
  // Clipboard API first; older Android browsers fall back to a hidden textarea; if both fail, show the text to copy by hand.
  PL.copy = async (t) => { try { await navigator.clipboard.writeText(t); return PL.toast('Copied'); } catch {}
    try { const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-100px;opacity:0'; document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); if (ok) return PL.toast('Copied'); } catch {}
    PL.modal(`<h3>Copy this</h3><p class="small mute">Press and hold the text, then choose Copy.</p><textarea readonly style="min-height:90px">${e(t)}</textarea><button class="btn block mt" data-act="close-modal">Done</button>`); };
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
  PL.modal = (html, { onClose, cls = '' } = {}) => {
    const ov = document.createElement('div'); ov.className = 'ov ' + cls;
    ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab" aria-hidden="true"><i></i></div>${html}</div>`; ov.addEventListener('mousedown', (ev) => { if (ev.target === ov) PL.closeModal(); });
    // drag the handle down to dismiss (phones); Escape closes on keyboards
    const sh = ov.firstElementChild, g = sh.querySelector('.grab'); let y0 = null;
    g.addEventListener('pointerdown', (ev) => { y0 = ev.clientY; g.setPointerCapture(ev.pointerId); sh.style.transition = 'none'; });
    g.addEventListener('pointermove', (ev) => { if (y0 != null) sh.style.transform = `translateY(${Math.max(0, ev.clientY - y0)}px)`; });
    g.addEventListener('pointerup', (ev) => { if (y0 == null) return; const dy = ev.clientY - y0; y0 = null; sh.style.transition = ''; sh.style.transform = ''; if (dy > 90) PL.closeModal(); });
    setTimeout(() => sh.querySelector('input:not([type=hidden]):not([readonly]),select,textarea')?.focus({ preventScroll: true }), 260);
    document.body.append(ov); modals.push({ ov, onClose }); history.pushState({ idx, modal: modals.length }, ''); PL.hydrate(ov); return ov;
  };
  const dropTop = () => { const m = modals.pop(); if (m) { m.ov.remove(); m.onClose && m.onClose(); } };
  // Idempotent: a second close request while history.back() is still in flight must not pop another real page.
  let closing = false;
  PL.closeModal = () => { if (!modals.length || closing) return; if (history.state && history.state.modal) { closing = true; history.back(); setTimeout(() => { closing = false; }, 500); } else dropTop(); };
  // close the top modal and wait until it is really gone (closing goes through history.back, which is asynchronous)
  PL.closeModalAsync = () => new Promise((done) => { const n = modals.length; if (!n) return done(); PL.closeModal(); const t0 = Date.now(), iv = setInterval(() => { if (modals.length < n || Date.now() - t0 > 1000) { clearInterval(iv); setTimeout(done, 30); } }, 20); });
  // Confirmation dialog. Destructive wording ("Delete", "Reject", "Remove", "Sign out", "Cancel order"...) gets the red style automatically.
  PL.confirm = (msg, label = 'Confirm', { text = '', danger } = {}) => new Promise((ok) => { let done = false; const bad = danger ?? /delete|remove|reject|cancel|sign out|suspend|unassign|disable|turn off/i.test(label);
    const ov = PL.modal(`<div class="cf ${bad ? 'bad' : ''}"><span class="cf-ic">${PL.icon(bad ? 'alert' : 'check')}</span><h3>${e(msg)}</h3>${text ? `<p class="small mute">${e(text)}</p>` : ''}</div><div class="row mt"><button class="btn ghost grow" data-x="0">Go back</button><button class="btn grow ${bad ? 'danger solid' : ''}" data-x="1">${e(label)}</button></div>`, { onClose: () => !done && ok(false), cls: 'ov-cf' });
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
        if (html !== lastHtml || first) { const keepY = window.scrollY; view.innerHTML = html; lastHtml = html; PL.hydrate(view); r.def.after && r.def.after(view, params); if (!first) window.scrollTo(0, keepY);
          if (first && !soft) { view.classList.remove('pg-in'); void view.offsetWidth; view.classList.add('pg-in'); } }
      } catch (err) { if (first) view.innerHTML = `<div class="state-err">${PL.icon('alert')}<b>Couldn’t load this screen</b><span>${e(err.message)}</span><button class="btn mt" data-act="reload">Try again</button></div>`; }
    };
    document.body.dataset.route = r.p;
    if (!soft) { lastHtml = ''; view.innerHTML = `<div class="loading" aria-busy="true" aria-label="Loading">${PL.skel(r.def.skel)}</div>`; window.scrollTo(0, 0); }
    cur = r; await paint(true);
    if (token !== PL.state.rtoken) return;          // superseded while loading: never start a poll for a stale route
    // timed refresh; skipped while hidden, while a dialog is open, or while the user is typing / has typed into a form
    const tick = () => { const a = document.activeElement; if (document.hidden || modals.length || (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && view.contains(a)) || [...view.querySelectorAll('form[data-form] input[type=text],form[data-form] input:not([type])')].some((i) => i.value)) return; paint(false); };
    PL.state.tick = r.def.poll ? tick : null;
    if (r.def.poll) pollT = setInterval(tick, r.def.poll);
  }
  PL.state.sig = 0; PL.state.rtoken = 0;
  PL.stopAll = () => { clearInterval(pollT); (PL.hooks.stop || []).forEach((f) => f()); PL.sound.sync(false); PL.inbox?.stop(); };
  PL.hooks = {};

  // ---------- sound & alerts ----------
  const audio = new Audio('/assets/ringing_sound.mp3'); audio.loop = true; audio.preload = 'auto';
  let want = false, probing = false;
  // Unlock test: play once (muted) and stop. While it runs, the once-a-second alert refresh must not pause the element,
  // or the browser aborts the play and sound looks "blocked" although it is allowed.
  const probe = async (muted) => {
    probing = true; audio.muted = muted;
    try { await audio.play(); audio.pause(); audio.currentTime = 0; PL.sound.unlocked = true; return true; }
    catch { return false; } finally { audio.muted = false; probing = false; }
  };
  PL.sound = {
    enabled: () => localStorage.getItem('pl.sound') === '1',
    unlocked: false, playing: () => !audio.paused,
    async enable() { if (await probe(false)) { localStorage.setItem('pl.sound', '1'); PL.sound.sync(want, true); return true; } PL.toast('Your browser blocked sound. Tap again.', true); return false; },
    disable() { localStorage.setItem('pl.sound', '0'); PL.sound.sync(false, true); },
    // one loop for ALL outstanding alerts; stops the moment nothing needs action
    sync(active, keep) { if (!keep) want = active; if (probing) return; if (active && PL.sound.enabled() && PL.sound.unlocked && !document.hidden) audio.play().catch(() => {}); else { audio.pause(); audio.currentTime = 0; } }
  };
  document.addEventListener('visibilitychange', () => PL.sound.sync(want, true));
  // back to the app (phone unlocked, tab reopened): refresh the live screen now instead of on the next timed tick
  document.addEventListener('visibilitychange', () => { if (!document.hidden && PL.state.tick && PL.session()) PL.state.tick(); });
  // "Sound on" is remembered, but the browser's permission to play is not. Re-unlock quietly: right away (works in the
  // Android app, which allows playback without a tap) and on the first touch (normal browsers need a tap).
  const quietUnlock = async () => {
    if (PL.sound.unlocked || probing || !PL.sound.enabled()) return;
    if (await probe(true)) PL.sound.sync(want, true);
  };
  quietUnlock();
  ['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, quietUnlock, { passive: true }));

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
  PL.actions['pw-eye'] = (el) => { const i = el.parentElement.querySelector('input'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.textContent = show ? 'Hide' : 'Show'; el.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); };
  PL.actions.back = () => PL.back();
  PL.actions.reload = () => render();
  PL.actions.nav = (el) => { if (here() !== el.dataset.path) PL.go(el.dataset.path); };
  PL.actions.go = (el) => PL.go(el.dataset.path);
  PL.actions['close-modal'] = () => PL.closeModal();
  PL.actions.logout = async () => { if (!(await PL.confirm('Sign out of this portal?', 'Sign out'))) return; try { PL.track && PL.track.stop(); if (PL.push) await PL.push.disable(); if (PL.hooks.beforeLogout) await PL.hooks.beforeLogout(); } catch {}      /* a signed-out device must stop sharing location and stop receiving this account's notifications */
    try { await PL.post('/api/auth/logout-all'); } catch {} PL.stopAll(); PL.clearSession(); PL.boot(); };
  PL.actions['sound-toggle'] = async (el) => { if (PL.sound.enabled() && PL.sound.unlocked) { PL.sound.disable(); } else await PL.sound.enable(); el.innerHTML = PL.icon(PL.sound.enabled() ? 'sound' : 'mute'); };

  document.addEventListener('click', (ev) => { const el = ev.target.closest('[data-act]'); if (!el) return; const a = PL.actions[el.dataset.act]; if (a) { ev.preventDefault(); a(el, ev); } });
  document.addEventListener('submit', (ev) => { const f = ev.target.closest('form[data-form]'); if (!f) return; ev.preventDefault(); const h = PL.forms[f.dataset.form]; if (h) { const b = f.querySelector('button[type=submit]'); if (b?.disabled) return; if (b) { b.disabled = true; b.classList.add('busy'); } Promise.resolve(h(f, ev)).finally(() => { if (b) { b.disabled = false; b.classList.remove('busy'); } }); } });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && modals.length) PL.closeModal(); });
  // connection status: a persistent strip while offline, a short confirmation when it comes back
  const net = () => { let b = PL.$('#netbar'); if (navigator.onLine) { if (b) { b.remove(); PL.toast('Back online', 'ok'); } return; }
    if (!b) { b = document.createElement('div'); b.id = 'netbar'; b.className = 'netbar'; b.setAttribute('role', 'status'); b.innerHTML = `${PL.icon('alert')}<span>You’re offline. We’ll update this screen when you reconnect.</span>`; document.body.append(b); } };
  addEventListener('online', net); addEventListener('offline', net);

  // ---------- notification centre: bell + unread badge + drawer, for every portal ----------
  // Reads the account's own notifications from the server. A toast is shown only for notifications that really arrived
  // since the last check; order offers and new-order alerts are skipped here because their own alert cards handle them.
  const NOTOAST = new Set(['restaurant_new', 'rider_offer', 'promo']);
  const I = (PL.inbox = { list: [], unread: 0, max: null, t: null,
    btn: () => `<button class="iconbtn nc-btn" data-act="inbox" aria-label="Notifications${I.unread ? `, ${I.unread} unread` : ''}" title="Notifications">${PL.icon('bell')}<i class="nc-n ${I.unread ? '' : 'hide'}">${I.unread > 9 ? '9+' : I.unread || ''}</i></button>`,
    async load() { if (!PL.session()) return; let d; try { d = await PL.api('/api/push/inbox'); } catch { return; }
      const fresh = I.max == null ? [] : d.notifications.filter((n) => n.id > I.max && !n.read_at);
      I.list = d.notifications; I.unread = d.unread; I.max = Math.max(I.max ?? 0, ...d.notifications.map((n) => n.id), 0);
      document.querySelectorAll('.nc-n').forEach((b) => { b.textContent = I.unread > 9 ? '9+' : I.unread; b.classList.toggle('hide', !I.unread); b.parentElement.setAttribute('aria-label', 'Notifications' + (I.unread ? `, ${I.unread} unread` : '')); });
      fresh.filter((n) => !NOTOAST.has(n.kind)).slice(0, 2).forEach((n) => PL.toast(n.body, 'info', { title: n.title, path: pathOf(n.deep_link), label: 'View' }));
      if (fresh.length && PL.onInbox) PL.onInbox(fresh);
      const open = PL.$('.nc-list'); if (open) open.outerHTML = listHtml(); },
    start() { clearInterval(I.t); I.max = null; I.load(); I.t = setInterval(() => { if (!document.hidden) I.load(); }, 20000); },
    stop() { clearInterval(I.t); I.max = null; }
  });
  // deep links look like "/user/orders/X" or "/restaurant/#/order/5": open them inside this portal when they belong to it
  const pathOf = (u) => { if (!u) return ''; try { const x = new URL(u, location.origin); if (x.pathname.split('/')[1] !== location.pathname.split('/')[1]) return ''; if (x.hash.startsWith('#/')) return x.hash.slice(1); const seg = x.pathname.split('/').filter(Boolean); return seg.length > 1 ? '/' + seg.slice(1).join('/') : ''; } catch { return ''; } };
  const ago = (t) => { const ms = Date.now() - Date.parse(String(t).replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(t) ? '' : 'Z')), m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? 'Just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : PL.dt(new Date(Date.now() - ms).toISOString()); };
  PL.ago = ago;
  // icon by what the notification is about (status wording comes from the server's own titles)
  const icoOf = (n) => ({ restaurant_new: 'receipt', rider_offer: 'bike', promo: 'percent', test: 'check' }[n.kind]) || [[/picked|on its way|on the way/i, 'bike'], [/ready/i, 'box'], [/prepar/i, 'chef'], [/deliver/i, 'check'], [/refund|cashout|payout|paid/i, 'wallet'], [/cancel|reject|fail/i, 'alert'], [/accept/i, 'check'], [/placed|new order|confirmed/i, 'receipt']].find(([re]) => re.test(n.title + ' ' + n.body))?.[1] || 'bell';
  const listHtml = () => `<div class="nc-list">${I.list.length ? I.list.map((n) => { const p = pathOf(n.deep_link); return `<button class="nc-item ${n.read_at ? '' : 'new'}" data-act="inbox-go" data-id="${n.id}" data-path="${e(p)}"><span class="nc-ic k-${e(n.kind || '')}">${PL.icon(icoOf(n))}</span><span class="grow"><b>${e(n.title)}</b><span>${e(n.body)}</span><small>${e(ago(n.created_at))}</small></span>${n.read_at ? '' : '<i class="nc-dot" aria-label="Unread"></i>'}</button>`; }).join('')
    : `<div class="nc-empty">${PL.icon('bell')}<b>You’re all caught up</b><span>Order updates and alerts will appear here.</span></div>`}</div>`;
  PL.actions.inbox = async () => { await I.load();
    PL.modal(`<div class="nc-head"><h3>Notifications</h3>${I.unread ? `<button class="btn ghost sm" data-act="inbox-read">Mark all read</button>` : ''}</div>${PL.push ? `<div class="nc-push">${PL.push.card(PL.portal === 'user' ? 'user' : PL.portal)}</div>` : ''}${listHtml()}`, { cls: 'ov-nc' }); };
  PL.actions['inbox-read'] = async (el) => { const r = await PL.run(() => PL.post('/api/push/inbox/read')); if (!r) return; el.remove(); I.list.forEach((n) => { n.read_at = n.read_at || 'now'; }); I.unread = 0; await I.load(); };
  // opening a notification marks it read (dot and counter update at once), then goes to its screen if it has one
  const markRead = (id) => { const n = I.list.find((x) => String(x.id) === String(id)); if (!n || n.read_at) return; n.read_at = 'now'; I.unread = Math.max(0, I.unread - 1);
    document.querySelectorAll('.nc-n').forEach((b) => { b.textContent = I.unread > 9 ? '9+' : I.unread; b.classList.toggle('hide', !I.unread); });
    PL.post(`/api/push/inbox/${id}/read`).catch(() => {}); };
  PL.markInboxRead = markRead;
  PL.actions['inbox-go'] = async (el) => { markRead(el.dataset.id);
    if (!el.dataset.path) { el.classList.remove('new'); el.querySelector('.nc-dot')?.remove(); return; }
    await PL.closeModalAsync(); PL.go(el.dataset.path); };
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (ev) => { if (ev.data?.type === 'push') I.load(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) I.load(); });

  // ---------- shell ----------
  // cfg: { portal, name, home, tabs:[{path,label,icon,badge?}], routes:{path:{title,render,after,poll,noNav}}, loginView(), onReady(), right() }
  PL.start = (c) => { cfg = c; PL.portal = c.portal; document.body.classList.add("p-" + c.portal); if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); PL.boot(); setTimeout(showInstall, 1500); };
  PL.boot = () => {
    document.title = `${cfg.name} · Pakka Local`;
    const root = PL.$('#root'); modals.splice(0).forEach((m) => m.ov.remove());
    if (!PL.session()) { clearInterval(pollT); root.innerHTML = ''; return cfg.loginView(root); }
    routes = Object.entries({ ...cfg.routes, ...(PL.extraRoutes || {}) }).map(([p, def]) => ({ ...compile(p), p, def }));
    const s = PL.session(), who = s?.user?.name || '';
    root.innerHTML = `<header class="top" id="top"><button class="back" data-act="back" aria-label="Back">${PL.icon('chev', 'class="flip"')}<span>Back</span></button><div class="title"></div><div class="side"><div class="row" id="side" style="gap:4px">${cfg.right ? cfg.right() : ''}</div>${PL.inbox.btn()}</div></header>
      <div class="shell"><main id="view"></main></div>
      <nav class="bottom" id="nav" aria-label="Main">${cfg.tabs.map((t) => `${t.group ? `<span class="nav-h">${e(t.group)}</span>` : ''}<button data-act="nav" data-path="${t.path}" class="${t.desk ? 'desk' : t.mobile ? 'mob' : ''}">${PL.icon(t.icon)}<span>${e(t.label)}</span><i class="badge hide" id="bd-${t.path.slice(1)}"></i></button>`).join('')}
        <div class="nav-foot"><span class="nav-av">${e((who || cfg.name).trim().charAt(0).toUpperCase())}</span><span class="grow"><b>${e(who || cfg.name)}</b><small>${e(cfg.name)} portal</small></span><button class="iconbtn" data-act="logout" aria-label="Sign out" title="Sign out">${PL.icon('logout')}</button></div></nav>`;
    view = PL.$('#view'); idx = (history.state && history.state.idx) || 0;
    history.replaceState({ idx }, '', location.hash || '#' + cfg.home);
    cfg.onReady && cfg.onReady(); render(); PL.push && PL.push.boot(); PL.inbox.start();
  };
  PL.badge = (path, n) => { const b = PL.$('#bd-' + path.slice(1)); if (b) { if (b.textContent !== String(n)) { b.textContent = n; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; } b.classList.toggle('hide', !n); } };

  // Order chat (customer <-> assigned delivery partner). One sheet for both apps; refreshes every 4 s while open.
  PL.chat = { open(url, title, sub) {
    let busy = false, iv = null, last = '';
    const ov = PL.modal(`<div class="ch-head"><span class="ch-ic">${PL.icon('chat')}</span><span><h3>${e(title)}</h3><small class="mute">${e(sub || 'Messages are only for this order.')}</small></span></div>
      <div class="ch-list" id="ch-list" aria-live="polite"><div class="ch-empty">Loading…</div></div>
      <form data-form="chat-send" class="ch-form" data-url="${e(url)}"><input name="body" maxlength="500" placeholder="Type a message" autocomplete="off" aria-label="Message"><button class="btn" type="submit" aria-label="Send">${PL.icon('chev')}</button></form>`,
      { cls: 'ch-ov', onClose: () => { clearInterval(iv); PL.chat.reload = null; } });
    const load = async () => { if (busy) return; busy = true;
      try { const d = await PL.api(url), el = ov.querySelector('#ch-list'); if (!el) return;
        const html = d.messages.length ? d.messages.map((m) => `<div class="ch-m ${m.mine ? 'me' : ''}"><div class="b">${e(m.body)}</div><small>${m.mine ? '' : e(m.from) + ' · '}${PL.time(m.created_at)}${m.mine ? (m.read_at ? ' · Seen' : ' · Sent') : ''}</small></div>`).join('')
          : '<div class="ch-empty">No messages yet. Say where to meet, a gate number or a landmark.</div>';
        if (html !== last) { el.innerHTML = html; last = html; el.scrollTop = el.scrollHeight; }
        const f = ov.querySelector('.ch-form'); f.classList.toggle('hide', !d.can_send);
        if (!d.can_send && !ov.querySelector('.ch-closed')) f.insertAdjacentHTML('afterend', '<p class="small mute center ch-closed">Chat is closed for this order.</p>');
      } catch (x) { const el = ov.querySelector('#ch-list'); if (el && !last) el.innerHTML = `<div class="ch-empty">${e(x.message)}</div>`; } finally { busy = false; } };
    PL.chat.reload = load; load(); iv = setInterval(load, 4000); } };
  PL.forms['chat-send'] = async (f) => { const i = f.querySelector('input'), body = i.value.trim(); if (!body || f.dataset.busy) return; f.dataset.busy = 1;
    try { await PL.post(f.dataset.url, { body }); i.value = ''; PL.chat.reload && await PL.chat.reload(); } catch (x) { PL.toast(x.message, true); } finally { delete f.dataset.busy; i.focus(); } };

  // Staff login (restaurant / rider / admin): accounts are created by an admin, no sign-up.
  PL.staffLogin = (root, { title, blurb }) => {
    const pts = { restaurant: [['receipt', 'New orders ring instantly'], ['chef', 'Kitchen status in one tap'], ['wallet', 'Daily earnings and payouts']], rider: [['bike', 'Delivery offers near you'], ['nav', 'One-tap navigation'], ['wallet', 'Earnings paid next day']], admin: [['chart', 'Live orders and revenue'], ['users', 'Approve riders and restaurants'], ['shield', 'Every action is logged']] }[PL.portal] || [];
    root.innerHTML = `<div class="auth"><aside class="auth-art"><img src="/assets/logo.png" alt=""><h2>${e(title)}</h2><ul>${pts.map(([i, t]) => `<li>${PL.icon(i)}<span>${e(t)}</span></li>`).join('')}</ul></aside>
      <div class="loginbox"><img class="logo" src="/assets/logo.png" alt="Pakka Local"><h1>${e(title)}</h1><p class="mute">${e(blurb)}</p>
      <form data-form="login">${PL.portal === 'admin' ? '<label for="lg-p">Username or mobile number</label><div class="field"><input id="lg-p" name="phone" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="Username or 98765 43210" required></div>' : '<label for="lg-p">Mobile number</label><div class="field pre"><span>+91</span><input id="lg-p" name="phone" inputmode="tel" autocomplete="username" placeholder="98765 43210" required></div>'}
      <label for="lg-w">Password</label><div class="field"><input id="lg-w" name="password" type="password" autocomplete="current-password" required><button type="button" class="eye" data-act="pw-eye" aria-label="Show password">Show</button></div><div id="mfa" class="hide"><label>Authenticator code</label><input name="totp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6-digit code"></div><button class="btn block lg mt" type="submit">Sign in</button></form>
      <p class="small mute mt center">Accounts are created by Pakka Local. Contact the team if you need access.</p></div></div>`;
    PL.forms.login = async (f) => { const v = PL.form(f); let phone = v.phone.replace(/[\s-]/g, ''); if (/^\d{10}$/.test(phone)) phone = '+91' + phone;
      const body = { portal: PL.portal, password: v.password }; if (PL.portal === 'admin' && !/^\+?\d{10,15}$/.test(phone)) body.username = v.phone.trim(); else body.phone = phone; if (v.totp) body.totp = v.totp;
      try { const r = await PL.post('/api/auth/login', body); PL.setSession(r); history.replaceState({ idx: 0 }, '', location.hash || '#'); PL.boot(); }
      catch (err) { if (err.code === 'MFA_REQUIRED') { PL.$('#mfa').classList.remove('hide'); PL.$('#mfa input').focus(); } PL.toast(err.message, !!v.totp || err.code !== 'MFA_REQUIRED'); } };
  };
})();
