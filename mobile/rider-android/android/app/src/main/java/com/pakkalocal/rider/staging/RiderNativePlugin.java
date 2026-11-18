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

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    private JSObject status() {
        JSObject o = new JSObject();
        o.put("native", true);
        o.put("overlay", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext()));
        o.put("locationOn", Gates.locationOn(getContext()));
        o.put("running", RiderService.isRunning());
        return o;
    }
}
