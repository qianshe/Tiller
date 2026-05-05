import { z } from "zod";
import { notificationDescriptor } from "../descriptor";

export const method = "error/raised" as const;
export const ParamsSchema = z.object({
  sessionId: z.string().optional(),
  code: z.string().optional(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type Params = z.infer<typeof ParamsSchema>;
export const descriptor = notificationDescriptor({
  kind: "notification",
  method,
  paramsSchema: ParamsSchema,
  description: "Surface a non-request-scoped error from helm to deck.",
});
