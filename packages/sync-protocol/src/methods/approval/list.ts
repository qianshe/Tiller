import { z } from "zod";
import type { CanonicalApproval } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "approval/list" as const;
export const ParamsSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  before: z.string().optional(),
});
export const ResultSchema = z.object({
  approvals: z.array(typedUnknown<CanonicalApproval>()),
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List persisted approval lifecycle records from newest to oldest.",
});
