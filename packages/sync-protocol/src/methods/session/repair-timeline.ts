import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "session/repair_timeline" as const;
export const ParamsSchema = z.object({
  sessionId: z.string(),
  apply: z.boolean().optional(),
});
export const ResultSchema = z.object({
  sessionId: z.string(),
  repairable: z.boolean(),
  applied: z.boolean(),
  updateCount: z.number(),
  beforeEntryCount: z.number(),
  afterEntryCount: z.number(),
  changedEntryCount: z.number(),
  reason: z.enum(["no_journal", "unsafe_gap", "session_active"]).optional(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Dry-run or apply a safe canonical timeline suffix repair.",
});
