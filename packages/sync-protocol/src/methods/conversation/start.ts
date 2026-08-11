import { z } from "zod";
import type { ConversationPreparation, SessionSummary } from "@tiller/domain-contracts";
import type { SessionReasoningEffort } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "conversation/start" as const;
const optionalText = z.string().trim().min(1).nullable().optional();
export const ParamsSchema = z.object({
  preparationId: z.string().optional(),
  revision: z.number().int().nonnegative().optional(),
  content: z.string().trim().min(1).optional(),
  title: optionalText,
  projectId: optionalText,
  cwd: optionalText,
  agentId: optionalText,
  agentMode: optionalText,
  model: optionalText,
  reasoningEffort: typedUnknown<SessionReasoningEffort>().nullable().optional(),
});
export const ResultSchema = z.object({
  session: typedUnknown<SessionSummary>(),
  preparationId: z.string().optional(),
  titleUpdateFailed: z.string().optional(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Start a real session from a conversation preparation or complete input.",
});
