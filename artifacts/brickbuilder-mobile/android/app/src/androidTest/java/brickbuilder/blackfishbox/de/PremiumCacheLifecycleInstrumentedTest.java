package brickbuilder.blackfishbox.de;

import static org.junit.Assert.*;

import android.content.Context;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONTokener;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Device tests for RevenueCat's real Android CustomerInfo cache.
 *
 * Run each phase separately as described in PREMIUM_OFFLINE_REGRESSION.md. The
 * process is force-stopped by that procedure between priming and offline checks.
 */
@RunWith(AndroidJUnit4.class)
public final class PremiumCacheLifecycleInstrumentedTest {
    private static final String ENTITLEMENT = "brickbuilder_premium";
    private static final String GEOMETRY_CONSENT_KEY = "brickbuilder.remote-geometry.v1";
    private static final String BASELINE_PREFS = "premium-cache-lifecycle-regression";
    private static final String BASELINE_KEY = "geometry-consent";
    private static final long PAGE_TIMEOUT_MS = 60_000;
    private static final long CUSTOMER_INFO_TIMEOUT_MS = 20_000;

    private ActivityScenario<MainActivity> activity;
    private Context targetContext;

    @Before public void launchApp() throws Exception {
        targetContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        activity = ActivityScenario.launch(MainActivity.class);
        await(() -> evaluateBoolean("!!document.querySelector('.editor-shell')"),
            PAGE_TIMEOUT_MS, "BrickBuilder did not load in the WebView");
    }

    @After public void closeAppActivity() {
        if (activity != null) activity.close();
    }

    /** Run online after the owned test account has a cached active entitlement. */
    @Test public void primeOwnedCacheAndGeometryConsentBaseline() throws Exception {
        assertTrue("The real RevenueCat SDK should report the owned lifetime entitlement",
            awaitNativePremium(true, CUSTOMER_INFO_TIMEOUT_MS));
        assertPremiumMenuVisible(false);
        setAndRecordGeometryConsent("enabled");
    }

    /** Run after force-stopping the app while connectivity is disabled. */
    @Test public void ownedLifetimeEntitlementSurvivesOfflineProcessRestart() throws Exception {
        assertTrue("The native RevenueCat cache should retain owned Premium offline after restart",
            awaitNativePremium(true, CUSTOMER_INFO_TIMEOUT_MS));
        assertPremiumMenuVisible(false);
        assertGeometryConsentMatchesBaseline();
    }

    /** Run online with a fresh, known-unowned RevenueCat installation before its restart. */
    @Test public void primeUnownedCacheAndGeometryConsentBaseline() throws Exception {
        assertTrue("A fresh unowned installation must not receive the Premium entitlement",
            awaitNativePremium(false, CUSTOMER_INFO_TIMEOUT_MS));
        assertPremiumMenuVisible(true);
        setAndRecordGeometryConsent("disabled");
    }

    /** Run after force-stopping the unowned installation while connectivity is disabled. */
    @Test public void unownedInstallationStaysLockedAfterOfflineProcessRestart() throws Exception {
        assertTrue("The native RevenueCat cache must not invent Premium ownership offline",
            awaitNativePremium(false, CUSTOMER_INFO_TIMEOUT_MS));
        assertPremiumMenuVisible(true);
        assertGeometryConsentMatchesBaseline();
    }

    /**
     * Run online after the owned RevenueCat test customer has been revoked while offline.
     * Polling the app's visibility refresh lets the normal store flow process the new result.
     */
    @Test public void reconnectingAppliesRevocationWithoutChangingGeometryConsent() throws Exception {
        assertRecordedGeometryConsent("enabled");
        long deadline = SystemClock.uptimeMillis() + TimeUnit.MINUTES.toMillis(7);
        boolean revoked = false;
        while (SystemClock.uptimeMillis() < deadline) {
            evaluateBoolean("document.dispatchEvent(new Event('visibilitychange')); true");
            if (awaitNativePremium(false, 15_000)) {
                assertPremiumMenuVisible(true);
                revoked = true;
                break;
            }
            SystemClock.sleep(2_000);
        }
        assertTrue("RevenueCat did not apply the server-side revocation after reconnecting", revoked);
        assertGeometryConsentMatchesBaseline();
    }

