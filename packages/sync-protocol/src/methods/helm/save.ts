import { z } from "zod";
import type { HelmSummary } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "helm/save" as const;
export const ParamsSchema = z.object({
  helm: typedUnknown<HelmSummary>(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  helmId: z.string(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Persist a Helm endpoint configuration.",
});
