import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "project/git/graph" as const;

export const ParamsSchema = z.object({
  projectId: z.string(),
  cwd: z.string().optional(),
});

export const GitRefSchema = z.object({
  name: z.string(),
  kind: z.enum(["branch", "tag", "detached"]),
  isCurrent: z.boolean(),
});

export const GitCommitSchema = z.object({
  hash: z.string(), // Full or short commit hash
  parents: z.array(z.string()), // Parent commit hashes
  refs: z.array(GitRefSchema), // Refs pointing to this commit
  subject: z.string(), // First line of commit message
  authorName: z.string(),
  authoredAt: z.string(), // ISO-8601 date string
  body: z.string().optional(),
  changedFiles: z.number().optional(),
  insertions: z.number().optional(),
  deletions: z.number().optional(),
});

export const ResultSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  cwd: z.string(),
  head: z.string().optional(), // Current HEAD commit hash
  commits: z.array(GitCommitSchema),
  message: z.string(),
});

export type Params = z.infer<typeof ParamsSchema>;
export type GitRef = z.infer<typeof GitRefSchema>;
export type GitCommit = z.infer<typeof GitCommitSchema>;
export type Result = z.infer<typeof ResultSchema>;

export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Fetch commit graph data for a project.",
});
