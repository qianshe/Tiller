import { z } from "zod";
import type { AgentPromptContent, SessionQueuedPrompt } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/update_queued_prompt" as const;
export const ParamsSchema = z.object({
  sessionId: z.string(),
  queueItemId: z.string(),
  text: z.string(),
  content: z.array(typedUnknown<AgentPromptContent>()).optional(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  queueItem: typedUnknown<SessionQueuedPrompt>(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Edit a prompt that is still waiting in a session prompt queue.",
});
