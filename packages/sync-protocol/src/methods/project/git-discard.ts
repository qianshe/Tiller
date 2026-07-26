import { z } from "zod";
import { requestDescriptor } from "../descriptor";
import { GitOperationEnvelopeSchema, GitStatusSnapshotSchema } from "./git-status";

export const method = "project/git/discard" as const;

export const ParamsSchema = z.object({
  projectId: z.string(),
  cwd: z.string(),
  paths: z.array(z.string().min(1)).min(1).optional(),
  all: z.literal(true).optional(),
}).superRefine((value, context) => {
  const hasPaths = Boolean(value.paths?.length);
  const discardAll = value.all === true;
  if (hasPaths === discardAll) {
    context.addIssue({
      code: "custom",
      message: "Provide either paths or all=true",
    });
  }
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
  description: "Discard selected or all Git worktree changes.",
});
