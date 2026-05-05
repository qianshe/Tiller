import { z } from "zod";
import type { HelmSummary } from "@tiller/shared";
import { EmptyParamsSchema, typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "helm/list" as const;
export const ParamsSchema = EmptyParamsSchema;
export const ResultSchema = z.object({
  helms: z.array(typedUnknown<HelmSummary>()),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List configured Helm endpoints.",
});
