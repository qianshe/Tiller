import { z } from "zod";
import type { PermissionRequest, SessionSummary } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { notificationDescriptor } from "../descriptor";

export const method = "approval/created" as const;
export const ParamsSchema = z.object({
  sessionId: z.string(),
  request: typedUnknown<PermissionRequest>(),
  session: typedUnknown<SessionSummary | null>().optional(),
});
export type Params = z.infer<typeof ParamsSchema>;
export const descriptor = notificationDescriptor({
  kind: "notification",
  method,
  paramsSchema: ParamsSchema,
  description: "Broadcast that a new pending approval entered Helm's inventory.",
});
