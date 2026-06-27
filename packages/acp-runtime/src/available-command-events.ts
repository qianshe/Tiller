import type { AvailableCommand, AvailableCommandKind } from "@tiller/shared";

function readRawCommandKind(cmd: Record<string, unknown>) {
  for (const key of ["kind", "type", "category"]) {
    const value = cmd[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeAvailableCommandKind(
  rawKind: string | undefined,
  description: string | undefined,
): AvailableCommandKind {
  const normalized = rawKind?.trim().toLowerCase();
  if (normalized === "skill" || normalized === "skills") return "skill";
  if (normalized === "builtin" || normalized === "built-in") return "builtin";
  if (normalized === "prompt" || normalized === "prompts") return "prompt";
  if (normalized === "workflow" || normalized === "workflows") return "workflow";
  if (
    normalized === "command" ||
    normalized === "commands" ||
    normalized === "slash"
  ) {
    return "command";
  }
  if (/^\s*[\[(]builtin[\])]/iu.test(description ?? "")) return "builtin";
  return rawKind ? "unknown" : "command";
}

function readCommandMetadataString(cmd: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = cmd[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  const meta = cmd.meta;
  if (meta && typeof meta === "object") {
    const record = meta as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return undefined;
}

function parseCommandDescription(description: string | undefined) {
  if (!description) {
    return { description, source: undefined };
  }
  const match = /^(.*?)\s*\((user)\)\s*$/iu.exec(description);
  if (!match) {
    return { description, source: undefined };
  }
  return { description: match[1]?.trim() || description, source: match[2]?.toLowerCase() };
}

export function extractAvailableCommands(updateType: string | undefined, update: any): AvailableCommand[] | null {
  if (updateType !== "available_commands_update") {
    return null;
  }

  const rawCommands = Array.isArray(update.availableCommands)
    ? update.availableCommands
    : Array.isArray(update.available_commands)
      ? update.available_commands
      : [];

  return rawCommands
    .filter((cmd: any) => cmd && typeof cmd.name === "string")
    .map((cmd: any) => {
      const rawKind = readRawCommandKind(cmd);
      const parsedDescription = parseCommandDescription(typeof cmd.description === "string" ? cmd.description : undefined);
      const description = parsedDescription.description;
      const source = readCommandMetadataString(cmd, ["source", "origin"]) ?? parsedDescription.source;
      return {
        name: cmd.name,
        description,
        input: cmd.input && typeof cmd.input === "object" ? { hint: typeof cmd.input.hint === "string" ? cmd.input.hint : undefined } : undefined,
        kind: source === "user" && !rawKind ? "skill" : normalizeAvailableCommandKind(rawKind, description),
        rawKind,
        source,
        scope: readCommandMetadataString(cmd, ["scope", "scopePrefix", "scope_prefix"]),
      };
    });
}
