import { z } from "zod";
import { notificationDescriptor } from "../descriptor";

export const method = "session/cancel" as const;
export const ParamsSchema = z.object({ sessionId: z.string() });
export type Params = z.infer<typeof ParamsSchema>;
export const descriptor = notificationDescriptor({
  kind: "notification",
  method,
  paramsSchema: ParamsSchema,
  description: "Cancel the active prompt turn for a session.",
});
