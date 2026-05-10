import { z } from "zod";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "agent/connections" as const;
export const ParamsSchema = z.object({});
export const ResultSchema = z.object({
  connections: z.array(typedUnknown()),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List currently managed ACP provider connections.",
});
