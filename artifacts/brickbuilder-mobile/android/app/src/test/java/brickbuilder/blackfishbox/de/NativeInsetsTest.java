package brickbuilder.blackfishbox.de;

import static org.junit.Assert.assertEquals;
import androidx.core.graphics.Insets;
import org.junit.Test;

public class NativeInsetsTest {
    @Test public void barsAndKeyboardAreNotAddedTogether() {
        assertEquals(Insets.of(0, 24, 0, 300), NativeInsets.padding(
            Insets.NONE, Insets.of(0, 24, 0, 48), Insets.NONE, Insets.of(0, 0, 0, 300)));
    }

    @Test public void rotationCutoutAndBaselineArePreserved() {
        Insets baseline = Insets.of(2, 3, 4, 5);
        Insets landscape = NativeInsets.padding(baseline, Insets.of(0, 0, 48, 0),
            Insets.of(32, 0, 0, 0), Insets.NONE);
        assertEquals(Insets.of(34, 3, 52, 5), landscape);
        assertEquals(landscape, NativeInsets.padding(baseline, Insets.of(0, 0, 48, 0),
            Insets.of(32, 0, 0, 0), Insets.NONE));
        assertEquals(baseline, NativeInsets.padding(baseline, Insets.NONE, Insets.NONE, Insets.NONE));
    }
}
