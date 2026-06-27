export type TillerLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type TillerLogFormat = "json" | "pretty";
export type TillerAcpTraceMode = "off" | "summary" | "raw";

export type TillerLoggingOptions = {
  level: TillerLogLevel;
  format: TillerLogFormat;
  acpTrace: TillerAcpTraceMode;
};

export type TillerLoggingConfig = {
  level?: string;
  format?: string;
  acpTrace?: string;
};

const LOG_LEVELS = new Set<TillerLogLevel>(["trace", "debug", "info", "warn", "error", "fatal"]);
const ACP_TRACE_MODES = new Set<TillerAcpTraceMode>(["off", "summary", "raw"]);

function isTruthy(value: string | undefined) {
  return /^(1|true|yes)$/iu.test(value ?? "");
}

export function resolveLoggingOptions(
  env: NodeJS.ProcessEnv,
  config: TillerLoggingConfig = {},
): TillerLoggingOptions {
  const requestedEnvLevel = env.TILLER_LOG_LEVEL?.toLowerCase();
  const requestedConfigLevel = config.level?.toLowerCase();
  const level = parseLogLevel(requestedEnvLevel)
    ?? (isTruthy(env.TILLER_DEBUG) ? "debug" : undefined)
    ?? parseLogLevel(requestedConfigLevel)
    ?? "info";

  const format = parseLogFormat(env.TILLER_LOG_FORMAT)
    ?? parseLogFormat(config.format)
    ?? "json";
  const requestedAcpTrace = env.TILLER_ACP_TRACE?.toLowerCase();
  const acpTrace = parseAcpTraceMode(requestedAcpTrace)
    ?? parseAcpTraceMode(config.acpTrace?.toLowerCase())
    ?? "summary";

  return { level, format, acpTrace };
}

function parseLogLevel(value: string | undefined): TillerLogLevel | undefined {
  return value && LOG_LEVELS.has(value as TillerLogLevel)
    ? value as TillerLogLevel
    : undefined;
}

function parseLogFormat(value: string | undefined): TillerLogFormat | undefined {
  return value === "pretty" || value === "json" ? value : undefined;
}

function parseAcpTraceMode(value: string | undefined): TillerAcpTraceMode | undefined {
  return value && ACP_TRACE_MODES.has(value as TillerAcpTraceMode)
    ? value as TillerAcpTraceMode
    : undefined;
}
