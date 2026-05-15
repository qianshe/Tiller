import { z } from "zod";
import type { PermissionDecision } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "approval/respond" as const;
export const ParamsSchema = z.object({
  approvalRequestId: z.string(),
  decision: typedUnknown<PermissionDecision>(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  approvalRequestId: z.string(),
  decision: typedUnknown<PermissionDecision>(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Resolve a pending approval via the approval domain.",
});
