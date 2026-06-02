import { readTillerConfig, saveLoggingToConfig } from "@tiller/agent-registry";
import type { HelmHandlerContext } from "../context";
import {
  resolveLoggingOptions,
  type TillerAcpTraceMode,
  type TillerLogLevel,
} from "../../logging/options";

const LOG_LEVELS = new Set<TillerLogLevel>(["trace", "debug", "info", "warn", "error", "fatal"]);
const ACP_TRACE_MODES = new Set<TillerAcpTraceMode>(["off", "summary", "raw"]);

type LoggingPatch = {
  level?: string;
  format?: string;
  acpTrace?: string;
};

export function getLoggingSettings(context: HelmHandlerContext) {
  const current = resolveLoggingOptions(process.env, readTillerConfig(context.configPath).logging);
  return {
    logging: {
      ...current,
      level: context.logger?.getLevel?.() ?? current.level,
    },
  };
}

export function saveLoggingSettings(
  params: { logging?: LoggingPatch },
  context: HelmHandlerContext,
) {
  const current = resolveLoggingOptions(process.env, readTillerConfig(context.configPath).logging);
  const next = {
    level: normalizeLogLevel(params.logging?.level) ?? current.level,
    format: normalizeLogFormat(params.logging?.format) ?? current.format,
    acpTrace: normalizeAcpTraceMode(params.logging?.acpTrace) ?? current.acpTrace,
  };
  saveLoggingToConfig(next, context.configPath);
  context.logger.setLevel(next.level);
  return {
    ok: true,
    logging: next,
    message: "Saved logging settings.",
  };
}

function normalizeLogLevel(value: string | undefined) {
  const normalized = value?.toLowerCase() as TillerLogLevel | undefined;
  return normalized && LOG_LEVELS.has(normalized) ? normalized : undefined;
}

function normalizeLogFormat(value: string | undefined) {
  return value === "json" || value === "pretty" ? value : undefined;
}

function normalizeAcpTraceMode(value: string | undefined) {
  const normalized = value?.toLowerCase() as TillerAcpTraceMode | undefined;
  return normalized && ACP_TRACE_MODES.has(normalized) ? normalized : undefined;
}
