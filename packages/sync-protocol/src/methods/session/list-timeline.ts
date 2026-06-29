import { z } from "zod";
import type { SessionTimelineEntry } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/list_timeline" as const;
export const ParamsSchema = z.object({
  sessionId: z.string(),
  limit: z.number().optional(),
  before: z.string().optional(),
});
export const ResultSchema = z.object({
  sessionId: z.string(),
  entries: z.array(typedUnknown<SessionTimelineEntry>()),
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Page canonical session timeline entries.",
});
