import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { StudioLayout } from "./types";

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
  kind: "number" | "vector2" | "vector4" | "boolean" | "color";
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

/** Only fields observed in source fixtures are editable; no guessed native objects. */
function fieldsFor(node: StudioNode, nodes: StudioNode[]): StudioLayoutField[] {
  const parent = node.parent === undefined ? undefined : nodes[node.parent];
  let fields: StudioLayoutField[] = [];
  if (node.name === "Page" && parent?.name === "Pages") fields = [f("IsLocked", "Seite sperren", "boolean")];
  if (node.name === "Step" && parent?.name === "Slot") fields = [f("RectOffset", "Schrittversatz (Studio-Werte)", "vector4")];
  if (node.name === "Image" && parent?.name === "Slot") fields = [
    f("rect", "Position X / Y und Breite / Höhe (Studio-Werte)", "vector4"),
    f("rotation", "Drehung (Grad)", "number"), f("opacity", "Deckkraft (0–1)", "number"),
    f("fliped_H", "Horizontal spiegeln", "boolean"), f("fliped_V", "Vertikal spiegeln", "boolean"),
  ];
  if (parent?.name === "CallOut" && nodes[parent.parent ?? -1]?.name === "GlobalStyle") {
    if (node.name === "Colors") fields = [
      f("IsUseBgColor", "Hintergrund verwenden", "boolean"), f("BgColor", "Hintergrund RGBA (0–1)", "color"),
      f("IsUseBorder", "Rahmen verwenden", "boolean"), f("BorderColor", "Rahmen RGBA (0–1)", "color"),
      f("BorderThickness", "Rahmenstärke", "number"), f("BorderRadius", "Eckenradius", "number"),
    ];
    if (node.name === "ArrowStyle") fields = [f("Thickness", "Pfeilstärke", "number"), f("Color", "Pfeil RGBA (0–1)", "color")];
    if (node.name === "Divider") fields = [f("IsVisible", "Trennlinie sichtbar", "boolean"), f("DividerThickness", "Linienstärke", "number"), f("DividerColor", "Linie RGBA (0–1)", "color")];
    if (node.name === "Padding") fields = [f("LRBT", "Innenabstand links / rechts / unten / oben", "vector4")];
    if (node.name === "Margin") fields = [f("Horizontal", "Horizontaler Abstand", "number"), f("Vertical", "Vertikaler Abstand", "number")];
  }
  return fields.filter(field => Object.hasOwn(node.attributes, field.attribute));
}

function checkValue(field: StudioLayoutField, value: string) {
  if (field.kind === "boolean") return value === "True" || value === "False";
  const tokens = value.trim().split(field.kind === "color" ? ":" : /\s+/);
  if (!tokens.every(token => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token))) return false;
  const values = tokens.map(Number);
  const count = field.kind === "vector4" || field.kind === "color" ? 4 : field.kind === "vector2" ? 2 : 1;
  if (!value.trim() || values.length !== count || !values.every(n => Number.isFinite(n) && Math.abs(n) <= 1e6)) return false;
  if (field.kind === "color" || field.attribute === "opacity") return values.every(n => n >= 0 && n <= 1);
  if (/Thickness|Radius/.test(field.attribute)) return values[0] >= 0;
  if (field.attribute === "rect") return values[2] > 0 && values[3] > 0;
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
      return value === undefined ? original : `${name}${equals}${quote}${value}${quote}`;
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
  for (const node of nodes) {
    const parent = node.parent === undefined ? undefined : nodes[node.parent];
    const fields = fieldsFor(node, nodes);
    const item = { nodeId: node.id, label: node.name, fields, attributes: node.attributes };
    if (node.name === "Page" && parent?.name === "Pages") {
      const page = { nodeId: node.id, template: node.attributes.template ?? "Unbekannt", steps: [], items: [item] };
      pages.push(page); pageByNode.set(node.id, page);
    }
    const page = parent && (pageByNode.get(parent.id) ?? (parent.parent === undefined ? undefined : pageByNode.get(parent.parent)));
    if (page && node.name !== "Page") {
      pageByNode.set(node.id, page);
      if (node.name === "Step") {
        const index = Number(node.attributes.SerializedIndex);
        if (node.attributes.SerializedIndex !== undefined && Number.isInteger(index) && index >= 0) page.steps.push(index);
      }
      if (fields.length) page.items.push({ ...item, ...(node.name === "Image" ? { imagePath: node.attributes.imagePath } : {}) });
      if (["CallOut", "Arrow", "ContentItem"].includes(node.name)) unsupportedCount++;
    }
    if (parent?.name === "CallOut" && fields.length) calloutStyles.push(item);
  }
  return { pages, calloutStyles, unsupportedCount };
}
