import { z } from "zod";
import { requestDescriptor } from "../descriptor";
import { NotificationSchema } from "./raised";

export const method = "notification/list" as const;
export const ParamsSchema = z.object({
  limit: z.number().int().positive().max(200).optional(),
});
export const ResultSchema = z.object({
  notifications: z.array(NotificationSchema),
  clearedAt: z.string().optional(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List recent actionable Helm notifications.",
});
