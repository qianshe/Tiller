import { z } from "zod";
import type { WorktreeSummary } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "project/list_worktrees" as const;
export const ParamsSchema = z.object({
  projectId: z.string(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  worktrees: z.array(typedUnknown<WorktreeSummary>()),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List Git worktrees for a project.",
});
