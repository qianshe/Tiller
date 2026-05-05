import { z } from "zod";
import { ResultSchema as ListBranchesResultSchema } from "./list-branches";
import { requestDescriptor } from "../../descriptor";

export const method = "workspace/git/create_branch" as const;
export const ParamsSchema = z.object({
  projectId: z.string(),
  branchName: z.string(),
});
export const ResultSchema = ListBranchesResultSchema;
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Create a git branch and re-publish the branch list.",
});
