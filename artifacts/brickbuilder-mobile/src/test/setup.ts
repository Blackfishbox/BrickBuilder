import "fake-indexeddb/auto";
import { beforeEach } from "vitest";

beforeEach(() => {
  // Keep most UI tests on German copy for deterministic assertions; default-language
  // behavior is tested separately with the stored selection removed.
  if (typeof localStorage !== "undefined" && localStorage.getItem("brickbuilder-language") === null) {
    localStorage.setItem("brickbuilder-language", "de");
  }
});
