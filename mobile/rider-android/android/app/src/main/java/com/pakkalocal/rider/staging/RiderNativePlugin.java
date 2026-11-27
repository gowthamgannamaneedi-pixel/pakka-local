package com.pakkalocal.rider.staging;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Bridge between the rider web page and the native background service.
 * The page calls sync() whenever the rider's online state, number of active deliveries or sign-in changes.
 * Only the server's own address and the rider's session token are passed; nothing is stored on disk here.
 */
@CapacitorPlugin(name = "RiderNative")
public class RiderNativePlugin extends Plugin {

    @PluginMethod
    public void sync(PluginCall call) {
        boolean online = Boolean.TRUE.equals(call.getBoolean("online", false));
        int active = call.getInt("active", 0);
        String token = call.getString("token", "");
        String api = call.getString("api", "");
        // only talk to the same https origin the app itself loads (or a local test server); never an arbitrary host
        if (!api.isEmpty() && !api.startsWith("https://") && !api.startsWith("http://localhost")) api = "";
        RiderService.sync(getContext(), online && !token.isEmpty() && !api.isEmpty(), token, api, active);
        call.resolve(status());
    }

    @PluginMethod
    public void getStatus(PluginCall call) { call.resolve(status()); }

    /** Ring for waiting offers with the phone's alarm-volume ringer (loud, loops, vibrates). {ok:false} = service not running: the page rings itself. */
    @PluginMethod
    public void ring(PluginCall call) { JSObject o = new JSObject(); o.put("ok", RiderService.ringFromPage(Boolean.TRUE.equals(call.getBoolean("on", false)))); call.resolve(o); }

    /** This phone's Firebase token (null until Firebase is set up). The page registers it with the server for the signed-in rider. */
    @PluginMethod
    public void getPushToken(PluginCall call) {
        JSObject o = new JSObject(); o.put("enabled", PakkaFcmService.available(getContext()));
        if (!PakkaFcmService.available(getContext())) { call.resolve(o); return; }
        com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken().addOnCompleteListener((t) -> {
            if (t.isSuccessful() && t.getResult() != null) o.put("token", t.getResult());
            call.resolve(o);
        });
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String what = call.getString("what", "app");
        Intent i;
        switch (what) {
            case "location": i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS); break;
            case "notifications":
                i = Build.VERSION.SDK_INT >= 26 ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
                    : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())); break;
            case "overlay": i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName())); break;
            case "fullscreen": i = Build.VERSION.SDK_INT >= 34 ? new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getContext().getPackageName())) : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())); break;
            case "battery": i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName())); break;
            default: i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { getContext().startActivity(i); } catch (Exception e) { Gates.openAppInfo(getContext()); }
        call.resolve();
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    // ---------- in-app update (direct APK, no Play Store) ----------
    /** Installed version, so the page can compare it with the latest one on the server. */
    @PluginMethod
    public void appInfo(PluginCall call) {
        JSObject o = new JSObject();
        try {
            android.content.pm.PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            o.put("versionCode", Build.VERSION.SDK_INT >= 28 ? (int) pi.getLongVersionCode() : pi.versionCode);
            o.put("versionName", pi.versionName);
        } catch (Exception e) { o.put("versionCode", 0); }
        o.put("canInstall", Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(o);
    }

    /**
     * Downloads the new APK from our own server (https://pakkalocal.online/... only) and opens Android's installer.
     * Android always asks the rider to confirm "Update"; the app is replaced in place (sign-in and data are kept).
     * The first time, Android asks the rider to allow installs from this app ("Install unknown apps").
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://pakkalocal.online/") || !url.endsWith(".apk")) { call.reject("Not an allowed update address", "BAD_URL"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { getContext().startActivity(i); } catch (Exception ignored) {}
            call.reject("Allow installs from Pakka Rider, then tap Update again", "NEED_PERMISSION");
            return;
        }
        new Thread(() -> {
            File dir = new File(getContext().getCacheDir(), "update"); dir.mkdirs();
            File out = new File(dir, "PakkaRider-update.apk");
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection(); c.setConnectTimeout(15000); c.setReadTimeout(30000);
                if (c.getResponseCode() != 200) throw new Exception("Download failed (" + c.getResponseCode() + ")");
                long total = c.getContentLengthLong(), done = 0; int last = -1;
                try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024]; int n;
                    while ((n = in.read(buf)) > 0) { fo.write(buf, 0, n); done += n;
                        int pct = total > 0 ? (int) (done * 100 / total) : -1;
                        if (pct != last) { last = pct; JSObject ev = new JSObject(); ev.put("pct", pct); notifyListeners("updateProgress", ev); } }
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
                Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Download failed" : e.getMessage(), "DOWNLOAD_FAILED");
            } finally { if (c != null) c.disconnect(); }
        }).start();
    }

    private JSObject status() {
        JSObject o = new JSObject();
        o.put("native", true);
        o.put("overlay", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext()));
        o.put("locationOn", Gates.locationOn(getContext()));
        o.put("running", RiderService.isRunning());
        o.put("notifications", androidx.core.app.NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        o.put("battery", Gates.batteryFree(getContext()));
        o.put("locationPermission", Gates.hasLocationPermission(getContext()));
        o.put("maker", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase());
        o.put("sdk", Build.VERSION.SDK_INT);
        o.put("push", PakkaFcmService.available(getContext()));
        android.app.NotificationManager nmx = (android.app.NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        o.put("fullScreen", Build.VERSION.SDK_INT < 34 || (nmx != null && nmx.canUseFullScreenIntent()));
        return o;
    }
}
