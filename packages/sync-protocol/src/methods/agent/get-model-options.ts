import { z } from "zod";
import type {
  AcpModelOption,
  SessionConfigOption,
  SessionReasoningEffort,
} from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const ConfigStateSchema = z.object({
  agentMode: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: typedUnknown<SessionReasoningEffort>().optional(),
});

export const method = "agent/get_model_options" as const;
export const ParamsSchema = z.object({
  providerId: z.string(),
  workspaceId: z.string(),
  projectId: z.string().optional(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  providerId: z.string(),
  workspaceId: z.string(),
  message: z.string(),
  currentModelId: z.string().optional(),
  modelOptions: z.array(typedUnknown<AcpModelOption>()),
  configOptions: z.array(typedUnknown<SessionConfigOption>()),
  state: ConfigStateSchema,
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Probe an ACP provider for model and config options.",
});
