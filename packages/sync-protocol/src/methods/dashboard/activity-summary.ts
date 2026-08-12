import { ResultSchema, type Result } from "../session/activity-summary";
import { notificationDescriptor } from "../descriptor";

export const method = "dashboard/activity_summary" as const;
export const ParamsSchema = ResultSchema;
export type Params = Result;

export const descriptor = notificationDescriptor({
  kind: "notification",
  method,
  paramsSchema: ParamsSchema,
  description: "Push refreshed dashboard activity metrics from helm to deck.",
});
