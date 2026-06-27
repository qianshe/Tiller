import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "project/git/status" as const;

export const ParamsSchema = z.object({
  projectId: z.string(),
  cwd: z.string().optional(),
});

export const GitStatusFileSchema = z.object({
  path: z.string(),
  indexStatus: z.string(), // M/A/D/R/C/?
  worktreeStatus: z.string(), // M/A/D/R/C/?
  originalPath: z.string().optional(), // for renames
});

export const ResultSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  cwd: z.string(),
  branch: z.string(),
  clean: z.boolean(),
  files: z.array(GitStatusFileSchema),
  message: z.string(),
});

export type Params = z.infer<typeof ParamsSchema>;
export type GitStatusFile = z.infer<typeof GitStatusFileSchema>;
export type Result = z.infer<typeof ResultSchema>;

export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Get Git status for a project worktree.",
});
