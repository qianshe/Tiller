import { z } from "zod";
import type { SessionPromptQueueSnapshot } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/delete_queued_prompt" as const;
export const ParamsSchema = z.object({
  sessionId: z.string(),
  queueItemId: z.string(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  queue: typedUnknown<SessionPromptQueueSnapshot>(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Delete a prompt that is still waiting in a session prompt queue.",
});
