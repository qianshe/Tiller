import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "session/acknowledge_completion" as const;
export const ParamsSchema = z.object({
  sessionId: z.string(),
  completedAt: z.string(),
});
export const ResultSchema = z.object({ ok: z.boolean() });
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Acknowledge that a session completion was opened on a device.",
});
