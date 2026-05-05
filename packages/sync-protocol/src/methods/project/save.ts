import { z } from "zod";
import type { ProjectSummary } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "project/save" as const;
export const ParamsSchema = z.object({
  project: typedUnknown<ProjectSummary>(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Persist a project configuration.",
});
