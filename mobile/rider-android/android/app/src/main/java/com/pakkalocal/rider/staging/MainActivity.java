package com.pakkalocal.rider.staging;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

// TESTING BUILD: opens the Pakka Local rider portal on the staging server (see capacitor.config.json).
// Location permission prompts from the page are handled by Capacitor's WebChromeClient (Android runtime permission).
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebSettings ws = getBridge().getWebView().getSettings();
        ws.setMediaPlaybackRequiresUserGesture(false);      // new-offer ringing can play without a tap first
        ws.setGeolocationEnabled(true);
        // keep the screen on while the rider app is in front: GPS sharing pauses when the screen locks
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
