/* Web Push client. Permission is only ever requested from a user tap. Subscriptions are per device and tied to the signed-in account. */
(function () {
  const e = PL.esc, S = PL.state; S.push = 'unknown';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const u8 = (b64) => { const p = '='.repeat((4 - (b64.length % 4)) % 4), r = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
  const label = () => (/Android/.test(navigator.userAgent) ? 'Android' : ios ? 'iPhone/iPad' : /Windows/.test(navigator.userAgent) ? 'Windows' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'Browser') + (standalone ? ' app' : '');
  const reg = () => navigator.serviceWorker.ready;
  const P = (PL.push = {
    async refresh() {
      if (!supported) S.push = ios && !standalone ? 'ios-install' : 'unsupported';
      else if (ios && !standalone) S.push = 'ios-install';
      else if (Notification.permission === 'denied') S.push = 'denied';
      else { const sub = await (await reg()).pushManager.getSubscription(); S.push = sub && Notification.permission === 'granted' ? 'on' : 'off'; }
      return S.push;
    },
    async enable() {
      const k = await PL.api('/api/push/key'); if (!k.enabled) throw new Error('Notifications are not switched on for this server yet.');
      if ((await Notification.requestPermission()) !== 'granted') { await P.refresh(); throw new Error('Notifications were blocked. You can allow them in your browser or phone settings.'); }
      const r = await reg(); const sub = (await r.pushManager.getSubscription()) || (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(k.publicKey) }));
      const j = sub.toJSON(); await PL.post('/api/push/subscribe', { endpoint: j.endpoint, keys: j.keys, label: label() }); await P.refresh();
    },
    async disable() { const sub = await (await reg()).pushManager.getSubscription(); if (sub) { await PL.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); } await P.refresh(); },
    // on every app open: silently re-register if the browser rotated/expired the subscription (never prompts)
    async boot() { try { if (supported && Notification.permission === 'granted' && PL.session()) { const k = await PL.api('/api/push/key'); if (k.enabled) { const r = await reg(); const sub = (await r.pushManager.getSubscription()) || (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(k.publicKey) })); const j = sub.toJSON(); await PL.post('/api/push/subscribe', { endpoint: j.endpoint, keys: j.keys, label: label() }); } } } catch {} await P.refresh(); PL.rerender && PL.$('#view') && PL.rerender(); },
    // compact status card; `who` tunes the wording
    card(who) {
      const t = { restaurant: ['New-order alerts when the app is closed', 'Get a notification the moment an order arrives, even if this app is closed.'], rider: ['Delivery offers when the app is closed', 'Get a notification when a delivery is available, even if this app is closed.'], user: ['Order updates', 'Get a notification when your order is accepted, picked up and delivered.'], admin: ['Admin alerts', 'Get notified about rejected orders and cashout requests.'] }[who] || ['Notifications', ''];
      const s = S.push; if (s === 'unknown') return '';
      if (s === 'on') return `<div class="card flat row"><span style="color:var(--ok)">${PL.icon('bell')}</span><div class="grow"><b>Notifications are on</b><div class="small mute">This device will be alerted. </div></div><button class="btn ghost sm" data-act="push-test">Test</button><button class="btn ghost sm" data-act="push-off">Turn off</button></div>`;
      if (s === 'unsupported') return `<div class="card flat small mute">This browser can’t show background notifications. Keep the app open to get alerts.</div>`;
      if (s === 'ios-install') return `<div class="card flat"><b>${t[0]}</b><p class="small mute">On iPhone, notifications only work from the installed app (iOS 16.4 or later). Open this page in Safari, tap Share, choose “Add to Home Screen”, then open Pakka Local from your home screen and enable notifications.</p></div>`;
      if (s === 'denied') return `<div class="card flat"><b>Notifications are blocked</b><p class="small mute">Allow notifications for this site in your browser or phone settings, then come back.</p></div>`;
      return `<div class="card" style="border-color:var(--brand)"><div class="row"><span style="color:var(--brand)">${PL.icon('bell')}</span><div class="grow"><b>${t[0]}</b><div class="small mute">${t[1]}</div></div></div><button class="btn block mt2" data-act="push-on">Enable notifications</button></div>`;
    }
  });
  PL.actions['push-on'] = async () => { try { await P.enable(); PL.toast('Notifications enabled'); } catch (x) { PL.toast(x.message, true); } PL.rerender(); };
  PL.actions['push-test'] = async () => { await PL.run(() => PL.post('/api/push/test'), 'Test sent. It should appear within a few seconds. Lock the screen or switch apps to check background delivery.'); };
  PL.actions['push-off'] = async () => { await P.disable(); PL.toast('Notifications turned off'); PL.rerender(); };
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (ev) => { const m = ev.data || {}; if (m.type === 'goto' && m.path) PL.go(m.path); if (m.type === 'push') PL.rerender && PL.rerender(); });
})();
