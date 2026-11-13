/* Priority 2: admin "Live deliveries" screen. Registered as an extra route so admin/app.js stays untouched apart from one menu link. */
PL.extraRoutes = Object.assign(PL.extraRoutes || {}, { '/map': { title: 'Live deliveries',
  render: async () => `<div class="small mute">Riders appear here once they have an assigned delivery and their phone is sharing location. Grey or amber means the position is old.</div><div id="admap" style="height:340px;border-radius:12px;margin:10px 0;overflow:hidden;background:#eee9df"></div><div id="admlist"><div class="loading">Loading…</div></div>`,
  after: () => PL.track.adminMount() } });
