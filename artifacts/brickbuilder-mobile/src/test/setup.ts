import "fake-indexeddb/auto";
import { beforeEach } from "vitest";

beforeEach(() => {
  if (typeof localStorage !== "undefined" && localStorage.getItem("brickbuilder-language") === null) {
    localStorage.setItem("brickbuilder-language", "de");
  }
});
