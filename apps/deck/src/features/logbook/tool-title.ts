import {
  formatAgentToolCallMcpName,
  isStructuredSearchToolCallInput,
  resolveAgentToolCallMcp,
  type AgentToolCall,
} from "@tiller/shared";

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

  const title = isInformativeToolTitle(call.title, call.id) ? call.title : fallback;
  if (displayKind === "shell") {
    if (shouldHoldInputDerivedTitle(call, title, displayKind)) {
      return stripToolPrefix(title);
    }
    return summarizeCommand(call.input) ?? stripToolPrefix(title);
  }

  const mcp = resolveAgentToolCallMcp({
    existing: call.mcp,
    input: call.input,
    title: call.title,
  });
  if (mcp) {
    return formatAgentToolCallMcpName(mcp);
  }

  if (isNamespacedToolTitle(title)) {
    return stripToolPrefix(title);
  }
  if (displayKind === "read" || displayKind === "write") {
    if (shouldHoldInputDerivedTitle(call, title, displayKind)) {
      return stripLeadingActionVerb(title, displayKind);
    }
    return extractApplyPatchFilePath(call.input) ??
      extractFilePathFromStructuredInput(parseToolCallInputObject(call.input)) ??
      stripLeadingActionVerb(title, displayKind);
  }
  if (displayKind === "diagnostics") {
    if (shouldHoldInputDerivedTitle(call, title, displayKind)) {
      return title;
    }
    const path = extractFilePathFromStructuredInput(parseToolCallInputObject(call.input));
    return path ? `Diagnostics: ${path}` : title;
  }
  if (displayKind === "search") {
    if (shouldHoldInputDerivedTitle(call, title, displayKind)) {
      return title;
    }
    return summarizeSearchInput(title, parseToolCallInputObject(call.input)) ?? title;
  }
  return title;
}

export function resolveDisplayToolKind(
  call: AgentToolCall,
): AgentToolCall["kind"] {
  if (call.kind === "shell" && extractApplyPatchFilePath(call.input)) {
    return "write";
  }
  if (
    call.kind === "shell" &&
    /^(?:Search|Grep|Glob)$/iu.test(stripToolPrefix(call.title).trim()) &&
    isStructuredSearchToolCallInput(call.input)
  ) {
    return "search";
  }
  return call.kind;
}

function shouldHoldInputDerivedTitle(
  call: AgentToolCall,
  title: string,
  displayKind: AgentToolCall["kind"],
) {
  if (call.status !== "pending" && call.status !== "running") {
    return false;
  }
  if (
    title === call.id ||
    /^call_[A-Za-z0-9_]+$/u.test(title) ||
    /^Tool call\b/iu.test(title)
  ) {
    return true;
  }
  const normalized = stripToolPrefix(title).trim().toLowerCase();
  if (displayKind === "search") {
    return normalized === "search";
  }
  if (displayKind === "diagnostics") {
    return normalized === "diagnostics";
  }
  if (displayKind === "read") {
    return normalized === "read";
  }
  if (displayKind === "write") {
    return normalized === "write" || normalized === "edit";
  }
  return displayKind === "shell" && (normalized === "shell" || normalized === "bash");
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
  const prefix = resolveSearchTitlePrefix(normalizedTitle, parsed, query);
  return `${prefix}: ${truncateInline(query, 56)}`;
}

function resolveSearchTitlePrefix(
  title: string,
  parsed: Record<string, unknown> | null,
  query: string,
) {
  if (isInformativeSearchTitle(title) && !/^Search$/iu.test(title)) {
    return title;
  }
  if (/^Search$/iu.test(title)) {
    return inferGenericSearchTitle(parsed, query);
  }
  return "Search";
}

function inferGenericSearchTitle(
  parsed: Record<string, unknown> | null,
  query: string,
) {
  const grepSpecificKeys = [
    "-n",
    "context",
    "glob",
    "head_limit",
    "headLimit",
    "output_mode",
    "outputMode",
    "type",
  ];
  if (parsed && grepSpecificKeys.some((key) => parsed[key] !== undefined)) {
    return "Grep";
  }
  return /[*?\[\]{}]/u.test(query) ? "Glob" : "Grep";
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

function summarizeCommand(input: string | undefined) {
  if (!input) {
    return undefined;
  }
  const command = extractCommandFromInput(input).replace(/\s+/g, " ").trim();
  if (!command) {
    return undefined;
  }

  const skillName = extractSkillNameFromCommand(command);
  if (skillName) {
    return `Skill: ${skillName}`;
  }

  return command;
}

function extractApplyPatchFilePath(input: string | undefined) {
  const command = extractCommandFromInput(input ?? "");
  if (!command || !/(?:^|[\s;&|])apply_patch(?:\.bat)?\b|--codex-run-as-apply-patch\b/iu.test(command)) {
    return undefined;
  }
  const normalized = command.replace(/`r`n|`n|`r/gu, "\n");
  const match = normalized.match(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/mu);
  return match?.[1] ? compactDisplayPath(match[1].trim()) : undefined;
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
    return command ?? "";
  }

  return input;
}

function extractCommandFromParsedInput(
  parsed: Record<string, unknown>,
): string | undefined {
  const parsedCommand = Array.isArray(parsed.parsed_cmd)
    ? parsed.parsed_cmd[0]
    : undefined;
  const parsedCommandText = isRecord(parsedCommand) ? parsedCommand.cmd : undefined;
  const command =
    parsedCommandText ??
    parsed.command ??
    parsed.cmd ??
    parsed.script ??
    parsed.shell ??
    parsed.args ??
    undefined;

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
