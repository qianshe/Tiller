import { z } from "zod";
import type { SessionCleanupResult } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/cleanup" as const;
export const ParamsSchema = z.object({ sessionId: z.string() });
export const ResultSchema = z.object({ result: typedUnknown<SessionCleanupResult>() });
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Cleanup runtime resources for a session.",
});
