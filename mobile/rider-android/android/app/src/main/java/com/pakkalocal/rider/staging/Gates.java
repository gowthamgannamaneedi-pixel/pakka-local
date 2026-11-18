package com.pakkalocal.rider.staging;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.location.LocationManagerCompat;

/**
 * What the rider must allow before using the app, checked every time the app comes to the front:
 *  1. phone Location (GPS) switched on                      -> required, the app is blocked until it is on
 *  2. location permission for this app                        -> required
 *  3. notifications (Android 13+)                              -> asked once per app start
 *  4. "display over other apps" for the floating side icon    -> asked once per app start, can be skipped
 *  5. no battery optimisation, so the app keeps working in the background -> asked once per app start, can be skipped
 */
final class Gates {
    static final int REQ_LOCATION = 4711, REQ_NOTIFY = 4712;
    private final Activity a;
    private AlertDialog blocking, optional;
    private boolean askedNotify, askedOverlay, askedBattery, locationRequested;

    Gates(Activity a) { this.a = a; }

    static boolean locationOn(Context c) {
        LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
        return lm != null && LocationManagerCompat.isLocationEnabled(lm);
    }
    static boolean hasLocationPermission(Context c) {
        return ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }
    static boolean canOverlay(Context c) { return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(c); }
    static boolean batteryFree(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        return pm == null || pm.isIgnoringBatteryOptimizations(c.getPackageName());
    }

    /** Run the checks in order; shows at most one dialog at a time. */
    void check() {
        if (a.isFinishing()) return;
        if (!locationOn(a)) {
            block("Turn on location",
                "Pakka Rider needs your phone’s Location (GPS) to show you nearby deliveries and to share your position with customers during a delivery.\n\nTurn on Location to continue.",
                "Turn on location", () -> a.startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)));
            return;
        }
        if (!hasLocationPermission(a)) {
            boolean canAsk = !locationRequested || ActivityCompat.shouldShowRequestPermissionRationale(a, Manifest.permission.ACCESS_FINE_LOCATION);
            if (canAsk) {
                block("Allow location", "Allow Pakka Rider to use your location while you use the app.", "Allow", () -> {
                    locationRequested = true;
                    ActivityCompat.requestPermissions(a, new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                });
            } else {
                block("Location permission is off",
                    "Location permission was denied. Open App settings → Permissions → Location, choose “Allow only while using the app”, then come back.",
                    "Open app settings", () -> a.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + a.getPackageName()))));
            }
            return;
        }
        unblock();
        if (optional != null && optional.isShowing()) return;
        if (Build.VERSION.SDK_INT >= 33 && !askedNotify
                && ContextCompat.checkSelfPermission(a, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askedNotify = true;
            ActivityCompat.requestPermissions(a, new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
            return;
        }
        if (!askedOverlay && !canOverlay(a)) {
            askedOverlay = true;
            ask("Show the Pakka Rider bubble",
                "When you switch to Maps or another app, a small Pakka Rider icon stays on the side of your screen. Tap it to come back, and it flashes when a new delivery offer arrives.\n\nOn the next screen, choose Pakka Rider (if a list of apps appears), then turn on “Allow display over other apps”.",
                "Allow", () -> a.startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + a.getPackageName()))));
            return;
        }
        if (!askedBattery && !batteryFree(a)) {
            askedBattery = true;
            ask("Keep working in the background",
                "So you keep getting delivery offers and your location keeps updating while the phone is locked or you use other apps, allow Pakka Rider to run without battery restrictions.",
                "Allow", () -> {
                    try { a.startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + a.getPackageName()))); }
                    catch (Exception e) { a.startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); }
                });
        }
    }

    private String blockingTitle = "";
    private void block(String title, String msg, String btn, Runnable go) {
        if (blocking != null && blocking.isShowing() && title.equals(blockingTitle)) return;
        unblock(); blockingTitle = title;
        blocking = new AlertDialog.Builder(a).setTitle(title).setMessage(msg).setCancelable(false)
            .setPositiveButton(btn, (d, w) -> go.run()).create();
        blocking.setCanceledOnTouchOutside(false);
        blocking.show();
    }
    private void unblock() { if (blocking != null) { blocking.dismiss(); blocking = null; } }
    private void ask(String title, String msg, String btn, Runnable go) {
        optional = new AlertDialog.Builder(a).setTitle(title).setMessage(msg).setCancelable(true)
            .setPositiveButton(btn, (d, w) -> go.run()).setNegativeButton("Not now", null).create();
        optional.setOnDismissListener((d) -> a.getWindow().getDecorView().post(this::check));
        optional.show();
    }
    void dismissAll() { unblock(); if (optional != null) optional.dismiss(); }
}
