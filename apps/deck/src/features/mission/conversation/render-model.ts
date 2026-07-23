import type { AgentToolCall, SessionTimelineEntry } from "@tiller/shared";

export type ConversationRenderItem =
  | { kind: "message"; id: string; text: string; role: "user" | "assistant" | "system" }
  | { kind: "thinking"; id: string; text: string; title: string; status: AgentToolCall["status"] }
  | { kind: "tool-group"; id: string; toolCalls: AgentToolCall[] }
  | { kind: "subagent"; id: string; toolCall: AgentToolCall }
  | { kind: "context-compaction"; id: string; summaryText?: string }
  | { kind: "history-gap"; id: string };

export function buildConversationRenderItems(entries: SessionTimelineEntry[]): ConversationRenderItem[] {
  const items: ConversationRenderItem[] = [];
  let pendingToolGroup: AgentToolCall[] = [];

  for (const entry of entries) {
    switch (entry.kind) {
      case "user_message":
      case "system_message":
        flushToolGroup(items, pendingToolGroup);
        pendingToolGroup = [];
        items.push({
          kind: "message",
          id: entry.id,
          text: entry.message.text,
          role: entry.message.role,
        });
        break;
      case "assistant_message": {
        flushToolGroup(items, pendingToolGroup);
        pendingToolGroup = [];
        for (const chunk of entry.chunks) {
          if (chunk.kind === "content") {
            items.push({
              kind: "message",
              id: `${entry.id}:${chunk.id}`,
              text: chunk.text,
              role: "assistant",
            });
          } else if (chunk.kind === "thinking") {
            items.push({
              kind: "thinking",
              id: chunk.id,
              text: chunk.text,
              title: chunk.title,
              status: chunk.status,
            });
          }
        }
        break;
      }
      case "tool_call": {
        if (entry.toolCall.kind === "subagent") {
          flushToolGroup(items, pendingToolGroup);
          pendingToolGroup = [];
          items.push({
            kind: "subagent",
            id: entry.id,
            toolCall: entry.toolCall,
          });
        } else {
          pendingToolGroup.push(entry.toolCall);
        }
        break;
      }
      case "context_compaction":
        flushToolGroup(items, pendingToolGroup);
        pendingToolGroup = [];
        items.push({
          kind: "context-compaction",
          id: entry.id,
          summaryText: entry.summaryText,
        });
        break;
      case "history_gap":
        flushToolGroup(items, pendingToolGroup);
        pendingToolGroup = [];
        items.push({ kind: "history-gap", id: entry.id });
        break;
    }
  }

  flushToolGroup(items, pendingToolGroup);
  return items;
}

function flushToolGroup(items: ConversationRenderItem[], toolCalls: AgentToolCall[]) {
  if (toolCalls.length === 0) return;
  items.push({
    kind: "tool-group",
    id: `tool-group:${toolCalls[0]?.id}`,
    toolCalls: [...toolCalls],
  });
}
