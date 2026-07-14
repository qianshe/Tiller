import { z } from "zod";
import type { SessionSummary } from "@tiller/domain-contracts";
import type {
  AgentMessage,
  AgentToolCall,
} from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { notificationDescriptor } from "../descriptor";

export const SessionUpdateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent_message"),
    message: typedUnknown<AgentMessage>(),
    streaming: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("tool_call"), toolCall: typedUnknown<AgentToolCall>() }),
  z.object({ kind: z.literal("session_updated"), session: typedUnknown<SessionSummary>() }),
  z.object({ kind: z.literal("timeline_batch"), batch: typedUnknown<import("@tiller/shared").SessionTimelineBatch>() }),
  z.object({ kind: z.literal("live_state"), snapshot: z.unknown() }),
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
