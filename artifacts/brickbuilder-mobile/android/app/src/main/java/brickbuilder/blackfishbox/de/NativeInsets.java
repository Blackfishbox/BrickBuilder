package brickbuilder.blackfishbox.de;

import android.view.View;
import android.view.Window;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

/** One native owner for the entire WebView, including fixed-position dialogs. */
final class NativeInsets {
    private NativeInsets() {}

    static Insets padding(Insets baseline, Insets bars, Insets cutout, Insets keyboard) {
        Insets safe = Insets.max(Insets.max(bars, cutout), keyboard);
        return Insets.of(
            baseline.left + safe.left, baseline.top + safe.top,
            baseline.right + safe.right, baseline.bottom + safe.bottom
        );
    }

    static void install(Window window, View content) {
        WindowCompat.setDecorFitsSystemWindows(window, false);
        content.setFitsSystemWindows(false);
        // Capture once. Reapplying/rotating must never accumulate old insets.
        Insets baseline = Insets.of(
            content.getPaddingLeft(), content.getPaddingTop(),
            content.getPaddingRight(), content.getPaddingBottom()
        );
        int barsAndCutout = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            Insets next = padding(
                baseline, insets.getInsets(WindowInsetsCompat.Type.systemBars()),
                insets.getInsets(WindowInsetsCompat.Type.displayCutout()),
                insets.getInsets(WindowInsetsCompat.Type.ime())
            );
            if (view.getPaddingLeft() != next.left || view.getPaddingTop() != next.top
                || view.getPaddingRight() != next.right || view.getPaddingBottom() != next.bottom) {
                view.setPadding(next.left, next.top, next.right, next.bottom);
            }
            // The child WebView is already fitted. Do not pass the same bars
            // to CSS env(safe-area-inset-*) or apply the keyboard a second time.
            // Do not return CONSUMED: WebView must still receive future changes.
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(barsAndCutout | WindowInsetsCompat.Type.ime(), Insets.NONE)
                .setInsetsIgnoringVisibility(barsAndCutout, Insets.NONE)
                .setDisplayCutout(null)
                .build();
        });
        content.post(() -> ViewCompat.requestApplyInsets(content));
    }
}
