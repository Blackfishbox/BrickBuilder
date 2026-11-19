import { z } from "zod";

export const instructionCalloutSchema = z.object({
  id: z.string().min(1).max(512),
  title: z.string().min(1).max(160),
  occurrence: z.array(z.number().int().nonnegative()).min(1).max(48),
});

export const instructionStepSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().max(160),
  notes: z.string().max(2000),
  partIds: z.array(z.string().min(1).max(160)).max(10000),
  callouts: z.array(instructionCalloutSchema).max(100).optional(),
  rotation: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
  sourceIndex: z.number().int().nonnegative().optional(),
});

export const instructionPlanSchema = z.object({
  version: z.literal(1),
  edited: z.boolean(),
  source: z.enum(["ldraw", "studio", "manual"]),
  steps: z.array(instructionStepSchema).min(1).max(10000),
  warnings: z.array(z.string().max(1000)).max(100),
  studioLayout: z.object({
    sourceXml: z.string().max(8 * 1024 * 1024),
    edits: z.array(z.object({
      nodeId: z.number().int().nonnegative(),
      attribute: z.string().min(1).max(80),
      value: z.string().max(200),
    })).max(10000),
  }).optional(),
});

export type InstructionStep = z.infer<typeof instructionStepSchema>;
export type InstructionCallout = z.infer<typeof instructionCalloutSchema>;
export type InstructionPlan = z.infer<typeof instructionPlanSchema>;
export type StudioLayout = NonNullable<InstructionPlan["studioLayout"]>;
