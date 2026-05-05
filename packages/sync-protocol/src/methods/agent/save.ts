import { z } from "zod";
import type { AcpAgentProvider } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "agent/save" as const;
export const ParamsSchema = z.object({
  provider: typedUnknown<
    Pick<
      AcpAgentProvider,
      | "id"
      | "name"
      | "kind"
      | "command"
      | "args"
      | "env"
      | "cwd"
      | "installHint"
      | "initializeTimeoutMs"
      | "defaultAgent"
    >
  >(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  providerId: z.string(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Persist an ACP provider configuration.",
});
