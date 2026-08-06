import { z } from "zod";
import { requestDescriptor } from "../descriptor";
import { GitStatusSnapshotSchema } from "./git-status";

export const method = "project/git/commit" as const;

export const ParamsSchema = z.object({
  projectId: z.string(),
  cwd: z.string(),
  message: z.string(),
  paths: z.array(z.string()).min(1), // Must have at least one path
});

/**
 * Commit result flattens snapshot fields to the top level,
 * adding an optional `commitHash` on success.
 */
export const ResultSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  cwd: z.string(),
  message: z.string(),
  commitHash: z.string().optional(), // 7-40 character SHA
}).extend(GitStatusSnapshotSchema.shape);

export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;

export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Commit selected files with explicit paths.",
});
