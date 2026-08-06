import { z } from "zod";
import type { CanonicalApproval, PermissionDecision } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { notificationDescriptor } from "../descriptor";

export const method = "approval/resolved" as const;
export const ParamsSchema = z.object({
  sessionId: z.string(),
  approvalRequestId: z.string(),
  decision: typedUnknown<PermissionDecision>(),
  approval: typedUnknown<CanonicalApproval>().optional(),
});
export type Params = z.infer<typeof ParamsSchema>;
export const descriptor = notificationDescriptor({
  kind: "notification",
  method,
  paramsSchema: ParamsSchema,
  description: "Broadcast that a pending approval was resolved (allowed or denied).",
});
