package brickbuilder.blackfishbox.de;

import android.content.res.Configuration;
import android.os.Bundle;
import android.view.View;
import androidx.core.view.ViewCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private View insetContent;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PdfExportPlugin.class);
        super.onCreate(savedInstanceState);
        insetContent = findViewById(android.R.id.content);
        NativeInsets.install(getWindow(), insetContent);
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        requestContentInsets();
    }

    @Override
    public void onResume() {
        super.onResume();
        requestContentInsets();
    }

    private void requestContentInsets() {
        if (insetContent != null) {
            insetContent.post(() -> ViewCompat.requestApplyInsets(insetContent));
        }
    }
}
