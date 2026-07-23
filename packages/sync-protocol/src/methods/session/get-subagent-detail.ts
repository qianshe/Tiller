import { z } from "zod";
import type { SessionSubagentDetail } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/get_subagent_detail" as const;
export const ParamsSchema = z.object({
  sessionId: z.string().min(1),
  parentToolCallId: z.string().min(1),
});
export const ResultSchema = typedUnknown<SessionSubagentDetail>();
export type Params = z.infer<typeof ParamsSchema>;
export type Result = SessionSubagentDetail;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Read the persisted detail for one root subagent tool call.",
});
