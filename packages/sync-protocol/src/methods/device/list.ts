import { z } from "zod";
import type { TrustedDeviceSummary } from "@tiller/shared";
import { EmptyParamsSchema, typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "device/list" as const;
export const ParamsSchema = EmptyParamsSchema;
export const ResultSchema = z.object({
  devices: z.array(typedUnknown<TrustedDeviceSummary>()),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List trusted Beacon devices.",
});
