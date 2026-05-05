import { z } from "zod";
import type {
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

export const method = "session/set_config_option" as const;
export const ParamsSchema = z.object({
  sessionId: z.string(),
  agentMode: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: typedUnknown<SessionReasoningEffort>().optional(),
});
export const ResultSchema = z.object({
  sessionId: z.string(),
  ok: z.boolean(),
  state: ConfigStateSchema,
  options: z.array(typedUnknown<SessionConfigOption>()),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Update session config options.",
});
