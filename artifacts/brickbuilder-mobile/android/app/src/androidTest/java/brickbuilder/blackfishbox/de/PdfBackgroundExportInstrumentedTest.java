package brickbuilder.blackfishbox.de;

import static org.junit.Assert.*;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Manually run on a device to exercise the real Capacitor WebView and PDF service. */
@RunWith(AndroidJUnit4.class)
public final class PdfBackgroundExportInstrumentedTest {
    private static final String WAKE_LOCK_TAG = "BrickBuilder:PdfExport";
    private static final int PDF_NOTIFICATION_ID = 4101;
    private static final int NOTIFICATIONS_API = 33;

    private Context context;
    private ActivityScenario<MainActivity> activity;
    private String jobId;
    private boolean notificationsWereGranted;
    private boolean notificationPermissionCaptured;

    @Before public void launchApp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        notificationsWereGranted = Build.VERSION.SDK_INT < NOTIFICATIONS_API
            || context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        notificationPermissionCaptured = true;
        activity = ActivityScenario.launch(MainActivity.class);
        awaitWebView();
    }

    @After public void stopServiceAndRestorePermission() throws Exception {
        if (jobId != null) {
            PdfExportService.stop(jobId, false, "", "");
            await(() -> !PdfExportService.isRunning(), "PDF service did not stop");
        }
        if (notificationPermissionCaptured && Build.VERSION.SDK_INT >= NOTIFICATIONS_API) {
            String permission = "android.permission.POST_NOTIFICATIONS";
            String action = notificationsWereGranted ? "grant" : "revoke";
            shell("pm " + action + " " + context.getPackageName() + " " + permission);
        }
        if (activity != null) activity.close();
    }

    @Test public void webViewKeepsRunningWhenTheAppIsSwitchedAway() throws Exception {
        startService();
        await(this::wakeLockHeld, "The service did not acquire its bounded partial wake lock");

        activity.onActivity(main -> main.getBridge().getWebView().evaluateJavascript(
            "clearInterval(window.__pdfBackgroundRegressionTimer);"
                + "window.__pdfBackgroundRegressionTicks=0;"
                + "window.__pdfBackgroundRegressionTimer=setInterval(()=>"
                + "window.__pdfBackgroundRegressionTicks++,50);", null));
        SystemClock.sleep(250);
        activity.moveToState(Lifecycle.State.CREATED);
        SystemClock.sleep(1500);
        activity.moveToState(Lifecycle.State.RESUMED);
        SystemClock.sleep(250);
        assertTrue("WebView timers should advance while the app is switched away",
            evaluateInteger("String(window.__pdfBackgroundRegressionTicks)") >= 10);
        assertTrue("The native service should remain active while the app is backgrounded",
            PdfExportService.isRunning());
    }

    @Test public void deniedNotificationPermissionDoesNotBlockExportOrLeakWakeLock() throws Exception {
        assumeNotificationsPermission();
        shell("pm revoke " + context.getPackageName() + " android.permission.POST_NOTIFICATIONS");
        assertEquals(PackageManager.PERMISSION_DENIED,
            context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS));

        startService();
        assertTrue("Notification denial must not prevent the foreground export service",
            PdfExportService.isRunning());
        await(this::wakeLockHeld, "The export did not acquire its CPU wake lock");

        PdfExportService.stop(jobId, false, "", "");
        await(() -> !PdfExportService.isRunning(), "Export service remained active after stopping");
        await(() -> !wakeLockHeld(), "Wake lock was not released after stopping the export");
    }

    @Test public void notificationCancelActionStopsExportAndReleasesWakeLock() throws Exception {
        assumeNotificationsPermission();
        shell("pm grant " + context.getPackageName() + " android.permission.POST_NOTIFICATIONS");
        assertEquals(PackageManager.PERMISSION_GRANTED,
            context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS));

        startService();
        assertTrue("The export should hold a wake lock before cancellation", wakeLockHeld());
        Notification progress = findProgressNotification();
        assertNotNull("The running PDF export notification should be visible", progress);
        assertNotNull("The progress notification should expose its cancel action", progress.actions);
        assertTrue("The progress notification should expose its cancel action",
            progress.actions.length > 0 && progress.actions[0].actionIntent != null);

        progress.actions[0].actionIntent.send();
        await(() -> !PdfExportService.isRunning(), "Notification cancellation did not stop the service");
        await(() -> !wakeLockHeld(), "Wake lock was not released after notification cancellation");
        assertNull("The foreground progress notification should be removed after cancellation",
            findProgressNotification());
    }

    private void assumeNotificationsPermission() {
        org.junit.Assume.assumeTrue("Runtime notification permission requires Android 13+",
            Build.VERSION.SDK_INT >= NOTIFICATIONS_API);
    }

    private void startService() throws Exception {
        jobId = UUID.randomUUID().toString();
        Intent start = new Intent(context, PdfExportService.class)
            .putExtra("jobId", jobId)
            .putExtra("title", "Creating instruction PDF")
            .putExtra("text", "Preparing PDF")
            .putExtra("channel", "PDF exports")
            .putExtra("cancel", "Cancel");
        ContextCompat.startForegroundService(context, start);
        await(PdfExportService::isRunning, "PDF foreground service did not start");
    }

    private Notification findProgressNotification() {
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        for (android.service.notification.StatusBarNotification entry : manager.getActiveNotifications()) {
            if (entry.getId() == PDF_NOTIFICATION_ID) return entry.getNotification();
        }
        return null;
    }

    private boolean wakeLockHeld() throws Exception {
        return shell("dumpsys power").contains(WAKE_LOCK_TAG);
    }

    private void awaitWebView() throws Exception {
        AtomicInteger ready = new AtomicInteger();
        long deadline = SystemClock.uptimeMillis() + 60000;
        while (ready.get() == 0 && SystemClock.uptimeMillis() < deadline) {
            activity.onActivity(main -> main.getBridge().getWebView().evaluateJavascript(
                "String(!!document.querySelector('.editor-shell'))",
                value -> ready.set("true".equals(value) ? 1 : 0)));
            if (ready.get() == 0) SystemClock.sleep(100);
        }
        assertEquals("BrickBuilder editor did not load in the WebView", 1, ready.get());
    }

    private int evaluateInteger(String expression) throws Exception {
        AtomicInteger value = new AtomicInteger(-1);
        activity.onActivity(main -> main.getBridge().getWebView().evaluateJavascript(
            expression, result -> value.set(parseNumber(result))));
        await(() -> value.get() >= 0, "WebView did not return a numeric regression result");
        return value.get();
    }

    private int parseNumber(String value) {
        try { return Integer.parseInt(value.replace("\"", "")); }
        catch (NumberFormatException ignored) { return 0; }
    }

    private interface Condition { boolean isTrue() throws Exception; }

    private void await(Condition condition, String failure) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 10000;
        while (!condition.isTrue() && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(100);
        assertTrue(failure, condition.isTrue());
    }

    private String shell(String command) throws Exception {
        try (ParcelFileDescriptor descriptor = InstrumentationRegistry.getInstrumentation()
                .getUiAutomation().executeShellCommand(command);
             ParcelFileDescriptor.AutoCloseInputStream stream =
                new ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }
}
