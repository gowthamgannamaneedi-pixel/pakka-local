package com.pakkalocal.rider.staging;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;
import androidx.annotation.NonNull;
import com.getcapacitor.BridgeActivity;

// Pakka Rider: opens the Pakka Local rider portal (see capacitor.config.json).
// Before the portal can be used the phone's Location must be on (Gates). While the rider is online,
// RiderService keeps offers, alerts and delivery location working in the background, and shows the
// floating side icon whenever this screen is not in front.
public class MainActivity extends BridgeActivity {
    private Gates gates;
    private final BroadcastReceiver providers = new BroadcastReceiver() {      // Location switched on/off from quick settings
        @Override public void onReceive(Context c, Intent i) { if (gates != null) gates.check(); }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RiderNativePlugin.class);
        super.onCreate(savedInstanceState);
        WebSettings ws = getBridge().getWebView().getSettings();
        ws.setMediaPlaybackRequiresUserGesture(false);      // new-offer ringing can play without a tap first
        ws.setGeolocationEnabled(true);
        // keep the screen on while the rider app is in front
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        gates = new Gates(this);
        handleOffer(getIntent());
    }

    // Opened from the ringing offer alert: show over the lock screen and wake the screen; "Accept" accepts on the server
    // and opens the deliveries screen. The page then shows the offer / the accepted delivery as usual.
    @Override
    protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); handleOffer(intent); }
    private void handleOffer(Intent i) {
        if (i == null || !(i.hasExtra("offer") || i.hasExtra("accept"))) return;
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        long acc = i.getLongExtra("accept", 0);
        if (acc > 0) { RiderService.acceptFromAlert(this, acc); getBridge().getWebView().postDelayed(() -> getBridge().getWebView().evaluateJavascript("location.hash='#/jobs';", null), 1500); }
        i.removeExtra("offer"); i.removeExtra("accept");
    }

    @Override
    public void onStart() { super.onStart(); RiderService.setForeground(this, true); }

    @Override
    public void onResume() {
        super.onResume();
        IntentFilter f = new IntentFilter(LocationManager.PROVIDERS_CHANGED_ACTION);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(providers, f, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(providers, f);
        gates.check();
    }

    @Override
    public void onPause() { try { unregisterReceiver(providers); } catch (Exception ignored) {} super.onPause(); }

    @Override
    public void onStop() { RiderService.setForeground(this, false); super.onStop(); }

    @Override
    public void onDestroy() { if (gates != null) gates.dismissAll(); super.onDestroy(); }

    @Override
    public void onRequestPermissionsResult(int code, @NonNull String[] perms, @NonNull int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == Gates.REQ_LOCATION || code == Gates.REQ_NOTIFY) getWindow().getDecorView().post(gates::check);
    }
}
