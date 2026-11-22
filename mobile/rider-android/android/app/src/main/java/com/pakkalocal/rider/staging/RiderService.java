package com.pakkalocal.rider.staging;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Runs while the rider is online (or has a delivery), as an Android foreground service with a visible notification.
 * - Checks for delivery offers every 8 s. This also keeps the rider "seen" by the server, so offers keep coming
 *   while the app is in the background or the screen is off.
 * - New offer while the app is not in front: ringing notification + the floating icon flashes.
 * - During a delivery and while the app is not in front: sends GPS to the server at the pace the server asks for.
 *   (When the app is in front, the web page sends it, exactly as before.)
 * Only real server answers are shown; nothing is invented. Stops when the rider goes offline or signs out.
 */
public class RiderService extends Service {
    private static final String CH_STATUS = "rider_status", CH_OFFERS = "rider_offers_v1", CH_UPDATES = "rider_updates";
    private static final int ID_STATUS = 1, ID_OFFER = 2;
    private static volatile RiderService inst;
    private static volatile boolean foreground = false;      // a restarted service runs without the app on screen; MainActivity sets true when it is visible

    private volatile String token = "", api = "";
    private volatile boolean online;
    private volatile int active;
    private ScheduledExecutorService ex;
    private LocationManager lm;
    private volatile Location last;
    private volatile long lastSent, every = 7000;
    private final Set<Long> seen = new HashSet<>();
    private boolean listening;
    private FloatingBubble bubble;
    private PowerManager.WakeLock wake;
    private final Handler main = new Handler(Looper.getMainLooper());

    static boolean isRunning() { return inst != null; }

    /** Called by the web page (through RiderNativePlugin) whenever online state, deliveries or sign-in change. */
    static void sync(Context c, boolean online, String token, String api, int active) {
        Intent i = new Intent(c, RiderService.class).putExtra("online", online).putExtra("token", token).putExtra("api", api).putExtra("active", active);
        boolean run = !token.isEmpty() && !api.isEmpty() && (online || active > 0);
        android.content.SharedPreferences sp = c.getSharedPreferences("rider_bg", MODE_PRIVATE);
        if (run) { sp.edit().putString("token", token).putString("api", api).putBoolean("online", online).putInt("active", active).apply(); ContextCompat.startForegroundService(c, i); }
        else { sp.edit().clear().apply(); if (inst != null) c.stopService(new Intent(c, RiderService.class)); }
    }

