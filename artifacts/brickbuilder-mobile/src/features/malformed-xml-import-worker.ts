import { XMLParser } from "fast-xml-parser";
import { parseInventory } from "./inventory/import";
import { MAX_LIST_BYTES } from "./inventory/types";
import { readStudioInstructions } from "./instructions/studio";

const format = process.argv[2];
const limit = format === "studio" ? 8 * 1024 * 1024 : MAX_LIST_BYTES;
const studioLimit = 8 * 1024 * 1024;

if (format === "studio-valid") {
  const prefix = `<Instruction><Pages><Page template="OneByOne"><Slot><Step SerializedIndex="0" RectOffset="0 0 0 0"/></Slot><BrickBuilderTitle>Near-limit valid import</BrickBuilderTitle></Page></Pages><VendorData>`;
  const suffix = "</VendorData></Instruction>";
  const payload = prefix + "x".repeat(studioLimit - prefix.length - suffix.length) + suffix;
  if (payload.length !== studioLimit) throw new Error("Valid Studio fixture is not at its size limit.");

  const plan = readStudioInstructions(payload, {
    version: 1,
    edited: false,
    source: "ldraw",
    steps: [{ id: "step-0", title: "", notes: "", partIds: [] }],
    warnings: [],
  });
  if (plan.source !== "studio" || plan.steps[0]?.title !== "Near-limit valid import" ||
      plan.studioLayout?.sourceXml !== payload || plan.warnings.length !== 0) {
    throw new Error("Valid near-limit Studio instructions were not imported intact.");
  }
} else {
  const root = format === "studio" ? "Instruction" : "INVENTORY";
  const malformedLimit = format === "studio" ? studioLimit : limit;
  const prefix = `<${root}>`;
  const fragment = "<a ";
  const payload = prefix +
    fragment.repeat(Math.floor((malformedLimit - 1 - prefix.length) / fragment.length)) +
    " ".repeat((malformedLimit - 1 - prefix.length) % fragment.length);

  if (payload.length !== malformedLimit - 1) throw new Error("Malformed XML fixture is not near its size limit.");

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
}
