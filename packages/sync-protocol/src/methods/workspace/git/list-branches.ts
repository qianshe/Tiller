import { z } from "zod";
import type { WorkspaceSummary } from "@tiller/shared";
import { typedUnknown } from "../../../schemas";
import { requestDescriptor } from "../../descriptor";

export const method = "workspace/git/list_branches" as const;
export const ParamsSchema = z.object({ projectId: z.string() });
export const ResultSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  currentBranch: z.string().optional(),
  branches: z.array(z.string()),
  workspaces: z.array(typedUnknown<WorkspaceSummary>()),
  selectedWorkspaceId: z.string().optional(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List git branches for a project root.",
});
