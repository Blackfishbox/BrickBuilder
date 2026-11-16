# Capacitor supplies plugin/reflection keep rules through consumerProguardFiles.
# Preserve useful locations for retracing native Android crash reports.
-keepattributes SourceFile,LineNumberTable

# The WebView invokes these methods from JavaScript, not direct Java calls.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
