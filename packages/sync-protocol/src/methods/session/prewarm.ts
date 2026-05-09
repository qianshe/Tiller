import { z } from "zod";
import type {
  AcpModelOption,
  SessionConfigOption,
  SessionReasoningEffort,
} from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/prewarm" as const;
export const ParamsSchema = z.object({
  projectId: z.string(),
  workspaceId: z.string(),
  agentId: z.string(),
  agentMode: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: typedUnknown<SessionReasoningEffort>().optional(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  warmed: z.boolean(),
  providerId: z.string(),
  workspaceId: z.string(),
  runtimeSessionId: z.string().optional(),
  currentModelId: z.string().optional(),
  modelOptions: z.array(typedUnknown<AcpModelOption>()).default([]),
  configOptions: z.array(typedUnknown<SessionConfigOption>()).default([]),
  state: z.object({
    agentMode: z.string().optional(),
    model: z.string().optional(),
    reasoningEffort: typedUnknown<SessionReasoningEffort>().optional(),
  }).default({}),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Prewarm a selected ACP runtime before creating a session.",
});
