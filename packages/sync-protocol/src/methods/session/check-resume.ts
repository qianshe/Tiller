import { z } from "zod";
import type { SessionResumeInfo } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/check_resume" as const;
export const ParamsSchema = z.object({ sessionId: z.string() });
export const ResultSchema = z.object({
  sessionId: z.string(),
  resume: typedUnknown<SessionResumeInfo>(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Check whether a session can be resumed.",
});
