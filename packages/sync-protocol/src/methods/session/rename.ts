import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "session/rename" as const;
export const ParamsSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
});
export const ResultSchema = z.object({ ok: z.boolean() });
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Rename a session summary title.",
});
