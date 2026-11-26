package brickbuilder.blackfishbox.de;

import android.content.Context;
import android.util.AttributeSet;
import com.getcapacitor.CapacitorWebView;

/**
 * Keep Chromium's window visible only during a user-started PDF export.
 * onResume/resumeTimers alone do not undo hidden-window throttling.
 */
public final class ExportWebView extends CapacitorWebView {
    private boolean exporting;
    private int actualWindowVisibility = VISIBLE;

    public ExportWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public void setExporting(boolean value) {
        if (exporting == value) return;
        exporting = value;
        super.onWindowVisibilityChanged(exporting ? VISIBLE : actualWindowVisibility);
    }

    @Override protected void onWindowVisibilityChanged(int visibility) {
        actualWindowVisibility = visibility;
        super.onWindowVisibilityChanged(exporting ? VISIBLE : visibility);
    }
}
