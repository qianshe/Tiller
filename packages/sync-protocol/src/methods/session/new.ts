import { z } from "zod";
import type { SessionReasoningEffort, SessionSummary } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/new" as const;
export const ParamsSchema = z.object({
  projectId: z.string(),
  workspaceId: z.string(),
  agentId: z.string(),
  agentMode: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: typedUnknown<SessionReasoningEffort>().optional(),
});
export const ResultSchema = z.object({ session: typedUnknown<SessionSummary>() });
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Create a new session and start its ACP runtime.",
});
