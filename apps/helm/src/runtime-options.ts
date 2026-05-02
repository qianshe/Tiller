import type { TillerConfig } from "@tiller/agent-registry";

export type TillerRuntimeOptions = {
  host: string;
  port: number;
};

export type ResolveTillerRuntimeOptionsInput = {
  argv?: string[];
  env?: Record<string, string | undefined>;
  config?: Pick<TillerConfig, "daemon">;
};

const DEFAULT_TILLER_HOST = "0.0.0.0";
const DEFAULT_TILLER_PORT = 47631;

export function resolveTillerRuntimeOptions(input: ResolveTillerRuntimeOptionsInput = {}): TillerRuntimeOptions {
  const argv = normalizeArgv(input.argv ?? process.argv.slice(2));
  const env = input.env ?? process.env;
  const args = parseArgs(argv);
  const configDaemon = input.config?.daemon;

  const host = firstNonEmpty(args.host, env.TILLER_HOST, configDaemon?.host, DEFAULT_TILLER_HOST);
  const port = parsePort(firstNonEmpty(args.port, env.TILLER_PORT, configDaemon?.port === undefined ? undefined : String(configDaemon.port), String(DEFAULT_TILLER_PORT)));

  return { host, port };
}

function normalizeArgv(argv: string[]) {
  return argv[0] === "start" ? argv.slice(1) : argv;
}

function parseArgs(argv: string[]) {
  const parsed: { host?: string; port?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      parsed.host = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--host=")) {
      parsed.host = arg.slice("--host=".length);
    } else if (arg === "--port") {
      parsed.port = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--port=")) {
      parsed.port = arg.slice("--port=".length);
    }
  }
  return parsed;
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value !== undefined && value.trim().length > 0)?.trim() ?? "";
}

function parsePort(value: string) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Tiller port: ${value}`);
  }
  return port;
}
