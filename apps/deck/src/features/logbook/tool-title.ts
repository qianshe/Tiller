import type { AgentToolCall } from "@tiller/shared";

export function resolveDisplayToolTitle(call: AgentToolCall, fallback: string) {
  // Codex reports SKILL.md reads as a generic `tool` kind with the shell command
  // stuffed into title/input — so always probe for a skill name first.
  const skillNameFromCommand = extractSkillNameFromCommandSources(call);
  if (skillNameFromCommand) {
    return `Skill: ${skillNameFromCommand}`;
  }

  if (call.kind !== "terminal") {
    const openCodeSkillName = extractOpenCodeSkillNameFromToolOutput(
      call.output,
    );
    if (openCodeSkillName) {
      return `Skill: ${openCodeSkillName}`;
    }
  }

  if (call.kind === "terminal") {
    return summarizeCommand(call.input ?? call.title ?? fallback);
  }

  return isInformativeToolTitle(call.title, call.id) ? call.title : fallback;
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

export function resolveMergedToolTitle(
  currentTitle: string,
  incomingTitle: string,
  id: string,
) {
  return isInformativeToolTitle(incomingTitle, id)
    ? incomingTitle
    : currentTitle || incomingTitle || id;
}

function isInformativeToolTitle(title: string | undefined, id: string) {
  const normalized = title?.trim();
  return Boolean(
    normalized && normalized !== id && !/^call_[A-Za-z0-9]+$/u.test(normalized),
  );
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
