import { z } from "zod";
import { requestDescriptor } from "../descriptor";
import { GitOperationEnvelopeSchema, GitStatusSnapshotSchema } from "./git-status";

export const method = "project/git/discard" as const;

export const ParamsSchema = z.object({
  projectId: z.string(),
  cwd: z.string(),
  paths: z.array(z.string().min(1)).min(1),
});

export const ResultSchema = GitOperationEnvelopeSchema.extend(
  GitStatusSnapshotSchema.shape,
);

export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;

export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Discard selected Git worktree changes.",
});
