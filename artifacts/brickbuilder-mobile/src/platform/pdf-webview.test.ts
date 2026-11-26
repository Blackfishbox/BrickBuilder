import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { XMLParser } from "fast-xml-parser";

it("inflates the export-aware WebView in Capacitor's actual bridge layout", () => {
  const layout = readFileSync(new URL("../../android/app/src/main/res/layout/capacitor_bridge_layout_main.xml", import.meta.url), "utf8");
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(layout);
  const view = parsed["androidx.coordinatorlayout.widget.CoordinatorLayout"]["brickbuilder.blackfishbox.de.ExportWebView"];
  expect(view["@_android:id"]).toBe("@+id/webview");
});

// Compile the actual Java policy against minimal Android API stubs. This tests
// dispatch/restoration, not Chromium or a physical device's power management.
it("keeps window visibility only for exports and restores the latest actual state", () => {
  const root = mkdtempSync(join(tmpdir(), "pdf-webview-"));
  const files: string[] = [];
  const source = (name: string, content: string) => {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
    files.push(path);
  };
  try {
    source("android/content/Context.java", "package android.content; public class Context {}");
    source("android/util/AttributeSet.java", "package android.util; public interface AttributeSet {}");
    source("com/getcapacitor/CapacitorWebView.java", `
      package com.getcapacitor;
      public class CapacitorWebView {
        public static final int VISIBLE = 0;
        public int reported = -1;
        public CapacitorWebView(android.content.Context c, android.util.AttributeSet a) {}
        protected void onWindowVisibilityChanged(int visibility) { reported = visibility; }
      }`);
    source("brickbuilder/blackfishbox/de/ExportWebView.java", readFileSync(
      new URL("../../android/app/src/main/java/brickbuilder/blackfishbox/de/ExportWebView.java", import.meta.url), "utf8",
    ));
    source("brickbuilder/blackfishbox/de/VisibilityTest.java", `
      package brickbuilder.blackfishbox.de;
      public class VisibilityTest {
        private static void check(ExportWebView view, int expected) {
          if (view.reported != expected) throw new AssertionError(view.reported + " != " + expected);
        }
        public static void main(String[] args) {
          ExportWebView view = new ExportWebView(null, null);
          view.onWindowVisibilityChanged(4); check(view, 4);
          view.setExporting(true); check(view, 0);
          view.onWindowVisibilityChanged(8); check(view, 0);
          view.setExporting(true); check(view, 0);
          view.setExporting(false); check(view, 8);
          view.onWindowVisibilityChanged(0); check(view, 0);
          view.setExporting(true);
          view.onWindowVisibilityChanged(4); check(view, 0);
          view.onWindowVisibilityChanged(0);
          view.setExporting(false); check(view, 0);
        }
      }`);
    execFileSync("javac", ["-d", root, ...files], { timeout: 15000 });
    execFileSync("java", ["-cp", root, "brickbuilder.blackfishbox.de.VisibilityTest"], { timeout: 5000 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 25000);
