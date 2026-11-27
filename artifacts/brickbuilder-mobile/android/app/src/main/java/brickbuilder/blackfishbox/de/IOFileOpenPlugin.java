package brickbuilder.blackfishbox.de;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;

@CapacitorPlugin(name = "IOFileOpen")
public final class IOFileOpenPlugin extends Plugin {
    private static final int MAX_FILE_BYTES = 32 * 1024 * 1024;
    private Uri pendingUri;
    private String consumedUri;

    @Override
    protected void handleOnNewIntent(Intent intent) {
        Uri uri = acceptedUri(intent);
        if (uri == null) return;
        synchronized (this) {
            pendingUri = uri;
            consumedUri = null;
        }
        notifyListeners("fileOpened", new JSObject(), true);
    }

    @PluginMethod
    public void readPendingFile(PluginCall call) {
        Uri uri;
        synchronized (this) {
            uri = pendingUri;
            if (uri == null && getActivity() != null) {
                uri = acceptedUri(getActivity().getIntent());
                if (uri != null && uri.toString().equals(consumedUri)) uri = null;
            }
        }
        if (uri == null) {
            call.resolve();
            return;
        }

        try {
            String name = displayName(uri);
            if (!name.toLowerCase(Locale.ROOT).endsWith(".io")) {
                call.reject("Only Studio .io files can be opened here.");
                return;
            }
            byte[] bytes = readBytes(uri);
            JSObject result = new JSObject();
            result.put("name", name);
            result.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
            synchronized (this) {
                if (uri.equals(pendingUri)) pendingUri = null;
                consumedUri = uri.toString();
            }
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not read the selected .io file.", error);
        }
    }

    private static Uri acceptedUri(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return null;
        Uri uri = intent.getData();
        return uri != null && ("content".equals(uri.getScheme()) || "file".equals(uri.getScheme())) ? uri : null;
    }

    private String displayName(Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (column >= 0) {
                        String name = cursor.getString(column);
                        if (name != null && !name.trim().isEmpty()) return name;
                    }
                }
            } catch (Exception ignored) {
                // Fall through to the URI filename; reading the bytes will report access errors.
            }
        }
        String segment = uri.getLastPathSegment();
        return segment == null || segment.trim().isEmpty() ? "model.io" : segment;
    }

    private byte[] readBytes(Uri uri) throws Exception {
        try (InputStream input = "content".equals(uri.getScheme())
                ? getContext().getContentResolver().openInputStream(uri)
                : new java.io.FileInputStream(uri.getPath());
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("The selected file could not be opened.");
            byte[] buffer = new byte[32 * 1024];
            int total = 0;
            int count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > MAX_FILE_BYTES) throw new IllegalArgumentException("The selected .io file exceeds 32 MiB.");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }
}