    /** MainActivity tells us when the rider screen is in front (hide the bubble) or not (show it). */
    static void setForeground(Context c, boolean fg) {
        foreground = fg;
        RiderService s = inst;
        if (s != null) s.main.post(s::updateBubble);
        if (fg) { NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE); if (nm != null) nm.cancel(ID_OFFER); }
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        inst = this;
        channels();
        bubble = new FloatingBubble(this);
        lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) { wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PakkaRider:online"); wake.setReferenceCounted(false); }
    }

    @Override
    public int onStartCommand(Intent i, int flags, int startId) {
        if (i != null && i.hasExtra("token")) {
            token = str(i.getStringExtra("token")); api = str(i.getStringExtra("api"));
            online = i.getBooleanExtra("online", false); active = i.getIntExtra("active", 0);
        } else {      // restarted by Android after the phone stopped it: continue with the saved sign-in (cleared on offline / sign-out)
            android.content.SharedPreferences sp = getSharedPreferences("rider_bg", MODE_PRIVATE);
            token = str(sp.getString("token", "")); api = str(sp.getString("api", "")); online = sp.getBoolean("online", false); active = sp.getInt("active", 0);
        }
        Notification n = statusNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID_STATUS, n, hasLocation() ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(ID_STATUS, n);
        } catch (Exception e) {
            // Android may refuse the location type when the service is restarted in the background: keep offers and alerts running
            try { if (Build.VERSION.SDK_INT >= 29) startForeground(ID_STATUS, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC); else throw e; }
            catch (Exception e2) { stopSelf(); return START_NOT_STICKY; }
        }
        if (token.isEmpty() || api.isEmpty()) { stopSelf(); return START_NOT_STICKY; }
        if (wake != null && !wake.isHeld()) wake.acquire();
        if (ex == null) { ex = Executors.newSingleThreadScheduledExecutor(); ex.scheduleWithFixedDelay(this::poll, 0, 8, TimeUnit.SECONDS); }
        startLocation();
        updateBubble();
        return START_STICKY;      // if the phone stops it, Android starts it again with the saved sign-in
    }

    @Override
    public void onDestroy() {
        inst = null;
        if (ex != null) ex.shutdownNow();
        stopLocation();
        main.post(() -> bubble.hide());
        if (wake != null && wake.isHeld()) wake.release();
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE); if (nm != null) nm.cancel(ID_OFFER);
        super.onDestroy();
    }

    // ---------- offers ----------
    private void poll() {
        try {
            String[] r = http("GET", "/api/rider/offers", null);
            int code = Integer.parseInt(r[0]);
            if (code == 401) { getSharedPreferences("rider_bg", MODE_PRIVATE).edit().clear().apply(); main.post(this::stopSelf); return; }        // signed out or session expired
            if (code != 200) return;
            JSONObject j = new JSONObject(r[1]);
            JSONArray offers = j.optJSONArray("offers"), act = j.optJSONArray("active");
            int nAct = act == null ? 0 : act.length();
            boolean fresh = false; Set<Long> now = new HashSet<>(); String first = null;
            for (int k = 0; offers != null && k < offers.length(); k++) {
                JSONObject o = offers.getJSONObject(k); long id = o.optLong("id"); now.add(id);
                if (!seen.contains(id)) { fresh = true; if (first == null) first = describe(o); }
            }
            seen.retainAll(now); seen.addAll(now);
            final boolean seenOnScreen = inFront();
            final int n = now.size(); final boolean ring = fresh && !seenOnScreen && System.currentTimeMillis() - PakkaFcmService.lastOfferRing > 20000; final String text = first;      // skip if Firebase already rang for it
            if (nAct != active) { active = nAct; main.post(() -> { startLocation(); refreshStatus(); }); }
            final boolean frontNote = fresh && seenOnScreen;      // app open and phone unlocked: the screen rings, and the offer also appears as a notification
            main.post(() -> { bubble.setAlert(n > 0); if (ring) offerNotification(n, text); if (frontNote) showQuiet(this, "New delivery offer", text == null ? "Open the offer to accept it." : text, "offer-front"); if (n == 0) cancelOffer(); });
            if (++rounds % 2 == 0) pollInbox();
        } catch (Exception ignored) { /* no network: try again on the next round */ }
    }

    // ---------- customer messages, cancellations, reassignments (works with the app in the background) ----------
    // Every second round (~16 s) the rider's own notifications are checked. Each one is shown once (the last seen id is kept
    // across restarts; the first check after sign-in only sets the starting point, so old items never ring). Offers are
    // handled above; anything already read, or shown while the rider is looking at the app, is skipped.
    private int rounds = 0;
    private void pollInbox() {
        try {
            String[] r = http("GET", "/api/push/inbox", null);
            if (Integer.parseInt(r[0]) != 200) return;
            JSONArray list = new JSONObject(r[1]).optJSONArray("notifications"); if (list == null) return;
            android.content.SharedPreferences sp = getSharedPreferences("rider_bg", MODE_PRIVATE);
            long last = sp.getLong("inbox_last", -1), max = last;
            for (int k = list.length() - 1; k >= 0; k--) {                         // oldest first
                JSONObject n = list.getJSONObject(k); long id = n.optLong("id"); if (id > max) max = id;
                if (last < 0 || id <= last) continue;
                String kind = n.optString("kind", ""), title = n.optString("title", "Pakka Rider"), body = n.optString("body", ""), tag = n.optString("event_id", "n" + id);
                if ("rider_offer".equals(kind) || !n.isNull("read_at")) continue;      // shown even while the app is open, so nothing is missed
                main.post(() -> showPush(this, title, body, false, tag));
            }
            if (max != last) sp.edit().putLong("inbox_last", max).apply();
        } catch (Exception ignored) { /* try again next time */ }
    }

    private static String describe(JSONObject o) {
        JSONObject rest = o.optJSONObject("restaurant");
        String from = rest == null ? "" : rest.optString("name", "");
        long fee = o.optLong("fee_paise", 0);
        return (from.isEmpty() ? "New delivery offer" : "Pickup from " + from) + (fee > 0 ? " · you earn ₹" + (fee / 100) : "");
    }

    /** The rider is really looking at Pakka Rider: activity visible AND screen on AND phone unlocked. */
    private boolean inFront() {
        if (!foreground) return false;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        android.app.KeyguardManager km = (android.app.KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        return (pm == null || pm.isInteractive()) && (km == null || !km.isKeyguardLocked());
    }

    // ---------- location during a delivery (only while the app is not in front) ----------
    private boolean hasLocation() { return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED; }

    private final LocationListener listener = new LocationListener() {
        @Override public void onLocationChanged(Location l) { last = l; maybeSend(); }
        @Override public void onProviderEnabled(String p) {}
        @Override public void onProviderDisabled(String p) {}
        @Override public void onStatusChanged(String p, int s, Bundle b) {}
    };

    private void startLocation() {
        if (active <= 0) { stopLocation(); return; }
        if (listening || lm == null || !hasLocation()) return;
        try {
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 4000, 0, listener, Looper.getMainLooper());
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 8000, 0, listener, Looper.getMainLooper());
            listening = true;
        } catch (SecurityException ignored) {}
    }
    private void stopLocation() { if (listening && lm != null) { lm.removeUpdates(listener); listening = false; } }

    private void maybeSend() {
        final Location l = last;
        if (l == null || inFront() || active <= 0 || System.currentTimeMillis() - lastSent < every || ex == null) return;
        lastSent = System.currentTimeMillis();
        ex.execute(() -> {
            try {
                JSONObject b = new JSONObject().put("lat", l.getLatitude()).put("lng", l.getLongitude()).put("recorded_at", Math.min(l.getTime(), System.currentTimeMillis()));
                if (l.hasAccuracy()) b.put("accuracy", l.getAccuracy());
                if (l.hasBearing()) b.put("heading", l.getBearing());
                if (l.hasSpeed() && l.getSpeed() >= 0) b.put("speed", l.getSpeed());
                String[] r = http("POST", "/api/tracking/rider/location", b.toString());
                if ("200".equals(r[0])) { long nx = new JSONObject(r[1]).optLong("next_ms", every); if (nx >= 3000) every = nx; }
            } catch (Exception ignored) {}
        });
    }

    // ---------- notifications ----------
    private void channels() { channels(this); }
    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel st = new NotificationChannel(CH_STATUS, "Online status", NotificationManager.IMPORTANCE_LOW);
        st.setDescription("Shown while you are online or on a delivery");
        NotificationChannel of = new NotificationChannel(CH_OFFERS, "Delivery offers", NotificationManager.IMPORTANCE_HIGH);
        of.setDescription("Rings when a new delivery offer arrives");
        of.setSound(Uri.parse("android.resource://" + c.getPackageName() + "/" + R.raw.offer_ring),
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        of.enableVibration(true); of.setVibrationPattern(new long[]{0, 400, 200, 400, 200, 400});
        of.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationChannel up = new NotificationChannel(CH_UPDATES, "Order updates and messages", NotificationManager.IMPORTANCE_HIGH);
        up.setDescription("Delivery changes, customer messages and announcements");
        nm.createNotificationChannel(st); nm.createNotificationChannel(of); nm.createNotificationChannel(up);
    }

    /** A push from Firebase (works with the app closed). Offers use the ringing channel and replace any offer already shown. */
    static void showPush(Context c, String title, String body, boolean offer, String tag) {
        channels(c);
        if (offer && inst != null && inst.inFront()) return;      // the screen in front already rings
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent pi = PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, offer ? CH_OFFERS : CH_UPDATES).setSmallIcon(R.drawable.ic_stat_rider)
            .setContentTitle(title).setContentText(body).setStyle(new NotificationCompat.BigTextStyle().bigText(body)).setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH).setColor(0xFFD0450B).setContentIntent(pi).setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        if (offer) b.setCategory(NotificationCompat.CATEGORY_CALL).setSound(Uri.parse("android.resource://" + c.getPackageName() + "/" + R.raw.offer_ring)).setVibrate(new long[]{0, 400, 200, 400, 200, 400});
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(offer ? ID_OFFER : (tag == null ? (int) (System.currentTimeMillis() & 0xfffffff) : (tag.hashCode() & 0x7ffffff) + 10), b.build());
    }

    /** Same as showPush but without sound or vibration (the app on screen is already ringing). */
    static void showQuiet(Context c, String title, String body, String tag) {
        channels(c);
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent pi = PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_UPDATES).setSmallIcon(R.drawable.ic_stat_rider).setContentTitle(title).setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body)).setAutoCancel(true).setSilent(true).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setColor(0xFFD0450B).setContentIntent(pi).setVisibility(NotificationCompat.VISIBILITY_PUBLIC).setTimeoutAfter(10 * 60_000);
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify((tag.hashCode() & 0x7ffffff) + 10, b.build());
    }

    /** A Firebase offer arrived while the service was stopped by the phone: start it again with the saved sign-in. */
    static void restartIfOnline(Context c) {
        if (inst != null) return;
        android.content.SharedPreferences sp = c.getSharedPreferences("rider_bg", MODE_PRIVATE);
        if (sp.getString("token", "").isEmpty()) return;
        try { ContextCompat.startForegroundService(c, new Intent(c, RiderService.class)); } catch (Exception ignored) { /* Android refused: the notification still rang */ }
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification statusNotification() {
        String title = active > 0 ? "Delivery in progress" : "You’re online";
        String text = active > 0 ? "Sharing your location with the customer while you deliver" : "Waiting for delivery offers. Tap to open Pakka Rider.";
        return new NotificationCompat.Builder(this, CH_STATUS).setSmallIcon(R.drawable.ic_stat_rider).setContentTitle(title).setContentText(text)
            .setOngoing(true).setOnlyAlertOnce(true).setCategory(NotificationCompat.CATEGORY_SERVICE).setContentIntent(openApp())
            .setColor(0xFFD0450B).setPriority(NotificationCompat.PRIORITY_LOW).build();
    }
    private void refreshStatus() { NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE); if (nm != null && inst != null) nm.notify(ID_STATUS, statusNotification()); }

    private void offerNotification(int n, String text) {
        Notification x = new NotificationCompat.Builder(this, CH_OFFERS).setSmallIcon(R.drawable.ic_stat_rider)
            .setContentTitle(n > 1 ? n + " delivery offers waiting" : "New delivery offer").setContentText(text == null ? "Tap to see it" : text)
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_CALL).setAutoCancel(true)
            .setSound(Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.offer_ring)).setVibrate(new long[]{0, 400, 200, 400, 200, 400})
            .setColor(0xFFD0450B).setContentIntent(openApp()).setVisibility(NotificationCompat.VISIBILITY_PUBLIC).build();
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(ID_OFFER, x);
    }
    private void cancelOffer() { NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE); if (nm != null) nm.cancel(ID_OFFER); }

    // ---------- floating icon ----------
    private void updateBubble() { if (inst == null) return; if (foreground) bubble.hide(); else bubble.show(); }

    // ---------- small HTTPS helper (same server and session as the web page) ----------
    private String[] http(String method, String path, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(api + path).openConnection();
        c.setRequestMethod(method); c.setConnectTimeout(10000); c.setReadTimeout(10000);
        c.setRequestProperty("Authorization", "Bearer " + token); c.setRequestProperty("Accept", "application/json");
        if (body != null) { c.setDoOutput(true); c.setRequestProperty("Content-Type", "application/json"); try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); } }
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (in != null) { byte[] buf = new byte[8192]; int k; while ((k = in.read(buf)) > 0) out.write(buf, 0, k); in.close(); }
        c.disconnect();
        return new String[]{String.valueOf(code), out.toString("UTF-8")};
    }
    private static String str(String s) { return s == null ? "" : s; }
}
