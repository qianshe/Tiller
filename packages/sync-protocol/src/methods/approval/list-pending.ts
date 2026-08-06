import { z } from "zod";
import type { PermissionRequest } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "approval/list_pending" as const;
export const ParamsSchema = z.object({});
export const ResultSchema = z.object({
  approvals: z.array(z.object({
    sessionId: z.string(),
    request: typedUnknown<PermissionRequest>(),
    status: z.enum(["pending", "resolving"]).optional(),
    createdAt: z.string().optional(),
  })),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List every pending approval held by Helm across all sessions.",
});
