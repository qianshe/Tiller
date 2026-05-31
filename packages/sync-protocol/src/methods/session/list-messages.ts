import { z } from "zod";
import type { AgentMessage, SessionTimelineEntry } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/list_messages" as const;
export const ParamsSchema = z.object({
  sessionId: z.string(),
  limit: z.number().optional(),
  before: z.string().optional(),
  timelineBefore: z.string().optional(),
});
export const ResultSchema = z.object({
  sessionId: z.string(),
  messages: z.array(typedUnknown<AgentMessage>()),
  timeline: z.array(typedUnknown<SessionTimelineEntry>()).optional(),
  nextCursor: z.string().optional(),
  hasMore: z.boolean().optional(),
  before: z.string().optional(),
  timelineNextCursor: z.string().optional(),
  timelineHasMore: z.boolean().optional(),
  timelineBefore: z.string().optional(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Page session messages.",
});
