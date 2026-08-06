import { z } from "zod";
import type { CanonicalApproval } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "approval/clear_history" as const;
export const ParamsSchema = z.object({});
export const ResultSchema = z.object({
  ok: z.boolean(),
  removed: z.number().int().nonnegative(),
  approvals: z.array(typedUnknown<CanonicalApproval>()),
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Delete resolved and expired approval history while preserving active requests.",
});