    private boolean awaitNativePremium(boolean expected, long timeoutMs) throws Exception {
        CountDownLatch resultLatch = new CountDownLatch(1);
        AtomicReference<Boolean> active = new AtomicReference<>();
        AtomicReference<String> failure = new AtomicReference<>();

        Object purchases = purchasesSingleton();
        Method getCustomerInfo = null;
        for (Method method : purchases.getClass().getMethods()) {
            if ("getCustomerInfo".equals(method.getName()) && method.getParameterCount() == 1
                && method.getParameterTypes()[0].isInterface()) {
                getCustomerInfo = method;
                break;
            }
        }
        assertNotNull("RevenueCat's native getCustomerInfo callback API was not found", getCustomerInfo);

        Class<?> callbackType = getCustomerInfo.getParameterTypes()[0];
        InvocationHandler callback = (proxy, method, args) -> {
            if ("onReceived".equals(method.getName()) && args != null && args.length > 0
                && args[0] != null && args[0].getClass().getName().endsWith(".CustomerInfo")) {
                Object entitlements = args[0].getClass().getMethod("getEntitlements").invoke(args[0]);
                Object activeEntitlements = entitlements.getClass().getMethod("getActive").invoke(entitlements);
                active.set(((Map<?, ?>) activeEntitlements).containsKey(ENTITLEMENT));
                resultLatch.countDown();
            } else if ("onError".equals(method.getName())) {
                failure.set(args == null || args.length == 0 ? "Unknown RevenueCat error" : String.valueOf(args[0]));
                resultLatch.countDown();
            }
            return null;
        };
        Object callbackProxy = Proxy.newProxyInstance(
            callbackType.getClassLoader(), new Class<?>[] { callbackType }, callback);
        getCustomerInfo.invoke(purchases, callbackProxy);

        assertTrue("RevenueCat did not return cached or refreshed CustomerInfo",
            resultLatch.await(timeoutMs, TimeUnit.MILLISECONDS));
        assertNull("RevenueCat getCustomerInfo failed: " + failure.get(), failure.get());
        assertNotNull("CustomerInfo callback did not include an ownership result", active.get());
        return active.get() == expected;
    }

    private Object purchasesSingleton() throws Exception {
        Class<?> purchasesClass = Class.forName("com.revenuecat.purchases.Purchases");
        try {
            Field sharedInstance = purchasesClass.getField("sharedInstance");
            return sharedInstance.get(null);
        } catch (NoSuchFieldException ignored) {
            try {
                return purchasesClass.getMethod("getSharedInstance").invoke(null);
            } catch (NoSuchMethodException ignoredAgain) {
                Field companionField = purchasesClass.getField("Companion");
                Object companion = companionField.get(null);
                return companion.getClass().getMethod("getSharedInstance").invoke(companion);
            }
        }
    }

    private void setAndRecordGeometryConsent(String value) throws Exception {
        assertTrue("Could not set the geometry-consent test fixture",
            evaluateBoolean("localStorage.setItem('" + GEOMETRY_CONSENT_KEY + "', '" + value + "'); true"));
        String stored = evaluateString("localStorage.getItem('" + GEOMETRY_CONSENT_KEY + "')");
        assertEquals(value, stored);
        targetContext.getSharedPreferences(BASELINE_PREFS, Context.MODE_PRIVATE)
            .edit().putString(BASELINE_KEY, stored).commit();
    }

    private void assertGeometryConsentMatchesBaseline() throws Exception {
        String expected = targetContext.getSharedPreferences(BASELINE_PREFS, Context.MODE_PRIVATE)
            .getString(BASELINE_KEY, null);
        assertNotNull("Run the matching online cache-priming phase first", expected);
        assertEquals("Premium ownership changes must not modify geometry consent", expected,
            evaluateString("localStorage.getItem('" + GEOMETRY_CONSENT_KEY + "')"));
    }

    private void assertRecordedGeometryConsent(String expected) {
        assertEquals("Run the matching online cache-priming phase first", expected,
            targetContext.getSharedPreferences(BASELINE_PREFS, Context.MODE_PRIVATE)
                .getString(BASELINE_KEY, null));
    }

    private void assertPremiumMenuVisible(boolean expected) throws Exception {
        evaluateBoolean("document.querySelector('[data-testid=\"button-project-menu\"]').click(); true");
        if (expected) {
            await(() -> evaluateBoolean(
                "!!document.querySelector('[data-testid=\"button-open-premium\"]')"),
                15_000, "An unowned installation should show the locked Premium purchase entry");
        } else {
            SystemClock.sleep(5_000);
            assertFalse("An owned installation should not show the Premium purchase entry",
                evaluateBoolean("!!document.querySelector('[data-testid=\"button-open-premium\"]')"));
        }
    }

    private boolean evaluateBoolean(String script) throws Exception {
        Object result = evaluate(script);
        return Boolean.TRUE.equals(result);
    }

    private String evaluateString(String script) throws Exception {
        Object result = evaluate(script);
        return result == null ? null : String.valueOf(result);
    }

    private Object evaluate(String script) throws Exception {
        AtomicReference<Object> result = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        activity.onActivity(main -> {
            WebView webView = main.getBridge().getWebView();
            webView.evaluateJavascript(script, value -> {
                try { result.set(new JSONTokener(value).nextValue()); }
                catch (Exception error) { result.set(null); }
                latch.countDown();
            });
        });
        assertTrue("WebView did not answer the Premium lifecycle check",
            latch.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private interface Condition { boolean isTrue() throws Exception; }

    private void await(Condition condition, long timeoutMs, String failure) throws Exception {
        long deadline = SystemClock.uptimeMillis() + timeoutMs;
        while (!condition.isTrue() && SystemClock.uptimeMillis() < deadline) {
            SystemClock.sleep(250);
        }
        assertTrue(failure, condition.isTrue());
    }
}
