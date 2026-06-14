import { z } from "zod";
import type { SessionUpdateRecord } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/list_updates" as const;

export const ParamsSchema = z.object({
  sessionId: z.string(),
  limit: z.number().int().min(1).max(200).optional(),
  before: z.string().optional(),
});

export const ResultSchema = z.object({
  ok: z.boolean(),
  sessionId: z.string(),
  updates: z.array(typedUnknown<SessionUpdateRecord>()),
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
  message: z.string().optional(),
});

export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;

export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Query raw session update records for debugging and audit.",
});
