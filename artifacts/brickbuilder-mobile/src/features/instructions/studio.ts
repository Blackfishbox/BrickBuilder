import { XMLParser } from "fast-xml-parser";
import type { InstructionPlan } from "./types";
import { instructionStepSchema } from "./types";
import { studioNodes, validateStudioXml } from "./studio-layout";

/** Only documented-by-fixture display settings are interpreted; all source bytes stay archived. */
export function readStudioInstructions(xml: string, plan: InstructionPlan): InstructionPlan {
  validateStudioXml(xml);
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false }).parse(xml);
  if (!parsed.Instruction) throw new Error("Unbekanntes Studio-Anleitungsformat.");
  const warnings = [...plan.warnings];
  const nodes = studioNodes(xml);
  const indices = nodes.filter(node => node.name === "Step" &&
    ["Slot", "CallOutStepItemData"].includes(nodes[node.parent ?? -1]?.name ?? ""))
    .map(node => /^\d+$/.test(node.attributes.SerializedIndex ?? "") ? Number(node.attributes.SerializedIndex) : NaN);
  const sourceIndices = new Set(plan.steps.map((step, index) => step.sourceIndex ?? index));
  const matches = new Set(indices).size === sourceIndices.size &&
    indices.every(index => Number.isInteger(index) && index >= 0 && sourceIndices.has(index));
  if (!matches) {
    warnings.push("Studio-Seiten und aufgelöste Bauschritte sind nicht deckungsgleich. Das originale Seitenlayout bleibt im IO-Archiv erhalten; angezeigt wird die LDraw-Schrittfolge.");
  }
  const steps = plan.steps.map(step => ({ ...step }));
  if (matches) {
    const pages = parsed.Instruction.Pages?.Page;
    for (const page of Array.isArray(pages) ? pages : pages ? [pages] : []) {
      const slots = page.Slot;
      for (const slot of Array.isArray(slots) ? slots : slots ? [slots] : []) {
        const pageSteps = slot.Step;
        for (const stored of Array.isArray(pageSteps) ? pageSteps : pageSteps ? [pageSteps] : []) {
          const index = Number(stored["@_SerializedIndex"]);
          if (!Number.isInteger(index)) continue;
          for (const step of steps.filter((step, position) => (step.sourceIndex ?? position) === index)) {
            const preview = stored.StepPreview;
            const angle = preview?.["@_modelAngle"] ?? preview?.["@_DefaultCameraControlInfo_modelAngle"];
            if (typeof angle === "string") {
              const radians = angle.trim().split(/\s+/).map(Number);
              if (radians.length === 3 && radians.every(Number.isFinite)) {
                step.rotation = radians.map(value => value * 180 / Math.PI) as [number, number, number];
              }
            }
            if (typeof page.BrickBuilderTitle === "string") step.title = page.BrickBuilderTitle.slice(0, 160);
            if (typeof page.BrickBuilderNotes === "string") step.notes = page.BrickBuilderNotes.slice(0, 2000);
            if (typeof page.BrickBuilderCamera === "string") {
              try {
                step.camera = instructionStepSchema.shape.camera.parse(JSON.parse(page.BrickBuilderCamera));
              } catch { warnings.push("Eine gespeicherte BrickBuilder-Schrittansicht ist ungültig und wurde nicht übernommen."); }
            }
          }
        }
      }
    }
  }
  return { ...plan, steps, source: "studio", warnings, studioLayout: { sourceXml: xml, edits: [] } };
}

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[char]!);

/** One assembly view per page; do not claim to reproduce Studio's page designer. */
export function writeStudioInstructions(plan: InstructionPlan): string {
  const pages = plan.steps.map((step, index) => {
    const [x, y, z] = (step.rotation ?? [0, 0, 0]).map(angle => angle * Math.PI / 180);
    const camera = step.camera ? `<BrickBuilderCamera>${escape(JSON.stringify(step.camera))}</BrickBuilderCamera>` : "";
    return `<Page template="OneByOne" IsLocked="False"><Slot><Step SerializedIndex="${index}" RectOffset="0 0 0 0"><StepPreview Depth="-100" targetPosOffset="0 0 0" IsForcedTargetPosOffset="False" cameraScale="250" TargetPos="0 0 0" cameraAngle="-0.5235988 0.7853982" modelAngle="${x} ${y} ${z}"/><StepNumber Depth="-30"/><PartList Rect="0 0 0 0" Depth="-70"/></Step></Slot><BrickBuilderTitle>${escape(step.title)}</BrickBuilderTitle><BrickBuilderNotes>${escape(step.notes)}</BrickBuilderNotes>${camera}</Page>`;
  }).join("");
  return `<Instruction><GlobalSetting><PageSetup><PaperType>A4</PaperType><LengthUnit>Pixels</LengthUnit><IsPortrait>True</IsPortrait><Margins>40 40 40 40</Margins></PageSetup></GlobalSetting><Pages>${pages}</Pages><CustomLayouts/></Instruction>`;
}
