import { z } from "zod";
import type { PermissionDecision } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "permission/respond" as const;
export const ParamsSchema = z.object({
  permissionRequestId: z.string(),
  decision: typedUnknown<PermissionDecision>(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  permissionRequestId: z.string(),
  decision: typedUnknown<PermissionDecision>(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Respond to a session permission request.",
});
