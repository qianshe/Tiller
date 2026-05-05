import { z } from "zod";
import type { ProjectFileSummary } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "project/list_files" as const;
export const ParamsSchema = z.object({
  projectId: z.string(),
  workspaceId: z.string().optional(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  workspaceId: z.string().optional(),
  files: z.array(typedUnknown<ProjectFileSummary>()),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List files for a project workspace.",
});
