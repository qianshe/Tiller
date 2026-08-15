import { z } from "zod";
import { notificationDescriptor } from "../descriptor";

export const method = "notification/cleared" as const;

export const ParamsSchema = z.object({
  clearedAt: z.string(),
});

export type Params = z.infer<typeof ParamsSchema>;

export const descriptor = notificationDescriptor({
  kind: "notification",
  method,
  paramsSchema: ParamsSchema,
  description: "Notify all connected Deck clients that Helm notifications were cleared.",
});
