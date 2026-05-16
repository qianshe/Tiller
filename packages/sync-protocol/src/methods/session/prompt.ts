import { z } from "zod";
import type { AgentPromptContent, SessionQueuedPrompt, SessionSummary } from "@tiller/shared";
import { StopReasonSchema, typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/prompt" as const;
export const ParamsSchema = z
  .object({
    sessionId: z.string().optional(),
    draftId: z.string().optional(),
    text: z.string(),
    content: z.array(typedUnknown<AgentPromptContent>()).optional(),
    clientMessageId: z.string().optional(),
  })
  .refine((value) => Boolean(value.sessionId) !== Boolean(value.draftId), {
    message: "Exactly one of sessionId or draftId is required.",
    path: ["sessionId"],
  });
export const ResultSchema = z.object({
  accepted: z.enum(["sent", "queued"]),
  stopReason: StopReasonSchema.optional(),
  queueItem: typedUnknown<SessionQueuedPrompt>().optional(),
  session: typedUnknown<SessionSummary>().optional(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Send a user prompt and stream agent updates through session/update.",
});
