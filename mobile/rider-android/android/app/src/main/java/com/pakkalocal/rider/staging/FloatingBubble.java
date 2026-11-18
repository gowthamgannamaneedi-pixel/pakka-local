package com.pakkalocal.rider.staging;

import android.animation.ValueAnimator;
import android.content.Context;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;

/**
 * The small round Pakka Rider icon on the side of the screen while the rider is online and using another app
 * (like the captain bubble in ride and delivery apps). Drag it anywhere; it snaps to the nearest side.
 * Tap it to return to Pakka Rider. It pulses and shows a red dot while delivery offers are waiting.
 * Needs the "Display over other apps" permission; without it nothing is shown (the notification still works).
 */
final class FloatingBubble {
    private final Context ctx;
    private final WindowManager wm;
    private FrameLayout view;
    private View dot;
    private WindowManager.LayoutParams lp;
    private ValueAnimator pulse;
    private boolean alert;
    private int savedX = -1, savedY = -1;

    FloatingBubble(Context c) { ctx = c.getApplicationContext(); wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE); }

    private int dp(float v) { return Math.round(v * ctx.getResources().getDisplayMetrics().density); }

    void show() {
        if (view != null || wm == null) return;
        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(ctx)) return;
        int size = dp(60);
        view = new FrameLayout(ctx);
        GradientDrawable ring = new GradientDrawable(); ring.setShape(GradientDrawable.OVAL); ring.setColor(0xFFFFFFFF); ring.setStroke(dp(3), 0xFFD0450B);
        ImageView icon = new ImageView(ctx);
        icon.setImageResource(R.mipmap.ic_launcher_round); icon.setBackground(ring); icon.setPadding(dp(4), dp(4), dp(4), dp(4));
        icon.setElevation(dp(6)); icon.setContentDescription("Open Pakka Rider");
        view.addView(icon, new FrameLayout.LayoutParams(size, size));
        dot = new View(ctx);
        GradientDrawable red = new GradientDrawable(); red.setShape(GradientDrawable.OVAL); red.setColor(0xFFE02424); red.setStroke(dp(2), 0xFFFFFFFF);
        dot.setBackground(red); dot.setElevation(dp(8)); dot.setVisibility(alert ? View.VISIBLE : View.GONE);
        FrameLayout.LayoutParams dl = new FrameLayout.LayoutParams(dp(16), dp(16)); dl.gravity = Gravity.TOP | Gravity.END;
        view.addView(dot, dl);

        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        lp = new WindowManager.LayoutParams(size + dp(4), size + dp(4), type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        DisplayMetrics m = ctx.getResources().getDisplayMetrics();
        lp.x = savedX >= 0 ? savedX : m.widthPixels - lp.width - dp(4);
        lp.y = savedY >= 0 ? savedY : m.heightPixels / 3;
        view.setOnTouchListener(new Drag());
        try { wm.addView(view, lp); } catch (Exception e) { view = null; return; }
        view.setScaleX(0f); view.setScaleY(0f);
        view.animate().scaleX(1f).scaleY(1f).setDuration(220).setInterpolator(new DecelerateInterpolator()).start();
        if (alert) startPulse();
    }

    void hide() {
        stopPulse();
        if (view != null) { savedX = lp.x; savedY = lp.y; try { wm.removeView(view); } catch (Exception ignored) {} view = null; }
    }

    void setAlert(boolean on) {
        if (alert == on) return;
        alert = on;
        if (dot != null) dot.setVisibility(on ? View.VISIBLE : View.GONE);
        if (on) startPulse(); else stopPulse();
    }

    private void startPulse() {
        if (view == null || pulse != null) return;
        pulse = ValueAnimator.ofFloat(1f, 1.14f);
        pulse.setDuration(520); pulse.setRepeatMode(ValueAnimator.REVERSE); pulse.setRepeatCount(ValueAnimator.INFINITE);
        pulse.addUpdateListener((a) -> { if (view != null) { float s = (float) a.getAnimatedValue(); view.setScaleX(s); view.setScaleY(s); } });
        pulse.start();
    }
    private void stopPulse() { if (pulse != null) { pulse.cancel(); pulse = null; } if (view != null) { view.setScaleX(1f); view.setScaleY(1f); } }

    private void openApp() {
        Intent i = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        ctx.startActivity(i);
    }

    private final class Drag implements View.OnTouchListener {
        private int sx, sy; private float tx, ty; private boolean moved;
        @Override public boolean onTouch(View v, MotionEvent e) {
            switch (e.getAction()) {
                case MotionEvent.ACTION_DOWN: sx = lp.x; sy = lp.y; tx = e.getRawX(); ty = e.getRawY(); moved = false; return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = e.getRawX() - tx, dy = e.getRawY() - ty;
                    if (Math.abs(dx) > dp(6) || Math.abs(dy) > dp(6)) moved = true;
                    lp.x = sx + (int) dx; lp.y = Math.max(0, sy + (int) dy);
                    try { wm.updateViewLayout(view, lp); } catch (Exception ignored) {}
                    return true;
                case MotionEvent.ACTION_UP:
                    if (!moved) { openApp(); return true; }
                    snap(); return true;
            }
            return false;
        }
    }

    private void snap() {
        if (view == null) return;
        int w = ctx.getResources().getDisplayMetrics().widthPixels;
        int to = lp.x + lp.width / 2 < w / 2 ? dp(4) : w - lp.width - dp(4);
        ValueAnimator a = ValueAnimator.ofInt(lp.x, to); a.setDuration(220); a.setInterpolator(new DecelerateInterpolator());
        a.addUpdateListener((x) -> { if (view == null) return; lp.x = (int) x.getAnimatedValue(); try { wm.updateViewLayout(view, lp); } catch (Exception ignored) {} });
        a.start();
    }
}
