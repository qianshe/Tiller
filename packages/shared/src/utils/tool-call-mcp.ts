import type { AgentToolCall, AgentToolCallMcp, AgentToolCallMcpSource } from "../types";

const MCP_QUALIFIED_TOOL_NAME =
  /^(?:Tool:\s*)?(?<server>[A-Za-z0-9_-]+)\/(?<tool>[A-Za-z0-9][A-Za-z0-9_.-]*)(?::|\b|$)/u;
const CLAUDE_NAMESPACED_MCP_TOOL =
  /^mcp__(?<server>[A-Za-z0-9_-]+)__(?<tool>[A-Za-z0-9][A-Za-z0-9_.-]*)$/u;
const CLAUDE_TITLE_ONLY_MCP_TOOL =
  /^mcpServers_(?<tool>[A-Za-z0-9][A-Za-z0-9_.-]*)$/u;
const OPENCODE_TITLE_ONLY_MCP_TOOL =
  /^(?<server>mcp[-_][A-Za-z0-9-]+)_(?<tool>[A-Za-z0-9][A-Za-z0-9_.-]*)(?::|\b)/u;

export function formatAgentToolCallMcpName(mcp: Pick<AgentToolCallMcp, "serverName" | "toolName">) {
  return mcp.serverName ? `${mcp.serverName}/${mcp.toolName}` : mcp.toolName;
}

export function formatAgentToolCallMcpTitle(mcp: Pick<AgentToolCallMcp, "serverName" | "toolName">) {
  return `Tool: ${formatAgentToolCallMcpName(mcp)}`;
}

export function resolveStructuredToolName(input: unknown): string | undefined {
  const parsedInput = parseJsonRecord(input);
  if (!parsedInput) {
    return undefined;
  }

  const structuredMcp = resolveStructuredMcpTool(parsedInput);
  if (structuredMcp) {
    return formatAgentToolCallMcpName(structuredMcp);
  }

  const request = asRecord(parsedInput.request);
  const tool = firstString(
    parsedInput.tool,
    parsedInput.name,
    parsedInput.toolName,
    parsedInput.tool_name,
    request?.name,
    request?.tool,
    request?.toolName,
    request?.tool_name,
  );
  const server = firstString(
    parsedInput.server,
    parsedInput.server_name,
    parsedInput.serverName,
  );

  return tool ?? server ?? inferStructuredToolName(parsedInput);
}

export function resolveAgentToolCallMcp(options: {
  existing?: AgentToolCall["mcp"];
  input?: unknown;
  title?: string | null | undefined;
  rawTitle?: string | null | undefined;
  toolName?: string | null | undefined;
}): AgentToolCallMcp | undefined {
  const rawTitle = normalizeString(options.rawTitle) ?? normalizeString(options.title);
  const existing = normalizeExistingAgentToolCallMcp(options.existing, rawTitle);
  if (existing) {
    return existing;
  }

  const structuredMcp = resolveStructuredMcpTool(options.input);
  if (structuredMcp) {
    return attachRawTitle(structuredMcp, rawTitle);
  }

  const toolNameMcp = parseQualifiedToolName(normalizeString(options.toolName));
  if (toolNameMcp) {
    return attachRawTitle(
      createAgentToolCallMcp(toolNameMcp.serverName, toolNameMcp.toolName, "structured-tool-name"),
      rawTitle,
    );
  }

  const qualifiedTitleMcp = parseQualifiedToolName(normalizeString(options.title));
  if (qualifiedTitleMcp) {
    return createAgentToolCallMcp(
      qualifiedTitleMcp.serverName,
      qualifiedTitleMcp.toolName,
      "qualified-title",
    );
  }

  const providerTitleMcp = parseProviderTitleMcp(normalizeString(options.rawTitle) ?? normalizeString(options.title));
  if (providerTitleMcp) {
    return attachRawTitle(providerTitleMcp, rawTitle);
  }

  return undefined;
}

function resolveStructuredMcpTool(input: unknown): AgentToolCallMcp | undefined {
  const parsedInput = parseJsonRecord(input);
  if (!parsedInput) {
    return undefined;
  }

  const request = asRecord(parsedInput.request);
  const server = firstString(
    parsedInput.server,
    parsedInput.server_name,
    parsedInput.serverName,
  );
  const tool = firstString(
    parsedInput.tool,
    parsedInput.name,
    parsedInput.toolName,
    parsedInput.tool_name,
    request?.name,
    request?.tool,
    request?.toolName,
    request?.tool_name,
  );

  if (server && tool) {
    return createAgentToolCallMcp(server, tool, "structured-input");
  }

  if (tool?.includes("/")) {
    const qualifiedTool = parseQualifiedToolName(tool);
    if (qualifiedTool) {
      return createAgentToolCallMcp(
        qualifiedTool.serverName,
        qualifiedTool.toolName,
        "structured-tool-name",
      );
    }
  }

  const inferredToolName = inferStructuredToolName(parsedInput);
  if (!inferredToolName) {
    return undefined;
  }

  const qualifiedTool = parseQualifiedToolName(inferredToolName);
  if (!qualifiedTool) {
    return undefined;
  }

  return createAgentToolCallMcp(
    qualifiedTool.serverName,
    qualifiedTool.toolName,
    "structured-input",
  );
}

