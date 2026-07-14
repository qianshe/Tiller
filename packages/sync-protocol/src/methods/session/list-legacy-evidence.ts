import { z } from "zod";
import type { LegacyEvidencePage } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/list_legacy_evidence" as const;

export const ParamsSchema = z.object({
  sessionId: z.string(),
  source: z.enum(["message", "tool_call", "output"]),
  limit: z.number().optional(),
  after: z.string().optional(),
});

export const ResultSchema = z.object({
  sessionId: z.string(),
  source: z.enum(["message", "tool_call", "output"]),
  items: z.array(typedUnknown<LegacyEvidencePage["items"][number]>()),
  issues: z.array(typedUnknown<LegacyEvidencePage["issues"][number]>()),
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
  description: "Page untrusted legacy session entities by source-local storage position.",
});
