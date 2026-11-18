import { z } from "zod";

export const instructionStepSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().max(160),
  notes: z.string().max(2000),
  partIds: z.array(z.string().min(1).max(160)).max(10000),
  rotation: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
  sourceIndex: z.number().int().nonnegative().optional(),
});

export const instructionPlanSchema = z.object({
  version: z.literal(1),
  edited: z.boolean(),
  source: z.enum(["ldraw", "studio", "manual"]),
  steps: z.array(instructionStepSchema).min(1).max(10000),
  warnings: z.array(z.string().max(1000)).max(100),
});

export type InstructionStep = z.infer<typeof instructionStepSchema>;
export type InstructionPlan = z.infer<typeof instructionPlanSchema>;
