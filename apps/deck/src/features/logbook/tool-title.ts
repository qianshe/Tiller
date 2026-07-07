import {
  formatAgentToolCallMcpName,
  resolveAgentToolCallMcp,
  type AgentToolCall,
} from "@tiller/shared";

export function resolveDisplayToolKind(call: AgentToolCall): AgentToolCall["kind"] {
  if (call.kind === "shell" && isStructuredSearchInput(parseToolCallInputObject(call.input))) {
    return "search";
  }
  return call.kind;
}

export function resolveDisplayToolTitle(call: AgentToolCall, fallback: string) {
  const displayKind = resolveDisplayToolKind(call);

  // Codex reports SKILL.md reads as a generic `tool` kind with the shell command
  // stuffed into title/input — so always probe for a skill name first.
  const skillNameFromCommand = extractSkillNameFromCommandSources(call);
  if (skillNameFromCommand) {
    return `Skill: ${skillNameFromCommand}`;
  }

  if (displayKind !== "shell") {
    const openCodeSkillName = extractOpenCodeSkillNameFromToolOutput(
      call.output,
    );
    if (openCodeSkillName) {
      return `Skill: ${openCodeSkillName}`;
    }
  }

  if (displayKind === "shell") {
    return summarizeCommand(call.input ?? call.title ?? fallback);
  }

  const mcp = resolveAgentToolCallMcp({
    existing: call.mcp,
    input: call.input,
    title: call.title,
  });
  if (mcp) {
    return formatAgentToolCallMcpName(mcp);
  }

  const title = isInformativeToolTitle(call.title, call.id) ? call.title : fallback;
  if (isNamespacedToolTitle(title)) {
    return stripToolPrefix(title);
  }
  if (displayKind === "read" || displayKind === "write") {
    return extractFilePathFromStructuredInput(parseToolCallInputObject(call.input)) ?? stripLeadingActionVerb(title, displayKind);
  }
  if (displayKind === "search") {
    return summarizeSearchInput(title, parseToolCallInputObject(call.input)) ?? title;
  }
  return title;
}

function extractSkillNameFromCommandSources(call: AgentToolCall) {
  // Anthropic tool_use shape: input is `{skill: "<name>"}` with no path/command,
  // so the structured probe runs before the shell-command fallbacks.
  const parsedInput = parseToolCallInputObject(call.input);
  const skillNameFromInput = extractSkillNameFromStructuredInput(parsedInput);
  if (skillNameFromInput) {
    return skillNameFromInput;
  }

  const inputCommand = parsedInput
    ? extractCommandFromParsedInput(parsedInput)
    : call.input;
  const candidates = [inputCommand, call.title].filter(
    (value): value is string => Boolean(value),
  );

  for (const candidate of candidates) {
    const skillName = extractSkillNameFromCommand(candidate);
    if (skillName) {
      return skillName;
    }
  }

  return undefined;
}

function parseToolCallInputObject(
  input: string | undefined,
): Record<string, unknown> | null {
  if (!input) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  return parsed as Record<string, unknown>;
}

function extractSkillNameFromStructuredInput(
  parsed: Record<string, unknown> | null,
) {
  if (!parsed) {
    return undefined;
  }

  const candidate = parsed.skill ?? parsed.skill_name ?? parsed.skillName;
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    // Skip values that are themselves paths or commands — those belong to the path-based fallback.
    if (trimmed && !/[\\/]/u.test(trimmed)) {
      return trimmed;
    }
  }

  return undefined;
}

function extractFilePathFromStructuredInput(
  parsed: Record<string, unknown> | null,
) {
  if (!parsed) {
    return undefined;
  }
  const candidate =
    parsed.file_path ??
    parsed.filePath ??
    parsed.path ??
    parsed.relative_path ??
    parsed.relativePath ??
    parsed.notebook_path ??
    parsed.notebookPath;
  return typeof candidate === "string" && candidate.trim() ? compactDisplayPath(candidate.trim()) : undefined;
}

function summarizeSearchInput(
  title: string,
  parsed: Record<string, unknown> | null,
) {
  const query = extractStructuredSearchQuery(parsed);
  if (!query) {
    return undefined;
  }
  const normalizedTitle = stripToolPrefix(title).trim();
  if (searchTitleAlreadyContainsQuery(normalizedTitle, query)) {
    return normalizedTitle;
  }
  const prefix = isInformativeSearchTitle(normalizedTitle) ? normalizedTitle : "Search";
  return `${prefix}: ${truncateInline(query, 56)}`;
}

function extractStructuredSearchQuery(
  parsed: Record<string, unknown> | null,
) {
  if (!parsed) {
    return undefined;
  }
  const query =
    parsed.pattern ??
    parsed.query ??
    parsed.search_string ??
    parsed.searchString ??
    parsed.substring_pattern ??
    parsed.substringPattern;
  return typeof query === "string" && query.trim() ? query.trim() : undefined;
}

function isStructuredSearchInput(
  parsed: Record<string, unknown> | null,
) {
  if (!parsed || !extractStructuredSearchQuery(parsed)) {
    return false;
  }

  if (extractCommandFromParsedInput(parsed) !== undefined) {
    return false;
  }
  return true;
}

function isInformativeSearchTitle(title: string) {
  return Boolean(
    title &&
    !/^Tool call\b/u.test(title) &&
    !/^(shell|tool|unknown)$/iu.test(title),
  );
}

