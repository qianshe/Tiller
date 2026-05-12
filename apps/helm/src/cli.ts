import { tokenizeTillerArgv } from "./runtime/options";

declare const __TILLER_VERSION__: string | undefined;

export type TillerCliAction =
  | { kind: "start" }
  | { kind: "update" }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string };

export const TILLER_VERSION =
  typeof __TILLER_VERSION__ === "string" && __TILLER_VERSION__.trim().length > 0
    ? __TILLER_VERSION__
    : "0.0.0-dev";
const HELP_FLAGS = new Set(["help", "--help", "-h"]);
const VERSION_FLAGS = new Set(["version", "--version", "-v"]);

export function resolveTillerCliAction(argv = process.argv.slice(2)): TillerCliAction {
  if (argv.some((arg) => HELP_FLAGS.has(arg))) {
    return { kind: "help" };
  }
  if (argv.some((arg) => VERSION_FLAGS.has(arg))) {
    return { kind: "version" };
  }

  const command = tokenizeTillerArgv(argv).positional[0];
  if (!command || command === "start") {
    return { kind: "start" };
  }
  if (command === "update") {
    return { kind: "update" };
  }
  return { kind: "error", message: `Unknown command: ${command}` };
}

export function tillerCliHelp() {
  return [
    "Tiller",
    "",
    "Usage:",
    "  tiller start [--host <host>] [--port <port>]",
    "  tiller update",
    "  tiller [--host <host>] [--port <port>]",
    "",
    "Environment:",
    "  TILLER_HOST                  Override host (default: 0.0.0.0)",
    "  TILLER_PORT                  Override port (default: 47631)",
    "  TILLER_UPDATE_CHECK=0        Disable startup update checks",
    "  TILLER_UPDATE_PREVIEW_HINT=0 Disable preview update hints",
  ].join("\n");
}
