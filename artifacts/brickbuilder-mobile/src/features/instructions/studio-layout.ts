import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { StudioLayout } from "./types";
import { supportedStudioArrow, supportedStudioCallout } from "./studio-objects";

export interface StudioNode {
  id: number;
  name: string;
  parent?: number;
  attributes: Record<string, string>;
  start: number;
  end: number;
}
export interface StudioLayoutField {
  attribute: string;
  label: string;
  kind: "number" | "vector2" | "vector4" | "boolean" | "color" | "text";
}
export interface StudioLayoutItem {
  nodeId: number;
  label: string;
  imagePath?: string;
  fields: StudioLayoutField[];
  attributes: Record<string, string>;
}
export interface StudioLayoutPage {
  nodeId: number;
  template: string;
  steps: number[];
  items: StudioLayoutItem[];
}
export interface StudioLayoutView {
  pages: StudioLayoutPage[];
  calloutStyles: StudioLayoutItem[];
  unsupportedCount: number;
  unsupportedDetails: string[];
}

export function validateStudioXml(xml: string) {
  if (xml.length > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new Error("Studio-Anleitungsdaten sind ungültig oder zu groß.");
  }
}

/** Token spans allow attribute-only changes without reserializing unknown XML. */
export function studioNodes(xml: string): StudioNode[] {
  validateStudioXml(xml);
  const nodes: StudioNode[] = [], stack: number[] = [];
  const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, parseTagValue: false });
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
  for (const token of xml.matchAll(tokens)) {
    const text = token[0];
    if (/^<[/!?]/.test(text)) {
      if (text.startsWith("</")) stack.pop();
      continue;
    }
    if (nodes.length >= 100000 || stack.length > 64) throw new Error("Studio-Seitenlayout ist zu komplex.");
    const name = /^<([\w:.-]+)/.exec(text)![1];
    // Parse just this opening tag to decode XML entities, not an unknown subtree.
    const attrs = parser.parse(text.replace(/\/?>$/, "/>"))[name];
    const attributes = Object.fromEntries(Object.entries(attrs ?? {})
      .filter(([key]) => key.startsWith("@_")).map(([key, value]) => [key.slice(2), String(value)]));
    const node: StudioNode = { id: nodes.length, name, parent: stack.at(-1), attributes, start: token.index!, end: token.index! + text.length };
    nodes.push(node);
    if (!text.endsWith("/>")) stack.push(node.id);
  }
  if (nodes[0]?.name !== "Instruction") throw new Error("Unbekanntes Studio-Anleitungsformat.");
  return nodes;
}

const f = (attribute: string, label: string, kind: StudioLayoutField["kind"]): StudioLayoutField => ({ attribute, label, kind });
const depthFields = (node: StudioNode) => ["Depth", "depth"]
  .filter(attribute => Object.hasOwn(node.attributes, attribute))
  .map(attribute => f(attribute, "Layer depth (Studio value)", "number"));

function isInGlobalStyle(node: StudioNode, nodes: StudioNode[]): boolean {
  let ancestor = node.parent === undefined ? undefined : nodes[node.parent];
  while (ancestor) {
    if (ancestor.name === "GlobalStyle") return true;
    ancestor = ancestor.parent === undefined ? undefined : nodes[ancestor.parent];
  }
  return false;
}

