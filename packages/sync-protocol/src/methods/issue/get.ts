import { z } from "zod";
import type { IssueDetail } from "@tiller/domain-contracts";
import { requestDescriptor } from "../descriptor";
import { IssueDetailSchema, IssueErrorSchema } from "./schemas";

export const method = "issue/get" as const;
export const ParamsSchema = z.object({
  projectId: z.string().min(1),
  issueNumber: z.string().regex(/^\d+$/u),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  issue: IssueDetailSchema.optional(),
  error: IssueErrorSchema.optional(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = {
  ok: boolean;
  projectId: string;
  issue?: IssueDetail;
  error?: z.infer<typeof IssueErrorSchema>;
  message: string;
};
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Get a GitHub Issue detail for a configured project.",
});
