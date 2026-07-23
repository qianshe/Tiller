import {
  CANONICAL_CONVERSATION_UPDATE_KINDS,
  COMPATIBILITY_CONVERSATION_UPDATE_KINDS,
  isCanonicalConversationUpdateKind,
  isCompatibilityConversationUpdateKind,
  type SessionRealtimeUpdate,
} from "./types.js";

type ContractMessage = { id: string; role: "user" | "assistant"; text: string };
type ContractToolCall = { id: string; title: string };
type ContractSummary = { id: string; status: "running" };

type ContractUpdate = SessionRealtimeUpdate<
  ContractMessage,
  ContractToolCall,
  ContractSummary,
  { id: string },
  { sequence: number }
>;

const realtimeUpdateContractSamples = [
  {
    kind: "agent_message",
    message: { id: "m-agent", role: "assistant", text: "hi" },
    streaming: true,
  },
  { kind: "tool_call", toolCall: { id: "tool-1", title: "Tool" } },
  { kind: "session_updated", session: { id: "s1", status: "running" } },
  {
    kind: "timeline_batch",
    batch: {
      replace: true,
      deliverySequence: 1,
      lastSequence: 1,
      entries: [{ id: "timeline-1" }],
    },
  },
  { kind: "live_state", snapshot: { sequence: 1 } },
] satisfies ContractUpdate[];

void realtimeUpdateContractSamples;

const canonicalConversationKinds = CANONICAL_CONVERSATION_UPDATE_KINDS satisfies readonly ["timeline_batch"];
const compatibilityConversationKinds = COMPATIBILITY_CONVERSATION_UPDATE_KINDS satisfies readonly [
  "agent_message",
  "tool_call",
];

const conversationUpdateKindChecks = [
  isCanonicalConversationUpdateKind("timeline_batch"),
  isCanonicalConversationUpdateKind("user_message"),
  isCompatibilityConversationUpdateKind("user_message"),
  isCompatibilityConversationUpdateKind("agent_message"),
  isCompatibilityConversationUpdateKind("timeline_batch"),
  isCompatibilityConversationUpdateKind("status_change"),
] as const;

void canonicalConversationKinds;
void compatibilityConversationKinds;
void conversationUpdateKindChecks;
