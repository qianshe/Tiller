import { z } from "zod";
import type { ConversationPreparation } from "@tiller/domain-contracts";
import type { SessionReasoningEffort } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "conversation/save" as const;
const optionalText = z.string().trim().min(1).nullable().optional();
export const ParamsSchema = z.object({
  id: z.string().optional(),
  content: z.string().trim().min(1).optional(),
  title: optionalText,
  projectId: optionalText,
  cwd: optionalText,
  agentId: optionalText,
  agentMode: optionalText,
  model: optionalText,
  reasoningEffort: typedUnknown<SessionReasoningEffort>().nullable().optional(),
  revision: z.number().int().nonnegative().optional(),
});
export const ResultSchema = z.object({ preparation: typedUnknown<ConversationPreparation>() });
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Create or update a conversation preparation.",
});
