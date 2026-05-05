import { z } from "zod";
import type {
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
} from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/get_artifacts" as const;
export const ParamsSchema = z.object({
  sessionId: z.string(),
  limit: z.number().optional(),
  before: z.string().optional(),
});
export const ResultSchema = z.object({
  sessionId: z.string(),
  outputs: z.array(typedUnknown<CommandChunk>()),
  diffs: z.array(typedUnknown<FileDiffSummary>()),
  toolCalls: z.array(typedUnknown<AgentToolCall>()),
  nextCursor: z.string().optional(),
  hasMore: z.boolean().optional(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Page command outputs, diffs, and tool calls for a session.",
});
