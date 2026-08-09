import type {
  SessionActivitySummary,
  SessionActivityTrendPoint,
} from "@tiller/shared";
import { EmptyParamsSchema, typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";
import { z } from "zod";

export const method = "session/activity_summary" as const;
export const ParamsSchema = EmptyParamsSchema;
export const ResultSchema = z.object({
  generatedAt: z.string(),
  promptCount: z.number().int().nonnegative(),
  recentToolCallCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  activityTrend: z.array(typedUnknown<SessionActivityTrendPoint>()),
  activityTrendHourly: z.array(typedUnknown<SessionActivityTrendPoint>()),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = SessionActivitySummary;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Summarize persisted session activity for dashboard metrics.",
});
