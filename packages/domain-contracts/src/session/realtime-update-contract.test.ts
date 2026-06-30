import type { SessionRealtimeUpdate } from "./types";

type ContractMessage = { id: string; role: "user" | "assistant"; text: string };
type ContractToolCall = { id: string; title: string };
type ContractCommandOutput = { id: string; text: string };
type ContractDiff = { path: string };
type ContractConfigState = { agentMode?: string; model?: string; reasoningEffort?: string };
type ContractConfigOption = { id: string; value?: string };
type ContractModelOption = { id: string; label: string };
type ContractCommand = { id: string; label: string };
type ContractSummary = { id: string; status: "running" };
type ContractQueue = { items: string[] };
type ContractPlan = { entries: Array<{ content: string; status: "pending" | "in_progress" | "completed" }> };
type ContractTranscriptEntry = {
  kind: "context_compaction";
  id: string;
  timestamp: string;
  updatedAt: string;
  replayCompleteness: "compacted";
};

type ContractUpdate = SessionRealtimeUpdate<
  ContractMessage,
  ContractToolCall,
  ContractCommandOutput,
  ContractDiff,
  ContractConfigState,
  ContractConfigOption,
  ContractModelOption,
  ContractCommand,
  ContractSummary,
  ContractQueue,
  ContractPlan,
  ContractTranscriptEntry
>;

const realtimeUpdateContractSamples = [
  { kind: "status_change", status: "running" },
  { kind: "user_message", message: { id: "m-user", role: "user", text: "hello" } },
  {
    kind: "agent_message",
    message: { id: "m-agent", role: "assistant", text: "hi" },
    streaming: true,
  },
  { kind: "tool_call", toolCall: { id: "tool-1", title: "Tool" } },
  { kind: "command_output", commandId: "cmd-1", chunk: { id: "chunk-1", text: "output" } },
  { kind: "diff_update", files: [{ path: "src/index.ts" }] },
  {
    kind: "config_options",
    state: { agentMode: "build", model: "model-a", reasoningEffort: "medium" },
    options: [{ id: "model", value: "model-a" }],
  },
  {
    kind: "model_options",
    currentModelId: "model-a",
    options: [{ id: "model-a", label: "Model A" }],
  },
  { kind: "commands_available", commands: [{ id: "test", label: "Run tests" }] },
  { kind: "session_updated", session: { id: "s1", status: "running" } },
  { kind: "prompt_queue", queue: { items: ["q1"] } },
  {
    kind: "compaction_state",
    phase: "started",
    source: "provider",
    timestamp: "2026-06-28T00:00:00.000Z",
  },
  { kind: "plan_update", plan: { entries: [{ content: "Wire ACP plan", status: "in_progress" }] } },
  {
    kind: "transcript_event",
    entry: {
      kind: "context_compaction",
      id: "compaction-1",
      timestamp: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
      replayCompleteness: "compacted",
    },
  },
] satisfies ContractUpdate[];

void realtimeUpdateContractSamples;
