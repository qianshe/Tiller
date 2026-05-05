import type { AgentToolCall } from "@tiller/shared";

type ToolCallTone = { className: string; icon: string };

const TOOL_CALL_TONES: Record<string, ToolCallTone> = {
  MCP: { className: "tool-call-mcp", icon: "◇" },
  Shell: { className: "tool-call-shell", icon: "⌁" },
  File: { className: "tool-call-file", icon: "□" },
  Skill: { className: "tool-call-skill", icon: "✦" },
  Subagent: { className: "tool-call-subagent", icon: "◎" },
  "Built-in": { className: "tool-call-builtin", icon: "▵" },
  Tool: { className: "tool-call-generic", icon: "·" },
};

const KNOWN_MCP_ROUTER_TOOLS = [
  "activate_project",
  "check_onboarding_performed",
  "list_dir",
  "find_file",
  "read_file",
  "read_memory",
  "write_memory",
  "search_context",
  "search_for_pattern",
  "find_symbol",
  "find_referencing_symbols",
  "get_symbols_overview",
  "edit_file",
  "replace_content",
  "replace_symbol_body",
  "insert_before_symbol",
  "insert_after_symbol",
  "rename_symbol",
  "safe_delete_symbol",
  "tavily_",
  "resolve_library_id",
  "get_library_docs",
  "ask_question",
  "read_wiki_",
  "zhi",
  "ji",
  "tu",
];

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
  if (
    kind === "subagent" ||
    /\b(subagent|delegate|explore|librarian|worker|oracle|metis|momus)\b/iu.test(
      title,
    )
  ) {
    return "Subagent";
  }
  if (
    /\b(skill|execute_skill|load_skill)\b|[\\/](skills?|plugins)[\\/].*skill\.md|skill\.md/iu.test(
      title,
    )
  ) {
    return "Skill";
  }
  if (
    /(^|[\s:/_-])mcp([\s:/_-]|$)|mcp_router|mcp-router|mcp__[a-z0-9_-]+/iu.test(
      title,
    ) ||
    isKnownMcpRouterTool(normalized)
  ) {
    return "MCP";
  }
  if (kind === "terminal") {
    return "Shell";
  }
  if (kind === "edit") {
    return "File";
  }
  if (isBuiltInTool(normalized)) {
    return "Built-in";
  }
  return "Tool";
}

function isBuiltInTool(normalizedTitle: string) {
  return BUILT_IN_TOOL_KEYWORDS.some((keyword) =>
    normalizedTitle.includes(keyword),
  );
}

function isKnownMcpRouterTool(normalizedTitle: string) {
  return KNOWN_MCP_ROUTER_TOOLS.some(
    (toolName) =>
      normalizedTitle === toolName || normalizedTitle.startsWith(toolName),
  );
}
