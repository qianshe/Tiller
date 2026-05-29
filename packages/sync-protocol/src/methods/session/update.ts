import { z } from "zod";
import type { SessionStatus, SessionSummary } from "@tiller/domain-contracts";
import type {
  AcpModelOption,
  AgentMessage,
  AgentToolCall,
  AvailableCommand,
  CommandChunk,
  FileDiffSummary,
  PermissionDecision,
  PermissionRequest,
  SessionConfigOption,
  SessionPromptQueueSnapshot,
  SessionReasoningEffort,
} from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { notificationDescriptor } from "../descriptor";

const ConfigStateSchema = z.object({
  agentMode: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: typedUnknown<SessionReasoningEffort>().optional(),
});

export const SessionUpdateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent_message"),
    message: typedUnknown<AgentMessage>(),
    streaming: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("tool_call"), toolCall: typedUnknown<AgentToolCall>() }),
  z.object({ kind: z.literal("command_output"), commandId: z.string(), chunk: typedUnknown<CommandChunk>() }),
  z.object({ kind: z.literal("diff_update"), files: z.array(typedUnknown<FileDiffSummary>()) }),
  z.object({ kind: z.literal("status_change"), status: typedUnknown<SessionStatus>(), message: z.string().optional() }),
  z.object({ kind: z.literal("config_options"), state: ConfigStateSchema, options: z.array(typedUnknown<SessionConfigOption>()) }),
  z.object({ kind: z.literal("model_options"), currentModelId: z.string().optional(), options: z.array(typedUnknown<AcpModelOption>()) }),
  z.object({ kind: z.literal("commands_available"), commands: z.array(typedUnknown<AvailableCommand>()) }),
  z.object({ kind: z.literal("session_updated"), session: typedUnknown<SessionSummary>() }),
  z.object({ kind: z.literal("prompt_queue"), queue: typedUnknown<SessionPromptQueueSnapshot>() }),
  z.object({ kind: z.literal("user_message"), message: typedUnknown<AgentMessage>() }),
  z.object({ kind: z.literal("permission_request"), permissionRequest: typedUnknown<PermissionRequest>() }),
  z.object({ kind: z.literal("permission_resolved"), permissionRequestId: z.string(), decision: typedUnknown<PermissionDecision>() }),
  z.object({ kind: z.literal("restore_replay_cached"), count: z.number() }),
]);

export const method = "session/update" as const;
export const ParamsSchema = z.object({
  sessionId: z.string(),
  update: SessionUpdateSchema,
});
export type SessionUpdate = z.infer<typeof SessionUpdateSchema>;
export type Params = z.infer<typeof ParamsSchema>;
export const descriptor = notificationDescriptor({
  kind: "notification",
  method,
  paramsSchema: ParamsSchema,
  description: "Push session-scoped updates from helm to deck.",
});