function inferStructuredToolName(record: Record<string, unknown>) {
  if (typeof record.code === "string" && ("timeout_ms" in record || "timeoutMs" in record)) {
    return "node_repl/js";
  }
  if (
    typeof record.project_root_path === "string" &&
    typeof record.message === "string" &&
    Array.isArray(record.predefined_options)
  ) {
    return "sanshu/zhi";
  }
  if (typeof record.project_path === "string" && typeof record.action === "string") {
    return "sanshu/ji";
  }
  return undefined;
}

function parseProviderTitleMcp(title: string | undefined) {
  if (!title) {
    return undefined;
  }

  const claudeNamespaced = title.match(CLAUDE_NAMESPACED_MCP_TOOL);
  if (claudeNamespaced?.groups?.server && claudeNamespaced.groups.tool) {
    return createAgentToolCallMcp(
      normalizeProviderTitleServerName(claudeNamespaced.groups.server),
      claudeNamespaced.groups.tool,
      "provider-title",
    );
  }

  const openCodeTitleOnly = title.match(OPENCODE_TITLE_ONLY_MCP_TOOL);
  if (openCodeTitleOnly?.groups?.server && openCodeTitleOnly.groups.tool) {
    return createAgentToolCallMcp(
      normalizeProviderTitleServerName(openCodeTitleOnly.groups.server),
      openCodeTitleOnly.groups.tool,
      "provider-title",
    );
  }

  const claudeTitleOnly = title.match(CLAUDE_TITLE_ONLY_MCP_TOOL);
  const toolName = claudeTitleOnly?.groups?.tool;
  if (!toolName) {
    return undefined;
  }

  return createAgentToolCallMcp(undefined, toolName, "provider-title");
}

function parseQualifiedToolName(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const match = value.match(MCP_QUALIFIED_TOOL_NAME);
  if (!match?.groups?.server || !match.groups.tool) {
    return undefined;
  }
  return {
    serverName: normalizeServerName(match.groups.server),
    toolName: normalizeToolName(match.groups.tool),
  };
}

function normalizeExistingAgentToolCallMcp(
  existing: AgentToolCall["mcp"] | undefined,
  rawTitle: string | undefined,
) {
  if (!existing?.toolName || !existing.source) {
    return undefined;
  }

  return attachRawTitle(
    createAgentToolCallMcp(existing.serverName, existing.toolName, existing.source),
    existing.rawTitle ?? rawTitle,
  );
}

function attachRawTitle(mcp: AgentToolCallMcp, rawTitle: string | undefined) {
  if (!shouldKeepRawTitle(rawTitle, mcp)) {
    return mcp;
  }
  return {
    ...mcp,
    rawTitle,
  };
}

function shouldKeepRawTitle(rawTitle: string | undefined, mcp: AgentToolCallMcp) {
  if (!rawTitle) {
    return false;
  }
  const normalizedRawTitle = rawTitle.trim();
  if (!normalizedRawTitle) {
    return false;
  }
  if (/^Tool call\b/u.test(normalizedRawTitle) || /^call[-_][A-Za-z0-9_-]+$/u.test(normalizedRawTitle)) {
    return false;
  }
  return (
    normalizedRawTitle !== formatAgentToolCallMcpTitle(mcp) &&
    normalizedRawTitle !== formatAgentToolCallMcpName(mcp)
  );
}

function createAgentToolCallMcp(
  serverName: string | undefined,
  toolName: string,
  source: AgentToolCallMcpSource,
): AgentToolCallMcp {
  return {
    ...(serverName ? { serverName: normalizeServerName(serverName) } : {}),
    toolName: normalizeToolName(toolName),
    source,
  };
}

function normalizeServerName(value: string) {
  return value.trim();
}

function normalizeProviderTitleServerName(value: string) {
  return normalizeServerName(value).replace(/-/gu, "_");
}

function normalizeToolName(value: string) {
  return value.trim();
}

function parseJsonRecord(input: unknown) {
  if (!input) {
    return null;
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed.startsWith("{")) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return asRecord(parsed);
    } catch {
      return null;
    }
  }
  return asRecord(input);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeString(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
