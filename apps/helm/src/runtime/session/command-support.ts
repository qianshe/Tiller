import type { AvailableCommand } from "@tiller/shared";

export function parseSlashCommandName(text: string) {
  const match = /^\s*\/(\S+)/u.exec(text);
  return match?.[1]?.replace(/^\/+/, "") ?? null;
}

export function availableCommandInvocations(command: AvailableCommand) {
  const name = command.name.replace(/^\/+/, "");
  const scope = command.scope?.trim();
  return scope ? [name, `${scope}:${name}`] : [name];
}

export function assertSupportedSlashCommand(
  text: string,
  commands: AvailableCommand[] | undefined,
  agentName: string,
) {
  const commandName = parseSlashCommandName(text);
  if (!commandName || !commands?.length) {
    return;
  }
  const supported = commands.some((command) => availableCommandInvocations(command).includes(commandName));
  if (supported) {
    return;
  }
  const available = commands.map((command) => `/${availableCommandInvocations(command).at(-1)}`).join(", ");
  throw new Error(`/${commandName} command is not supported by ${agentName}. Available commands: ${available}`);
}
