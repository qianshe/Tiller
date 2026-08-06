import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "project/git/status" as const;

export const ParamsSchema = z.object({
  projectId: z.string(),
  cwd: z.string().optional(),
  refreshRemote: z.boolean().optional(),
});

export const GitStatusFileSchema = z.object({
  path: z.string(),
  indexStatus: z.string(), // M/A/D/R/C/?
  worktreeStatus: z.string(), // M/A/D/R/C/?
  originalPath: z.string().optional(), // for renames
  additions: z.number().optional(),
  deletions: z.number().optional(),
  patch: z.string().optional(),
});

/**
 * Shared Git status snapshot reused by status / commit / push / pull results.
 * All fields live at the top level so inventory reducers can share one helper
 * without unwrapping a nested `status` object.
 */
export const GitStatusSnapshotSchema = z.object({
  branch: z.string(),
  detached: z.boolean(),
  upstreamBranch: z.string().optional(), // full `remote/branch`
  ahead: z.number(),
  behind: z.number(),
  pushTarget: z.string().optional(), // `<remote>/<branch>` or undefined
  trackingStale: z.boolean(),
  remoteRefreshError: z.string().optional(),
  clean: z.boolean(),
  files: z.array(GitStatusFileSchema),
});

export const GitOperationEnvelopeSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  cwd: z.string(),
  message: z.string(),
});

export const ResultSchema = GitOperationEnvelopeSchema.extend(
  GitStatusSnapshotSchema.shape,
);

export type Params = z.infer<typeof ParamsSchema>;
export type GitStatusFile = z.infer<typeof GitStatusFileSchema>;
export type GitStatusSnapshot = z.infer<typeof GitStatusSnapshotSchema>;
export type Result = z.infer<typeof ResultSchema>;

export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Get Git status for a project worktree.",
});
