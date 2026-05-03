import type { TillerConfig } from "@tiller/agent-registry";

export type TillerAuthMode = "none" | "pairing";

export type TillerRuntimeOptions = {
  host: string;
  port: number;
  authMode: TillerAuthMode;
};

export type ResolveTillerRuntimeOptionsInput = {
  argv?: string[];
  env?: Record<string, string | undefined>;
  config?: Pick<TillerConfig, "daemon">;
};

const DEFAULT_TILLER_HOST = "0.0.0.0";
const DEFAULT_TILLER_PORT = 47631;
const DEFAULT_TILLER_AUTH_MODE: TillerAuthMode = "none";

export function resolveTillerRuntimeOptions(input: ResolveTillerRuntimeOptionsInput = {}): TillerRuntimeOptions {
  const argv = normalizeArgv(input.argv ?? process.argv.slice(2));
  const env = input.env ?? process.env;
  const args = parseArgs(argv);
  const configDaemon = input.config?.daemon;

  const host = firstNonEmpty(args.host, env.TILLER_HOST, configDaemon?.host, DEFAULT_TILLER_HOST);
  const port = parsePort(firstNonEmpty(args.port, env.TILLER_PORT, configDaemon?.port === undefined ? undefined : String(configDaemon.port), String(DEFAULT_TILLER_PORT)));
  const authMode = parseAuthMode(firstNonEmpty(env.TILLER_AUTH, configDaemon?.auth, DEFAULT_TILLER_AUTH_MODE));

  return { host, port, authMode };
}

function normalizeArgv(argv: string[]) {
  return argv[0] === "start" ? argv.slice(1) : argv;
}

export type TillerArgvTokens = {
  positional: string[];
  host?: string;
  port?: string;
};

/** Single source of truth for tokenizing Tiller's `--host`/`--port` flags and positional commands. */
export function tokenizeTillerArgv(argv: string[]): TillerArgvTokens {
  const positional: string[] = [];
  let host: string | undefined;
  let port: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      host = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length);
    } else if (arg === "--port") {
      port = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--port=")) {
      port = arg.slice("--port=".length);
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }
  return { positional, host, port };
}

function parseArgs(argv: string[]) {
  const { host, port } = tokenizeTillerArgv(argv);
  return { host, port };
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

function parseAuthMode(value: string): TillerAuthMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "none" || normalized === "off" || normalized === "disabled") {
    return "none";
  }
  if (normalized === "pairing" || normalized === "beacon") {
    return "pairing";
  }
  throw new Error(`Invalid Tiller auth mode: ${value}`);
}
