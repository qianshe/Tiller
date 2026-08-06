import type { AgentToolCall, AgentToolCallMcp } from "@tiller/shared";

export type ToolEvidenceSource =
  | "acp-explicit"
  | "provider-structured"
  | "generic-structured"
  | "provider-output"
  | "text-heuristic";

export type ToolEvidenceStrength = 100 | 200 | 300 | 400 | 500;

export type SubagentAction = "spawn" | "message" | "wait" | "status" | "cancel" | "result";

export type ToolEvidence = {
  source: ToolEvidenceSource;
  strength: ToolEvidenceStrength;
  kind?: AgentToolCall["kind"];
  title?: string;
  status?: AgentToolCall["status"];
  mcp?: AgentToolCallMcp;
  subagentRole?: AgentToolCall["subagentRole"];
  commandId?: string;
  input?: string;
  output?: string;
  stream?: AgentToolCall["stream"];
  subagentOperation?: AgentToolCall["subagentOperation"];
  suppress?: boolean;
  subagent?: {
    action: SubagentAction;
    batch: boolean;
    entityIds: string[];
    background: boolean;
    terminal: boolean;
    terminalStatus?: Extract<AgentToolCall["status"], "completed" | "failed" | "cancelled">;
    /** Keep the provider notification visible as its own tool while also
     * applying this evidence to an already tracked subagent entity. */
    lifecycleOnly?: boolean;
    /** Do not create an orphan subagent when the launch was not observed. */
    existingOnly?: boolean;
  };
};

export type ToolObservation = {
  providerId?: string;
  sessionId?: string;
  cwd?: string;
  toolCall: AgentToolCall;
  update: unknown;
  toolName?: string;
  namespace?: string;
  descriptor: string;
  input: unknown;
  output: unknown;
  inputText?: string;
  outputText?: string;
};

export type ToolRecognitionResult = {
  toolCalls: AgentToolCall[];
};
