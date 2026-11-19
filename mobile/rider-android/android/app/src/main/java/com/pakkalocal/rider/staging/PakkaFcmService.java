package com.pakkalocal.rider.staging;

import android.content.Context;
import androidx.annotation.NonNull;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Receives Firebase pushes sent by the Pakka Local server (data messages), also when the app is closed.
 * New delivery offers ring on the offers channel; other updates show as normal notifications. If the rider is
 * still online (saved sign-in) the background service is started again so the offer list keeps updating.
 */
public class PakkaFcmService extends FirebaseMessagingService {
    static volatile long lastOfferRing = 0;
    static boolean available(Context c) { try { return !FirebaseApp.getApps(c).isEmpty(); } catch (Throwable t) { return false; } }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage m) {
        Map<String, String> d = m.getData();
        String title = d.get("title"), body = d.get("body"), kind = d.get("kind");
        if (title == null) return;
        RiderService.showPush(this, title, body == null ? "" : body, "1".equals(d.get("urgent")) || "rider_offer".equals(kind), d.get("tag"));
        if ("rider_offer".equals(kind)) { lastOfferRing = System.currentTimeMillis(); RiderService.restartIfOnline(this); }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        getSharedPreferences("rider_bg", MODE_PRIVATE).edit().putString("fcm_token_pending", token).apply();      // the app sends it to the server at its next start
    }
}
