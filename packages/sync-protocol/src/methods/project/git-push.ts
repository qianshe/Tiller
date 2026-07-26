import { z } from "zod";
import { requestDescriptor } from "../descriptor";
import { GitStatusSnapshotSchema } from "./git-status";

export const method = "project/git/push" as const;

export const ParamsSchema = z.object({
  projectId: z.string(),
  cwd: z.string(),
});

export const ResultSchema = GitStatusSnapshotSchema.extend({
  ok: z.boolean(),
  projectId: z.string(),
  cwd: z.string(),
  message: z.string(),
});

export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;

export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Push the current branch to its remote (or publish to origin).",
});
