import { z } from "zod";
import { EmptyParamsSchema, OkMessageSchema } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "daemon/shutdown" as const;
export const ParamsSchema = EmptyParamsSchema;
export const ResultSchema = OkMessageSchema;
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Request a graceful Helm shutdown.",
});
