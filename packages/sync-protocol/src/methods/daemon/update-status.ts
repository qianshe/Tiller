import { z } from "zod";
import { notificationDescriptor } from "../descriptor";

export const method = "daemon/update/status" as const;
export const ParamsSchema = z.object({
  status: z.enum(["checking", "available", "installing", "restarting", "up-to-date", "failed", "unsupported"]),
  currentVersion: z.string(),
  canUpdate: z.boolean(),
  latestVersion: z.string().optional(),
  targetVersion: z.string().optional(),
  checkStatus: z.enum(["checked", "failed", "disabled", "unsupported"]).optional(),
  cannotUpdateReason: z.string().optional(),
  manualCommand: z.string().optional(),
  checkedAt: z.string().optional(),
  message: z.string().optional(),
  occurredAt: z.string(),
}).strict();

export type Params = z.infer<typeof ParamsSchema>;

export const descriptor = notificationDescriptor({
  kind: "notification",
  method,
  paramsSchema: ParamsSchema,
  description: "Report Helm update progress to connected Deck clients.",
});
