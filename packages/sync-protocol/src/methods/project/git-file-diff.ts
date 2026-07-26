import { z } from "zod";
import { requestDescriptor } from "../descriptor";
import { GitOperationEnvelopeSchema } from "./git-status";

export const method = "project/git/file_diff" as const;

// On-demand patch fetch: status snapshots only carry per-file stats, and the
// patch bodies are requested in batches when the UI actually needs them.
export const ParamsSchema = z.object({
  projectId: z.string(),
  cwd: z.string(),
  paths: z.array(z.string().min(1)).min(1),
});

export const GitFileDiffSchema = z.object({
  path: z.string(),
  originalPath: z.string().optional(),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().optional(),
  // True when the body was skipped (binary/oversized); stats still apply.
  patchTruncated: z.boolean().optional(),
});

export const ResultSchema = GitOperationEnvelopeSchema.extend({
  files: z.array(GitFileDiffSchema),
});

export type Params = z.infer<typeof ParamsSchema>;
export type GitFileDiff = z.infer<typeof GitFileDiffSchema>;
export type Result = z.infer<typeof ResultSchema>;

export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Fetch patch bodies for selected Git worktree files.",
});
