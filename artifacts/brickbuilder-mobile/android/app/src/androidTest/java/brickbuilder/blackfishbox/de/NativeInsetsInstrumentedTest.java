package brickbuilder.blackfishbox.de;

import static org.junit.Assert.*;
import android.content.pm.ActivityInfo;
import android.graphics.Bitmap;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Actual Android window/WebView bounds, not a browser viewport approximation. */
@RunWith(AndroidJUnit4.class)
public class NativeInsetsInstrumentedTest {
    private void shell(String command) throws Exception {
        try (ParcelFileDescriptor descriptor = InstrumentationRegistry.getInstrumentation()
                .getUiAutomation().executeShellCommand(command);
             ParcelFileDescriptor.AutoCloseInputStream stream =
                new ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
            while (stream.read() != -1) { /* wait for command completion */ }
        }
    }

    private void capture(String name, String report) throws Exception {
        File dir = new File(InstrumentationRegistry.getInstrumentation().getTargetContext()
            .getExternalFilesDir(null), "inset-evidence");
        assertTrue(dir.isDirectory() || dir.mkdirs());
        Bitmap image = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        if (image != null) {
            try (FileOutputStream out = new FileOutputStream(new File(dir, name + ".png"))) {
                assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, out));
            }
            image.recycle();
        }
        try (FileOutputStream out = new FileOutputStream(new File(dir, name + ".txt"))) {
            out.write(report.getBytes(StandardCharsets.UTF_8));
        }
    }

    private void awaitBounds(ActivityScenario<MainActivity> scenario, String name, boolean keyboard) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 20000;
        String[] report = { "No native layout observed" };
        AtomicBoolean passed = new AtomicBoolean(false);
        while (!passed.get() && SystemClock.uptimeMillis() < deadline) {
            scenario.onActivity(activity -> {
                View decor = activity.getWindow().getDecorView();
                View web = activity.getBridge().getWebView();
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
                if (insets == null || web.getHeight() == 0) return;
                Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
                int bottom = Math.max(bars.bottom, ime.bottom);
                int[] position = new int[2];
                web.getLocationInWindow(position);
                int right = position[0] + web.getWidth(), end = position[1] + web.getHeight();
                report[0] = "window=" + decor.getWidth() + "x" + decor.getHeight()
                    + "\nweb=" + position[0] + "," + position[1] + "," + right + "," + end
                    + "\nbars=" + bars + "\nime=" + ime + "\n";
                // Exact native fit also catches duplicate padding and cumulative growth.
                passed.set(bars.top > 0 && bars.bottom + bars.right > 0
                    && insets.isVisible(WindowInsetsCompat.Type.ime()) == keyboard
                    && Math.abs(position[0] - bars.left) <= 1
                    && Math.abs(position[1] - bars.top) <= 1
                    && Math.abs(right - (decor.getWidth() - bars.right)) <= 1
                    && Math.abs(end - (decor.getHeight() - bottom)) <= 1);
            });
            if (!passed.get()) SystemClock.sleep(100);
        }
        capture(name, report[0]);
        assertTrue(name + ": " + report[0], passed.get());
    }

    @Test public void systemBarsRotationKeyboardAndResume() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicBoolean ready = new AtomicBoolean(false);
            long deadline = SystemClock.uptimeMillis() + 60000;
            while (!ready.get() && SystemClock.uptimeMillis() < deadline) {
                scenario.onActivity(a -> a.getBridge().getWebView().evaluateJavascript(
                    "!!document.querySelector('.editor-shell')", result -> ready.set("true".equals(result))));
                SystemClock.sleep(100);
            }
            assertTrue("The real editor must load, not only a blank WebView", ready.get());
            shell("cmd overlay enable --user 0 com.android.internal.display.cutout.emulation.tall");
            for (String mode : new String[] { "threebutton", "gestural" }) {
                shell("cmd overlay enable-exclusive --category com.android.internal.systemui.navbar." + mode);
                SystemClock.sleep(1000);
                scenario.onActivity(a -> {
                    int resource = a.getResources().getIdentifier("config_navBarInteractionMode", "integer", "android");
                    assertTrue("Navigation mode resource must exist", resource != 0);
                    assertEquals("The requested navigation mode must actually be active",
                        mode.equals("threebutton") ? 0 : 2, a.getResources().getInteger(resource));
                });
                scenario.onActivity(a -> {
                    a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                    WindowCompat.getInsetsController(a.getWindow(), a.getWindow().getDecorView())
                        .show(WindowInsetsCompat.Type.systemBars());
                });
                awaitBounds(scenario, mode + "-portrait", false);
                scenario.onActivity(a -> a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
                SystemClock.sleep(800);
                awaitBounds(scenario, mode + "-landscape", false);
                scenario.onActivity(a -> a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
                SystemClock.sleep(800);
                awaitBounds(scenario, mode + "-portrait-again", false);

                // Use the actual WebView IME connection to cover DOM input + viewport resize.
                scenario.onActivity(a -> a.getBridge().getWebView().evaluateJavascript(
                    "document.querySelector('[data-native-inset-input]')?.remove();"
                    + "var i=document.createElement('input'); i.dataset.nativeInsetInput='true';"
                    + "i.style.cssText='position:fixed;top:80px;left:20px;z-index:9999';"
                    + "document.body.appendChild(i); i.focus();", null));
                scenario.onActivity(a -> {
                    a.getBridge().getWebView().requestFocus();
                    ((InputMethodManager)a.getSystemService(android.content.Context.INPUT_METHOD_SERVICE))
                        .showSoftInput(a.getBridge().getWebView(), InputMethodManager.SHOW_IMPLICIT);
                });
                awaitBounds(scenario, mode + "-keyboard", true);
                scenario.onActivity(a -> {
                    WindowCompat.getInsetsController(a.getWindow(), a.getWindow().getDecorView())
                        .hide(WindowInsetsCompat.Type.ime());
                    a.getBridge().getWebView().evaluateJavascript(
                        "document.querySelector('[data-native-inset-input]')?.remove()", null);
                });
                awaitBounds(scenario, mode + "-keyboard-closed", false);
                scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
                scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
                awaitBounds(scenario, mode + "-resumed", false);
            }
        }
    }
}
