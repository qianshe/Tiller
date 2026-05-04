import type { AgentToolCall } from "@tiller/shared";

export function resolveToolCallTone(
  kind: AgentToolCall["kind"],
  title: string,
) {
  const label = resolveToolCallLabel(kind, title);
  const toneByLabel: Record<string, { className: string; icon: string }> = {
    MCP: { className: "tool-call-mcp", icon: "◇" },
    Shell: { className: "tool-call-shell", icon: "⌁" },
    File: { className: "tool-call-file", icon: "□" },
    Skill: { className: "tool-call-skill", icon: "✦" },
    Subagent: { className: "tool-call-subagent", icon: "◎" },
    "Built-in": { className: "tool-call-builtin", icon: "▵" },
    Tool: { className: "tool-call-generic", icon: "·" },
  };
  return { label, ...(toneByLabel[label] ?? toneByLabel.Tool) };
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
  if (
    /\b(apply_patch|update_plan|todos?|background_output|read_thread_terminal|shell_command|webfetch)\b|websearch|web_search/iu.test(
      normalized,
    )
  ) {
    return "Built-in";
  }
  return "Tool";
}

function isKnownMcpRouterTool(normalizedTitle: string) {
  const knownMcpRouterTools = [
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

  return new RegExp(`^(${knownMcpRouterTools.join("|")})(\\b|$)`, "u").test(
    normalizedTitle,
  );
}
