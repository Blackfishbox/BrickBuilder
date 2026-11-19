import { XMLParser } from "fast-xml-parser";
import { parseInventory } from "./inventory/import";
import { MAX_LIST_BYTES } from "./inventory/types";
import { readStudioInstructions } from "./instructions/studio";

const format = process.argv[2];
const limit = format === "studio" ? 8 * 1024 * 1024 : MAX_LIST_BYTES;
const root = format === "studio" ? "Instruction" : "INVENTORY";
const prefix = `<${root}>`;
const fragment = "<a ";
const payload = prefix +
  fragment.repeat(Math.floor((limit - 1 - prefix.length) / fragment.length)) +
  " ".repeat((limit - 1 - prefix.length) % fragment.length);

if (payload.length !== limit - 1) throw new Error("Malformed XML fixture is not near its size limit.");

let parserRejected = false;
try {
  // Exercise the advisory's optional stop-node scanner as well as each real import path below.
  new XMLParser({ stopNodes: [root] }).parse(payload);
} catch {
  parserRejected = true;
}
if (!parserRejected) throw new Error("Parser accepted malformed stop-node XML.");

let rejected = false;
try {
  if (format === "studio") {
    readStudioInstructions(payload, { version: 1, edited: false, source: "ldraw", steps: [], warnings: [] });
  } else if (format === "inventory") {
    parseInventory(payload, "malformed.xml");
  } else {
    throw new Error("Unknown malformed XML import test.");
  }
} catch {
  rejected = true;
}

if (!rejected) throw new Error(`${format} import accepted malformed XML.`);
