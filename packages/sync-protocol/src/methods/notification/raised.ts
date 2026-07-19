import { z } from "zod";
import { notificationDescriptor } from "../descriptor";

export const method = "notification/raised" as const;

export const ParamsSchema = z.object({
  kind: z.enum(["error", "warning", "info"]),
  source: z.string().trim().min(1),
  sessionId: z.string().optional(),
  code: z.string().optional(),
  message: z.string(),
  occurredAt: z.string().optional(),
});

export type Params = z.infer<typeof ParamsSchema>;

export const descriptor = notificationDescriptor({
  kind: "notification",
  method,
  paramsSchema: ParamsSchema,
  description: "Surface an actionable backend notification from helm to deck.",
});
