import { z } from "zod";
import type { AcpAgentProvider } from "@tiller/shared";
import { EmptyParamsSchema, typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "agent/list" as const;
export const ParamsSchema = EmptyParamsSchema;
export const ResultSchema = z.object({
  agents: z.array(typedUnknown<AcpAgentProvider>()),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List configured ACP providers.",
});
