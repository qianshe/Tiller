import { z } from "zod";
import type { WorktreeSummary } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "project/git/create_worktree" as const;
export const ParamsSchema = z.object({
  projectId: z.string(),
  branchName: z.string(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  branches: z.array(z.string()),
  currentBranch: z.string().optional(),
  worktrees: z.array(typedUnknown<WorktreeSummary>()).default([]),
  selectedCwd: z.string().optional(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Create a Git worktree for a project branch.",
});