function searchTitleAlreadyContainsQuery(title: string, query: string) {
  const normalizedTitle = title.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  return normalizedTitle.includes(normalizedQuery) ||
    normalizedTitle.includes(`\`${normalizedQuery}\``);
}

function compactDisplayPath(path: string) {
  const normalized = path.replace(/\\/gu, "/");
  const markerMatch = normalized.match(/(?:^|\/)((?:apps|packages|docs|scripts)\/.*)$/u);
  if (markerMatch?.[1]) {
    return markerMatch[1];
  }
  return normalized;
}

function truncateInline(value: string, maxLength: number) {
  const compact = value.replace(/\s+/gu, " ");
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

export function resolveMergedToolTitle(
  currentTitle: string,
  incomingTitle: string,
  id: string,
) {
  return isInformativeToolTitle(incomingTitle, id) && !isFallbackToolTitle(incomingTitle)
    ? incomingTitle
    : currentTitle || incomingTitle || id;
}

function isInformativeToolTitle(title: string | undefined, id: string) {
  const normalized = title?.trim();
  return Boolean(
    normalized && normalized !== id && !/^call_[A-Za-z0-9]+$/u.test(normalized),
  );
}

function isFallbackToolTitle(title: string | undefined) {
  return /^Tool call\b/u.test(title?.trim() ?? "");
}

function stripToolPrefix(title: string) {
  return title.replace(/^Tool:\s*/iu, "").trim() || title;
}

function isNamespacedToolTitle(title: string) {
  return /^Tool:\s*[a-z0-9_-]+\/[a-z0-9_-]+(?:\b|$)/iu.test(title.trim());
}

function stripLeadingActionVerb(title: string, kind: "read" | "write") {
  const verb = kind === "read" ? "Read" : "Write";
  return title.replace(new RegExp(`^${verb}\\s+`, "iu"), "").trim() || title;
}

function summarizeCommand(input: string) {
  const command = extractCommandFromInput(input).replace(/\s+/g, " ").trim();
  if (!command) {
    return "Shell command";
  }

  const skillName = extractSkillNameFromCommand(command);
  if (skillName) {
    return `Skill: ${skillName}`;
  }

  return command.length > 72 ? `${command.slice(0, 72)}…` : command;
}

function extractSkillNameFromCommand(command: string) {
  const normalized = command.replace(/\\/gu, "/");
  const pluginSkill = normalized.match(
    /\/plugins\/cache\/[^/]+\/([^/]+)\/[^/]+\/skills\/([^/]+)\/skill\.md/iu,
  );
  if (pluginSkill?.[1] && pluginSkill[2]) {
    return `${pluginSkill[1]}:${pluginSkill[2]}`;
  }

  const systemSkill = normalized.match(
    /\/skills\/\.system\/([^/]+)\/skill\.md/iu,
  );
  if (systemSkill?.[1]) {
    return systemSkill[1];
  }

  const localSkill = normalized.match(/\/skills\/([^/]+)\/skill\.md/iu);
  if (localSkill?.[1]) {
    return localSkill[1];
  }

  return undefined;
}

function extractOpenCodeSkillNameFromToolOutput(output: string | undefined) {
  if (!output) {
    return undefined;
  }

  const decoded = extractOutputPayload(output).replace(/\\n/gu, "\n");
  const match = decoded.match(
    /^#+\s*Skill[:\s]\s*([^\r\n"]+)|^Skill:\s*([^\r\n"]+)/imu,
  );
  const skillName = (match?.[1] ?? match?.[2])?.trim();
  if (skillName) {
    return skillName;
  }

  const slashCommandHeading = decoded.match(
    /^#+\s*\/([A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?)\s+Command\b/imu,
  );
  const slashCommandSkillName = slashCommandHeading?.[1]?.trim();
  if (slashCommandSkillName) {
    return slashCommandSkillName;
  }

  // Codex `Get-Content -Raw '...\SKILL.md'` returns the file body whose YAML
  // frontmatter starts with `name: <skill>`. Recognise that pattern as a
  // last-ditch hint when the tool name itself does not carry a path.
  const frontmatter = decoded.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/u);
  const frontmatterBody = frontmatter?.[1];
  if (frontmatterBody) {
    const nameMatch = frontmatterBody.match(
      /^\s*name\s*:\s*["']?([^"'\r\n]+?)["']?\s*$/imu,
    );
    const frontmatterName = nameMatch?.[1]?.trim();
    if (frontmatterName) {
      return frontmatterName;
    }
  }

  return undefined;
}

function extractOutputPayload(output: string) {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    if (typeof parsed.output === "string") {
      return parsed.output;
    }
  } catch {
    // OpenCode may already provide plain stdout text.
  }

  return output;
}

function extractCommandFromInput(input: string) {
  const parsed = parseToolCallInputObject(input);
  if (parsed) {
    const command = extractCommandFromParsedInput(parsed);
    if (command !== undefined) {
      return command;
    }
  }

  return input;
}

function extractCommandFromParsedInput(
  parsed: Record<string, unknown>,
): string | undefined {
  const parsedCommand = Array.isArray(parsed.parsed_cmd)
    ? parsed.parsed_cmd[0]
    : undefined;
  const command =
    parsed.command ??
    parsed.cmd ??
    parsed.script ??
    parsed.shell ??
    parsed.args ??
    (isRecord(parsedCommand) ? parsedCommand.cmd : undefined);

  if (Array.isArray(command)) {
    return command.map((item) => String(item)).join(" ");
  }

  if (
    typeof command === "string" ||
    typeof command === "number" ||
    typeof command === "boolean"
  ) {
    return String(command);
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
