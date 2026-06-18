import { z } from "zod";
import type { SessionHistoryReimportResult } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "debug/reimport_history" as const;
export const ParamsSchema = z.object({
  sessionId: z.string(),
  limit: z.number().optional(),
});
export const ResultSchema = typedUnknown<SessionHistoryReimportResult>();
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description:
    "Internal/debug-only history repair that clears Helm-local cached history and reloads ACP history.",
});
