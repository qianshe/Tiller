import { z } from "zod";
import type { IssueSummary } from "@tiller/domain-contracts";
import { requestDescriptor } from "../descriptor";
import { IssueErrorSchema, IssueSummarySchema } from "./schemas";

export const method = "issue/list" as const;
export const ParamsSchema = z.object({
  projectId: z.string().min(1),
  state: z.enum(["open", "closed", "all"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().regex(/^\d+$/u).optional(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  issues: z.array(IssueSummarySchema),
  nextCursor: z.string().optional(),
  error: IssueErrorSchema.optional(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = {
  ok: boolean;
  projectId: string;
  issues: IssueSummary[];
  nextCursor?: string;
  error?: z.infer<typeof IssueErrorSchema>;
  message: string;
};
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List GitHub Issues for a configured project.",
});
