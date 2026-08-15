import { z } from "zod";
import { notificationDescriptor } from "../descriptor";

export const method = "notification/raised" as const;

export const NotificationSchema = z.object({
  id: z.string(),
  kind: z.enum(["error", "warning", "info"]),
  source: z.string().trim().min(1),
  sessionId: z.string().optional(),
  code: z.string().optional(),
  message: z.string(),
  occurredAt: z.string(),
  details: z.record(z.string(), z.string()).optional(),
});

export const ParamsSchema = NotificationSchema.extend({
  id: z.string().optional(),
  occurredAt: z.string().optional(),
});

export type Params = z.infer<typeof ParamsSchema>;

export const descriptor = notificationDescriptor({
  kind: "notification",
  method,
  paramsSchema: ParamsSchema,
  description: "Surface an actionable backend notification from helm to deck.",
});
