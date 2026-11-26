package brickbuilder.blackfishbox.de;

import android.Manifest;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ActivityNotFoundException;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "PdfExport", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public final class PdfExportPlugin extends Plugin implements PdfExportService.Listener {
    private PluginCall starting;
    private boolean foreground;
    private boolean permissionPending;
    private boolean rendererAdjusted;
    private int previousPriority;
    private boolean previousWaiveVisibility;
    private final Map<String, PluginCall> waits = new HashMap<>();
    private final BroadcastReceiver unlocked = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { resolveForegroundWaits(); }
    };

    @Override public void load() {
        foreground = getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED);
        PdfExportService.listener = new WeakReference<>(this);
        ContextCompat.registerReceiver(getContext(), unlocked, new IntentFilter(Intent.ACTION_USER_PRESENT),
            ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @PluginMethod public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (starting != null || PdfExportService.isRunning()) { call.reject("PDF_EXPORT_BUSY"); return; }
            if (!foreground) { call.reject("PDF_EXPORT_NOT_FOREGROUND"); return; }
            if (call.getString("jobId", "").isEmpty()) { call.reject("PDF_EXPORT_INVALID_JOB"); return; }
            starting = call;
            if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT) {
                permissionPending = true;
                requestPermissionForAlias("notifications", call, "notificationPermissionResult");
            } else begin(call);
        });
    }

    @PermissionCallback private void notificationPermissionResult(PluginCall call) {
        // Android permits an FGS even if notification permission was declined.
        getActivity().runOnUiThread(() -> {
            permissionPending = false;
            if (foreground) begin(call);
        });
    }

    private void begin(PluginCall call) {
        if (!foreground) { starting = null; call.reject("PDF_EXPORT_NOT_FOREGROUND"); return; }
        Intent intent = new Intent(getContext(), PdfExportService.class);
        for (String key : new String[] {"jobId", "title", "text", "channel", "cancel"}) {
            intent.putExtra(key, call.getString(key, ""));
        }
        try { ContextCompat.startForegroundService(getContext(), intent); }
        catch (RuntimeException error) { starting = null; call.reject("PDF_EXPORT_UNAVAILABLE", error); }
    }

    @Override public void onStarted(String jobId) {
        keepWebViewRunning();
        if (starting != null) { starting.resolve(); starting = null; }
    }

    @Override public void onStopped(String jobId, String reason) {
        WebView view = getBridge().getWebView();
        if (view instanceof ExportWebView) ((ExportWebView) view).setExporting(false);
        if (Build.VERSION.SDK_INT >= 26 && rendererAdjusted) {
            view.setRendererPriorityPolicy(previousPriority, previousWaiveVisibility);
            rendererAdjusted = false;
        }
        if (!foreground) view.onPause();
        if (starting != null) { starting.reject("PDF_EXPORT_" + reason); starting = null; }
        if (!"complete".equals(reason)) {
            JSObject data = new JSObject();
            data.put("jobId", jobId); data.put("reason", reason);
            notifyListeners("stopped", data);
        }
    }

    private void keepWebViewRunning() {
        WebView view = getBridge().getWebView();
        if (view instanceof ExportWebView) ((ExportWebView) view).setExporting(true);
        view.onResume();
        view.resumeTimers();
        if (Build.VERSION.SDK_INT >= 26) {
            if (!rendererAdjusted) {
                previousPriority = view.getRendererRequestedPriority();
                previousWaiveVisibility = view.getRendererPriorityWaivedWhenNotVisible();
                rendererAdjusted = true;
            }
            view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
    }

    /** Queue the continuation on Android's looper, not a hidden-page JS timer. */
    @PluginMethod public void yieldExecution(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (PdfExportService.isRunning()) call.resolve();
            else call.reject("PDF_EXPORT_NOT_RUNNING");
        });
    }

    @PluginMethod public void update(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            PdfExportService.update(call.getString("jobId", ""), call.getInt("done", 0),
                call.getInt("total", 0), call.getString("text", ""));
            call.resolve();
        });
    }

    @PluginMethod public void openBatteryOptimizationSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Intent settings = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            try {
                getActivity().startActivity(settings);
                call.resolve();
            } catch (ActivityNotFoundException error) {
                Intent appSettings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", getContext().getPackageName(), null));
                try {
                    getActivity().startActivity(appSettings);
                    call.resolve();
                } catch (RuntimeException fallbackError) {
                    call.reject("Could not open Android battery settings", fallbackError);
                }
            }
        });
    }

    @PluginMethod public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            PdfExportService.stop(call.getString("jobId", ""), call.getBoolean("success", false) && !canShare(),
                call.getString("title", ""), call.getString("text", ""));
            call.resolve();
        });
    }

    @PluginMethod public void waitForForeground(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (canShare()) call.resolve();
            else waits.put(call.getString("jobId", ""), call);
        });
    }

    private boolean canShare() {
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        KeyguardManager keyguard = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        return foreground && power.isInteractive() && !keyguard.isKeyguardLocked();
    }

    private void resolveForegroundWaits() {
        if (!canShare()) return;
        for (PluginCall call : waits.values()) call.resolve();
        waits.clear();
    }

    @PluginMethod public void cancelWait(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            PluginCall waiting = waits.remove(call.getString("jobId", ""));
            if (waiting != null) waiting.reject("PDF_EXPORT_CANCELLED");
            call.resolve();
        });
    }

    @Override protected void handleOnResume() {
        foreground = true;
        getBridge().getWebView().onResume();
        PdfExportService.clearReadyNotification(getContext());
        resolveForegroundWaits();
        if (starting != null && !permissionPending && !PdfExportService.isRunning()) begin(starting);
    }

    @Override protected void handleOnPause() {
        foreground = false;
        if (PdfExportService.isRunning()) keepWebViewRunning();
    }

    @Override protected void handleOnStop() {
        if (PdfExportService.isRunning()) keepWebViewRunning();
    }

    @Override protected void handleOnDestroy() {
        getContext().unregisterReceiver(unlocked);
        if (starting != null) { starting.reject("PDF_EXPORT_INTERRUPTED"); starting = null; }
        getContext().stopService(new Intent(getContext(), PdfExportService.class));
        for (PluginCall call : waits.values()) call.reject("PDF_EXPORT_INTERRUPTED");
        waits.clear();
        if (PdfExportService.listener.get() == this) PdfExportService.listener.clear();
    }
}
