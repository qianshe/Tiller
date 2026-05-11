import { z } from "zod";
import type { PermissionRequest } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "permission/list_pending" as const;
export const ParamsSchema = z.object({});
export const ResultSchema = z.object({
  permissions: z.array(z.object({
    sessionId: z.string(),
    request: typedUnknown<PermissionRequest>(),
  })),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List active pending permission requests held by Helm.",
});