/** Only fields observed in source fixtures are editable; no guessed native objects. */
function fieldsFor(node: StudioNode, nodes: StudioNode[]): StudioLayoutField[] {
  const parent = node.parent === undefined ? undefined : nodes[node.parent];
  let fields: StudioLayoutField[] = [];
  const inGlobalStyle = isInGlobalStyle(node, nodes);
  if (node.name === "Page" && parent?.name === "Pages") fields = [f("IsLocked", "Seite sperren", "boolean")];
  if (node.name === "Step" && parent?.name === "Slot") fields = [f("RectOffset", "Schrittversatz (Studio-Werte)", "vector4")];
  if (node.name === "CallOutItemData") fields = [
    f("Rect", "Callout-Position und Größe (relativ zum Schritt)", "vector4"),
    f("IsVisible", "Callout sichtbar", "boolean"),
    f("MultiplierValue", "Anzahl", "number"),
    f("MultiplierPosition", "Anzahlversatz", "vector2"),
    f("CalloutGridMaxPerLine", "Schritte pro Zeile", "number"),
    f("IsCalloutAsRows", "Zeilenweise anordnen", "boolean"),
    ...depthFields(node),
  ];
  if (node.name === "CallOutArrowItemData") fields = [
    f("ArrowPosition", "Pfeilanfang und Ziel (Studio-Werte)", "vector4"),
    f("IsVisible", "Pfeil sichtbar", "boolean"),
    ...depthFields(node),
  ];
  if (node.name === "Arrow" && ["Page", "Slot"].includes(parent?.name ?? "")) fields = [
    f("PointList", "Pfeilanfang und Ziel (Studio-Werte)", "vector4"),
    f("IsVisible", "Pfeil sichtbar", "boolean"),
    f("StartStyle", "Pfeilanfang", "text"), f("EndStyle", "Pfeilspitze", "text"),
    f("Thickness", "Pfeilstärke", "number"),
    ...depthFields(node),
  ];
  if (node.name === "Image" && parent?.name === "Slot") fields = [
    f("rect", "Position X / Y und Breite / Höhe (Studio-Werte)", "vector4"),
    f("rotation", "Drehung (Grad)", "number"), f("opacity", "Deckkraft (0–1)", "number"),
    f("fliped_H", "Horizontal spiegeln", "boolean"), f("fliped_V", "Vertikal spiegeln", "boolean"),
    ...depthFields(node),
  ];
  if (inGlobalStyle) {
    if (["CallOut", "Multiplier"].includes(node.name)) fields = [f("IsVisible", "Sichtbar", "boolean")];
    if (node.name === "Colors") fields = [
      f("IsUseBgColor", "Hintergrund verwenden", "boolean"), f("BgColor", "Hintergrund RGBA (0–1)", "color"),
      f("IsUseBorder", "Rahmen verwenden", "boolean"), f("BorderColor", "Rahmen RGBA (0–1)", "color"),
      f("BorderThickness", "Rahmenstärke", "number"), f("BorderRadius", "Eckenradius", "number"),
    ];
    if (node.name === "ArrowStyle") fields = [f("Style", "Pfeilform", "text"), f("Thickness", "Pfeilstärke", "number"), f("Color", "Pfeil RGBA (0–1)", "color")];
    if (node.name === "Divider") fields = [f("IsVisible", "Trennlinie sichtbar", "boolean"), f("DividerThickness", "Linienstärke", "number"), f("DividerColor", "Linie RGBA (0–1)", "color")];
    if (node.name === "Padding") fields = [f("LRBT", "Innenabstand links / rechts / unten / oben", "vector4")];
    if (node.name === "Margin" || node.name === "Spacing" || node.name === "AssemblyMargin") fields = [
      f("Horizontal", "Horizontaler Abstand", "number"), f("Vertical", "Vertikaler Abstand", "number"),
    ];
    if (["Font", "StepNumber", "PartCount", "Multiplier"].includes(node.name)) fields.push(
      f("FontFamily", "Schriftfamilie", "text"), f("FontStyle", "Schriftschnitt", "text"),
      f("FontColor", "Schriftfarbe RGBA (0–1)", "color"), f("FontSize", "Schriftgröße", "number"),
    );
    if (node.name === "Page" && parent?.name === "GlobalStyle") fields = [
      f("SlotSpacing", "Abstand zwischen Schritten", "vector2"),
    ];
  }
  return fields.filter(field => Object.hasOwn(node.attributes, field.attribute));
}

