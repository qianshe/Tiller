import { z } from "zod";
import type { SessionResumeInfo } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/resume" as const;
export const ParamsSchema = z.object({ sessionId: z.string() });
export const ResultSchema = z.object({
  sessionId: z.string(),
  ok: z.boolean(),
  resume: typedUnknown<SessionResumeInfo>(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Resume a session and rebuild its runtime.",
});
