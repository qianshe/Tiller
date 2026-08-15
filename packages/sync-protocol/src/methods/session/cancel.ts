import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "session/cancel" as const;
export const ParamsSchema = z.object({ sessionId: z.string() });
export const ResultSchema = z.object({
  sessionId: z.string(),
  ok: z.boolean(),
  status: z.enum([
    "starting",
    "running",
    "waiting_for_permission",
    "idle",
    "error",
    "cancelled",
  ]),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Cancel the active prompt turn for a session and report the resulting status.",
});
