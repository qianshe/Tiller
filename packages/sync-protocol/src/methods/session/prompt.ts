import { z } from "zod";
import type { AgentPromptContent } from "@tiller/shared";
import { StopReasonSchema, typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/prompt" as const;
export const ParamsSchema = z.object({
  sessionId: z.string(),
  text: z.string(),
  content: z.array(typedUnknown<AgentPromptContent>()).optional(),
  clientMessageId: z.string().optional(),
});
export const ResultSchema = z.object({ stopReason: StopReasonSchema });
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Send a user prompt and stream agent updates through session/update.",
});
