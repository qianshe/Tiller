export type TillerCliAction =
  | { kind: "start" }
  | { kind: "help" }
  | { kind: "error"; message: string };

const HELP_FLAGS = new Set(["help", "--help", "-h"]);

export function resolveTillerCliAction(argv = process.argv.slice(2)): TillerCliAction {
  if (argv.some((arg) => HELP_FLAGS.has(arg))) {
    return { kind: "help" };
  }

  const command = positionalArgs(argv)[0];
  if (!command || command === "start") {
    return { kind: "start" };
  }
  if (HELP_FLAGS.has(command)) {
    return { kind: "help" };
  }
  return { kind: "error", message: `Unknown command: ${command}` };
}

function positionalArgs(argv: string[]) {
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host" || arg === "--port") {
      index += 1;
    } else if (arg.startsWith("--")) {
      continue;
    } else {
      positional.push(arg);
    }
  }
  return positional;
}

export function tillerCliHelp() {
  return [
    "Tiller",
    "",
    "Usage:",
    "  tiller start [--host <host>] [--port <port>]",
    "  tiller [--host <host>] [--port <port>]",
    "",
    "Environment:",
    "  TILLER_HOST  Override host (default: 0.0.0.0)",
    "  TILLER_PORT  Override port (default: 47631)",
  ].join("\n");
}
