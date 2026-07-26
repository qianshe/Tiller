import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "project/git/commit_detail" as const;

export const ParamsSchema = z.object({
  projectId: z.string(),
  cwd: z.string(),
  commitHash: z.string().regex(/^[0-9a-f]{7,64}$/iu),
});

export const GitCommitFileSchema = z.object({
  path: z.string(),
  originalPath: z.string().optional(),
  status: z.enum(["modified", "added", "deleted"]),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string().optional(),
});

export const ResultSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  cwd: z.string(),
  commitHash: z.string(),
  files: z.array(GitCommitFileSchema),
  message: z.string(),
});

export type Params = z.infer<typeof ParamsSchema>;
export type GitCommitFile = z.infer<typeof GitCommitFileSchema>;
export type Result = z.infer<typeof ResultSchema>;

export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Fetch file diffs for one Git commit.",
});