function checkValue(field: StudioLayoutField, value: string) {
  if (field.kind === "boolean") return value === "True" || value === "False";
  if (field.kind === "text") return value.length <= 160 && !/[\u0000-\u001f]/.test(value);
  const tokens = value.trim().split(field.kind === "color" ? ":" : /\s+/);
  if (!tokens.every(token => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token))) return false;
  const values = tokens.map(Number);
  const count = field.kind === "vector4" || field.kind === "color" ? 4 : field.kind === "vector2" ? 2 : 1;
  if (!value.trim() || values.length !== count || !values.every(n => Number.isFinite(n) && Math.abs(n) <= 1e6)) return false;
  if (field.kind === "color" || field.attribute === "opacity") return values.every(n => n >= 0 && n <= 1);
  if (/Thickness|Radius/.test(field.attribute)) return values[0] >= 0;
  if (field.attribute === "rect" || field.attribute === "Rect") return values[2] > 0 && values[3] > 0;
  if (field.attribute === "MultiplierValue") return Number.isInteger(values[0]) && values[0] >= 1;
  if (field.attribute === "CalloutGridMaxPerLine") return Number.isInteger(values[0]) && values[0] >= 0;
  return true;
}

export function applyStudioLayout(layout: StudioLayout): string {
  const nodes = studioNodes(layout.sourceXml), replacements = new Map<number, Map<string, string>>();
  for (const edit of layout.edits) {
    const node = nodes[edit.nodeId], field = node && fieldsFor(node, nodes).find(field => field.attribute === edit.attribute);
    if (!node || !field || !checkValue(field, edit.value)) throw new Error("Ungültige oder nicht unterstützte Studio-Layoutänderung.");
    const attrs = replacements.get(node.id) ?? new Map<string, string>();
    if (attrs.has(edit.attribute)) throw new Error("Doppelte Studio-Layoutänderung.");
    attrs.set(edit.attribute, edit.value); replacements.set(node.id, attrs);
  }
  let xml = layout.sourceXml;
  for (const [id, attrs] of [...replacements].sort(([a], [b]) => b - a)) {
    const node = nodes[id];
    const text = xml.slice(node.start, node.end).replace(/([\w:.-]+)(\s*=\s*)(["'])(.*?)\3/g, (original, name, equals, quote) => {
      const value = attrs.get(name);
      if (value === undefined) return original;
      const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
      return `${name}${equals}${quote}${escaped}${quote}`;
    });
    xml = xml.slice(0, node.start) + text + xml.slice(node.end);
  }
  validateStudioXml(xml);
  return xml;
}

export function editStudioLayout(layout: StudioLayout, nodeId: number, attribute: string, value: string): StudioLayout {
  const node = studioNodes(layout.sourceXml)[nodeId];
  const edits = layout.edits.filter(edit => edit.nodeId !== nodeId || edit.attribute !== attribute);
  if (node?.attributes[attribute] !== value) edits.push({ nodeId, attribute, value });
  const next = { ...layout, edits };
  applyStudioLayout(next);
  return next;
}

export function inspectStudioLayout(layout: StudioLayout): StudioLayoutView {
  const nodes = studioNodes(applyStudioLayout(layout));
  const pages: StudioLayoutPage[] = [], calloutStyles: StudioLayoutItem[] = [];
  const pageByNode = new Map<number, StudioLayoutPage>();
  let unsupportedCount = 0;
  const unsupportedElementCounts = new Map<string, number>();
  const unsupportedDetails: string[] = [];
  const supportedFontFamilies = new Set(["arial", "helvetica", "times", "times new roman", "courier", "courier new"]);
  const customLayoutsNode = nodes.find(node => node.name === "CustomLayouts");
  const hasCustomRectTemplate = (template: string) => {
    if (customLayoutsNode === undefined) return false;
    const underCustomLayouts = (node: StudioNode) => {
      let parent = node.parent === undefined ? undefined : nodes[node.parent];
      while (parent) {
        if (parent.id === customLayoutsNode.id) return true;
        parent = parent.parent === undefined ? undefined : nodes[parent.parent];
      }
      return false;
    };
    const matches = nodes.filter(node => underCustomLayouts(node) &&
      ["Name", "name", "template", "Template", "LayoutName", "ID", "GUID"].some(key => node.attributes[key] === template));
    return matches.some(match => nodes.some(candidate => {
      let parent = candidate.parent === undefined ? undefined : nodes[candidate.parent];
      while (parent && parent.id !== match.id) parent = parent.parent === undefined ? undefined : nodes[parent.parent];
      if (!parent) return false;
      const raw = candidate.attributes.rect ?? candidate.attributes.Rect ?? candidate.attributes.LayoutRect ?? "";
      const rect = raw.trim().split(/\s+/).map(Number);
      return rect.length === 4 && rect.every(Number.isFinite) && rect[2] > 0 && rect[3] > 0;
    }));
  };
  for (const node of nodes) {
    const parent = node.parent === undefined ? undefined : nodes[node.parent];
    const fields = fieldsFor(node, nodes);
    const item = { nodeId: node.id, label: node.name, fields, attributes: node.attributes };
    const inGlobalStyle = isInGlobalStyle(node, nodes);
    if (node.name === "Page" && parent?.name === "Pages") {
      const page = { nodeId: node.id, template: node.attributes.template ?? "Unbekannt", steps: [], items: [item] };
      pages.push(page); pageByNode.set(node.id, page);
    }
    let ancestor = parent;
    let page = ancestor && pageByNode.get(ancestor.id);
    while (ancestor && !page) {
      ancestor = ancestor.parent === undefined ? undefined : nodes[ancestor.parent];
      page = ancestor && pageByNode.get(ancestor.id);
    }
    if (page && node.name !== "Page") {
      pageByNode.set(node.id, page);
      if (node.name === "Step") {
        const index = Number(node.attributes.SerializedIndex);
        if (node.attributes.SerializedIndex !== undefined && Number.isInteger(index) && index >= 0) page.steps.push(index);
      }
      if (fields.length) page.items.push({ ...item, ...(node.name === "Image" ? { imagePath: node.attributes.imagePath } : {}) });
      if ((node.name === "CallOut" && !supportedStudioCallout(node, nodes)) ||
          (node.name === "Arrow" && !supportedStudioArrow(node, nodes)) ||
          ["ContentItem", "BrickBuilderNotes", "SizeGuide", "ColorGuide"].includes(node.name)) {
        unsupportedCount++;
        unsupportedElementCounts.set(node.name, (unsupportedElementCounts.get(node.name) ?? 0) + 1);
      }
    }
    if (inGlobalStyle && fields.length) calloutStyles.push(item);
    if (inGlobalStyle) {
      const family = node.attributes.FontFamily ?? "";
      if (family && !supportedFontFamilies.has(family.toLowerCase()) &&
          !unsupportedDetails.includes(`Font: ${family}`)) unsupportedDetails.push(`Font: ${family}`);
      const fontStyle = node.attributes.FontStyle ?? "";
      const styleParts = fontStyle.toLowerCase().match(/[a-z]+/g) ?? [];
      const unknownStyle = styleParts.filter(part => !["normal", "regular", "plain", "bold", "italic"].includes(part));
      if (unknownStyle.length && !unsupportedDetails.includes(`Font style: ${fontStyle}`)) {
        unsupportedDetails.push(`Font style: ${fontStyle}`);
      }
    }
  }
  for (const [name, count] of unsupportedElementCounts) unsupportedDetails.push(`${name} × ${count}`);
  const knownTemplates = /^(?:\d+|One|Two|Three|Four|Five|Six)By(?:\d+|One|Two|Three|Four|Five|Six)$/i;
  for (const page of pages) {
    if (!knownTemplates.test(page.template) && !/^\d+x\d+$/i.test(page.template) &&
        !hasCustomRectTemplate(page.template) && !unsupportedDetails.includes(`Template: ${page.template}`)) {
      unsupportedDetails.push(`Template: ${page.template}`);
    }
  }
  return { pages, calloutStyles, unsupportedCount, unsupportedDetails };
}
