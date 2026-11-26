package brickbuilder.blackfishbox.de;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.net.Uri;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.lang.ref.WeakReference;

/** User-started local file processing only; never a sticky or boot-started service. */
public final class PdfExportService extends Service {
    interface Listener {
        void onStarted(String jobId);
        void onStopped(String jobId, String reason);
    }

    static WeakReference<Listener> listener = new WeakReference<>(null);
    private static WeakReference<PdfExportService> current = new WeakReference<>(null);
    private static final String CHANNEL = "pdf-exports";
    private static final String CANCEL = "brickbuilder.pdf.CANCEL";
    private static final int NOTIFICATION = 4101, READY_NOTIFICATION = 4102;
    private static final long MAX_DURATION_MS = 2L * 60L * 60L * 1000L;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> finish(false, "", "", "timeout");
    private PowerManager.WakeLock wakeLock;
    private String jobId, title, cancel;

    static boolean isRunning() {
        PdfExportService service = current.get();
        return service != null && service.jobId != null;
    }

    static void update(String token, int done, int total, String text) {
        PdfExportService service = current.get();
        if (service == null || !token.equals(service.jobId)) return;
        try { service.manager().notify(NOTIFICATION, service.notification(text, done, total)); }
        catch (SecurityException ignored) { /* A denied notification permission must not abort the export. */ }
    }

    static void stop(String token, boolean success, String title, String text) {
        PdfExportService service = current.get();
        if (service != null && token.equals(service.jobId)) service.finish(success, title, text, "complete");
    }

    private NotificationManager manager() {
        return (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    }

    private PendingIntent openApp() {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 4100, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification notification(String text, int done, int total) {
        Intent stop = new Intent(this, PdfExportService.class).setAction(CANCEL)
            .setData(Uri.parse("brickbuilder:pdf-cancel/" + jobId)).putExtra("jobId", jobId);
        PendingIntent action = PendingIntent.getService(this, 4101, stop,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_pdf_export).setContentTitle(title).setContentText(text)
            .setContentIntent(openApp()).setOngoing(true).setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setProgress(Math.max(0, total), Math.max(0, Math.min(done, total)), total <= 0)
            .addAction(0, cancel, action).build();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        if (CANCEL.equals(intent.getAction())) {
            if (jobId != null && jobId.equals(intent.getStringExtra("jobId"))) finish(false, "", "", "cancelled");
            else if (jobId == null) stopSelf();
            return START_NOT_STICKY;
        }
        if (jobId != null) return START_NOT_STICKY;
        jobId = intent.getStringExtra("jobId");
        if (jobId == null) { stopSelf(); return START_NOT_STICKY; }
        current = new WeakReference<>(this);
        title = intent.getStringExtra("title");
        cancel = intent.getStringExtra("cancel");
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                manager().createNotificationChannel(new NotificationChannel(CHANNEL,
                    intent.getStringExtra("channel"), NotificationManager.IMPORTANCE_LOW));
            }
            ServiceCompat.startForeground(this, NOTIFICATION, notification(intent.getStringExtra("text"), 0, 0),
                Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0);
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BrickBuilder:PdfExport");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(MAX_DURATION_MS + 5000);
            handler.postDelayed(timeout, MAX_DURATION_MS);
            Listener callback = listener.get();
            if (callback != null) callback.onStarted(jobId);
            else finish(false, "", "", "interrupted");
        } catch (RuntimeException error) {
            finish(false, "", "", "unavailable");
        }
        return START_NOT_STICKY;
    }

    private void finish(boolean success, String readyTitle, String readyText, String reason) {
        String token = jobId;
        jobId = null;
        release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (success) {
            try {
                manager().notify(READY_NOTIFICATION, new NotificationCompat.Builder(this, CHANNEL)
                    .setSmallIcon(R.drawable.ic_pdf_export).setContentTitle(readyTitle).setContentText(readyText)
                    .setContentIntent(openApp()).setAutoCancel(true).setOnlyAlertOnce(true).build());
            } catch (SecurityException ignored) { /* Notification permission is optional for running this service. */ }
        }
        stopSelf();
        Listener callback = listener.get();
        if (callback != null && token != null) callback.onStopped(token, reason);
    }

    static void clearReadyNotification(android.content.Context context) {
        ((NotificationManager) context.getSystemService(NOTIFICATION_SERVICE)).cancel(READY_NOTIFICATION);
    }

    private void release() {
        handler.removeCallbacks(timeout);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    @Override public void onTimeout(int startId, int foregroundServiceType) {
        finish(false, "", "", "timeout");
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        finish(false, "", "", "cancelled");
    }

    @Override public void onDestroy() {
        String token = jobId;
        jobId = null;
        release();
        if (current.get() == this) current.clear();
        Listener callback = listener.get();
        if (token != null && callback != null) callback.onStopped(token, "interrupted");
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
