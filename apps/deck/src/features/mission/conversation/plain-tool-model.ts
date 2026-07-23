import type { AgentToolCall } from "@tiller/shared";
import type { TillerIconName } from "../../../shared/ui";

export function resolveToolCallIconName(label: string): TillerIconName {
  if (label === "Read" || label === "Write" || label === "File") return "fileText";
  if (label === "Diagnostics") return "activity";
  if (label === "Search") return "search";
  if (label === "Shell") return "terminal";
  if (label === "Fetch") return "globe";
  if (label === "MCP") return "server";
  if (label === "Skill") return "sparkle";
  if (label === "Todo") return "check";
  if (label === "Subagent") return "message";
  if (label === "Built-in") return "panel";
  if (label === "Think") return "activity";
  return "inspect";
}

export function isActiveToolStatus(status: AgentToolCall["status"]) {
  return status === "pending" || status === "running" || status === "waiting_for_permission";
}

export function resolveToolStatusLabel(
  status: AgentToolCall["status"],
  output?: string | null,
) {
  if (status === "completed") {
    return "完成";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "waiting_for_permission") {
    return "等待授权";
  }
  if (status === "cancelled") {
    return "已取消";
  }
  // pending, running
  return "运行中";
}

export function formatToolInputPreview(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}
