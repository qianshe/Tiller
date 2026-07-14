import type { AgentToolCall } from "@tiller/shared";

type ToolCallTone = { className: string; icon: string };

const TOOL_CALL_TONES: Record<string, ToolCallTone> = {
  MCP: { className: "tool-call-mcp", icon: "◇" },
  Shell: { className: "tool-call-shell", icon: "⌁" },
  Read: { className: "tool-call-read", icon: "◫" },
  Diagnostics: { className: "tool-call-read", icon: "!" },
  Write: { className: "tool-call-write", icon: "✎" },
  Search: { className: "tool-call-mcp", icon: "⌕" },
  Fetch: { className: "tool-call-mcp", icon: "↧" },
  Think: { className: "tool-call-builtin", icon: "◌" },
  Todo: { className: "tool-call-builtin", icon: "☑" },
  File: { className: "tool-call-file", icon: "◫" },
  Skill: { className: "tool-call-skill", icon: "✦" },
  Subagent: { className: "tool-call-subagent", icon: "◎" },
  "Built-in": { className: "tool-call-builtin", icon: "▵" },
  Tool: { className: "tool-call-generic", icon: "·" },
};

const KIND_LABELS: Record<AgentToolCall["kind"], keyof typeof TOOL_CALL_TONES> = {
  mcp: "MCP",
  skill: "Skill",
  read: "Read",
  diagnostics: "Diagnostics",
  write: "Write",
  search: "Search",
  shell: "Shell",
  fetch: "Fetch",
  think: "Think",
  todo: "Todo",
  subagent: "Subagent",
  tool: "Tool",
  unknown: "Tool",
};

const BUILT_IN_TOOL_KEYWORDS = [
  "apply_patch",
  "update_plan",
  "todo",
  "todos",
  "background_output",
  "read_thread_terminal",
  "shell_command",
  "webfetch",
  "websearch",
  "web_search",
];

export function resolveToolCallTone(
  kind: AgentToolCall["kind"],
  title: string,
) {
  const label = resolveToolCallLabel(kind, title);
  return { label, ...(TOOL_CALL_TONES[label] ?? TOOL_CALL_TONES.Tool) };
}

function resolveToolCallLabel(kind: AgentToolCall["kind"], title: string) {
  const normalized = title.toLowerCase();
  if (kind === "subagent") {
    return "Subagent";
  }
  if (kind === "read" && /^diagnostics(?:\s*:|\s+|$)/iu.test(title.trim())) {
    return "Diagnostics";
  }
  const labelFromKind = KIND_LABELS[kind];
  if (labelFromKind && labelFromKind !== "Tool") {
    return labelFromKind;
  }
  if (
    /\b(skill|execute_skill|load_skill)\b|[\\/](skills?|plugins)[\\/].*skill\.md|skill\.md/iu.test(
      title,
    )
  ) {
    return "Skill";
  }
  if (
    /(^|[\s:/_-])mcp([\s:/_-]|$)|mcp__[a-z0-9_-]+/iu.test(
      title,
    ) || isNamespacedMcpToolTitle(normalized)
  ) {
    return "MCP";
  }
  if (isShellLikeToolTitle(kind, normalized)) {
    return "Shell";
  }
  if (isBuiltInTool(normalized)) {
    return "Built-in";
  }
  return "Tool";
}

function isNamespacedMcpToolTitle(normalizedTitle: string) {
  return /^(?:tool:\s*)?[a-z0-9_-]+\/[a-z0-9_-]+$/u.test(
    normalizedTitle.trim(),
  );
}

function isShellLikeToolTitle(kind: AgentToolCall["kind"], normalizedTitle: string) {
  if (kind !== "tool" && kind !== "unknown") {
    return false;
  }
  return /^(\$|if\s*\(|for(each)?\s*\(|while\s*\(|write-output\b|get-[a-z]+\b|set-[a-z]+\b|test-path\b|new-item\b|remove-item\b|copy-item\b|move-item\b|git\b|pnpm\b|npm\b|node\b|tsx\b|python\b|powershell\b|bash\b|cmd\b|echo\b|cat\b|ls\b|dir\b)/iu.test(
    normalizedTitle.trim(),
  );
}

function isBuiltInTool(normalizedTitle: string) {
  return BUILT_IN_TOOL_KEYWORDS.some((keyword) =>
    normalizedTitle.includes(keyword),
  );
}
