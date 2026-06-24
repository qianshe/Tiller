import { z } from "zod";
import { requestDescriptor } from "../descriptor";
import { GitStatusFileSchema } from "./git-status";

export const method = "project/git/commit" as const;

export const ParamsSchema = z.object({
  projectId: z.string(),
  cwd: z.string(),
  message: z.string(),
  paths: z.array(z.string()).min(1), // Must have at least one path
});

export const ResultSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  cwd: z.string(),
  commitHash: z.string().optional(), // 7-40 character SHA
  status: z.object({
    branch: z.string(),
    clean: z.boolean(),
    files: z.array(GitStatusFileSchema),
  }),
  message: z.string(),
});

export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;

export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Commit selected files with explicit paths.",
});
