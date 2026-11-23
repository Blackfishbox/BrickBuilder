import type { ImportedModel } from "../formats/types";
import { refreshedCatalogModel } from "../catalog/refresh-model";
import type { Inventory } from "../inventory/types";
import { validateInventory } from "../inventory/accounting";
import type { InstructionPlan } from "../instructions/types";

export type BrickType = "brick-2x4" | "brick-2x2" | "brick-1x2";
export type ToolMode = "view" | "build" | "select" | "delete";

export interface Position3 {
  x: number;
  y: number;
  z: number;
}

export interface Brick {
  id: string;
  type: BrickType;
  color: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  tiltX?: number;
  tiltZ?: number;
}

export interface BuilderDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  bricks: Brick[];
  metadata: Record<string, unknown>;
  imported?: ImportedModel;
  inventory?: Inventory;
  instructions?: InstructionPlan;
}

export interface BrickDefinition {
  label: string;
  studsX: number;
  studsZ: number;
  ldrawId: string;
  brickLinkId?: string;
}

export interface PaletteColor {
  name: string;
  value: string;
}

export const BRICK_HEIGHT = 1.2;
export const GRID_STEP = 0.5;

export const BRICK_DEFINITIONS: Record<BrickType, BrickDefinition> = {
  "brick-2x4": { label: "Klassischer Stein", studsX: 2, studsZ: 4, ldrawId: "3001" },
  "brick-2x2": { label: "Quadratischer Stein", studsX: 2, studsZ: 2, ldrawId: "3003" },
  "brick-1x2": { label: "Schmaler Stein", studsX: 1, studsZ: 2, ldrawId: "3004" },
};

export const BRICK_PALETTE: PaletteColor[] = [
  { name: "Ziegelrot", value: "#d75b3f" },
  { name: "Sonnengelb", value: "#e4b844" },
  { name: "Moosgrün", value: "#668b6e" },
  { name: "Ozeanblau", value: "#597e91" },
  { name: "Kreide", value: "#e9e2d2" },
  { name: "Graphit", value: "#434b48" },
  { name: "Rosé", value: "#c9867e" },
  { name: "Flieder", value: "#9389a6" },
];

export function createEmptyDocument(name = "Neues Modell"): BuilderDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    bricks: [],
    metadata: {},
  };
}

export function snapPosition(position: Position3, type?: BrickType, rotation = 0): Position3 {
  const y = Math.max(0, Math.round(position.y / BRICK_HEIGHT) * BRICK_HEIGHT);
  const quarterTurn = Math.round(rotation / 90);
  const swapped = Math.abs(rotation - quarterTurn * 90) < 1e-6 && Math.abs(quarterTurn) % 2 === 1;
  const definition = type ? BRICK_DEFINITIONS[type] : undefined;
  const phaseX = y === 0 && definition
    ? ((swapped ? definition.studsZ : definition.studsX) % 2 === 0 ? 0.5 : 0)
    : 0;
  const phaseZ = y === 0 && definition
    ? ((swapped ? definition.studsX : definition.studsZ) % 2 === 0 ? 0.5 : 0)
    : 0;
  const snapHorizontal = (value: number, phase: number) => y === 0
    ? Math.round(value - phase) + phase
    : Math.round(value / GRID_STEP) * GRID_STEP;
  return {
    x: snapHorizontal(position.x, phaseX),
    y,
    z: snapHorizontal(position.z, phaseZ),
  };
}

export function rotateQuarterTurn(rotation: number): number {
  return ((rotation + 90) % 360 + 360) % 360;
}

export function clampRotationAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  return Math.max(0, Math.min(360, angle));
}

export function normalizeDocument(
  document: Partial<BuilderDocument> & Pick<BuilderDocument, "id" | "name">,
): BuilderDocument {
  const now = new Date().toISOString();
  validateInventory(document as BuilderDocument);
  if (document.imported) document = { ...document, imported: refreshedCatalogModel(document.imported) };
  return {
    schemaVersion: 1,
    id: document.id,
    name: document.name,
    createdAt: document.createdAt ?? now,
    updatedAt: document.updatedAt ?? now,
    bricks: Array.isArray(document.bricks) ? document.bricks : [],
    metadata:
      typeof document.metadata === "object" && document.metadata !== null
        ? document.metadata
        : {},
    ...(document.imported ? { imported: document.imported } : {}),
    ...(document.inventory ? { inventory: document.inventory } : {}),
    ...(document.instructions ? { instructions: document.instructions } : {}),
  };
}
