import { z } from "zod";
import type { SessionSummary } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/list" as const;
export const ParamsSchema = z.object({
  limit: z.number().optional(),
  before: z.string().optional(),
});
export const ResultSchema = z.object({
  sessions: z.array(typedUnknown<SessionSummary>()),
  nextCursor: z.string().optional(),
  hasMore: z.boolean().optional(),
  before: z.string().optional(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List recent sessions with cursor pagination.",
});
