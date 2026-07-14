import { mkdirSync } from "node:fs";
import { once } from "node:events";
import { resolve } from "node:path";
import { Writable } from "node:stream";
import pino, { type DestinationStream, type Logger as PinoLogger } from "pino";
import {
  resolveLoggingOptions,
  type TillerLogFormat,
  type TillerLogLevel,
} from "./options";
import { redactLogFields } from "./redaction";
import { createRotatingFileDestination } from "./rotating-file-destination";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type TillerLogFields = Record<string, unknown>;

const PRETTY_FIELD_IGNORED_KEYS = new Set(["event", "format", "level", "message", "time"]);

export type TillerLogger = {
  fatal(event: string, fields?: TillerLogFields): void;
  trace(event: string, fields?: TillerLogFields): void;
  info(event: string, fields?: TillerLogFields): void;
  debug(event: string, fields?: TillerLogFields): void;
  warn(event: string, fields?: TillerLogFields): void;
  error(event: string, fields?: TillerLogFields): void;
  logInfo(message: string): void;
  logDebug(message: string): void;
  logWarn(message: string): void;
  logError(message: string): void;
  writeLogLine(level: LogLevel, message: string): void;
  getLevel(): TillerLogLevel;
  setLevel(level: TillerLogLevel): void;
  readonly logFile: string;
  close(): Promise<void>;
};

export type CreateTillerLoggerOptions = {
  logsDir: string;
  level?: TillerLogLevel;
  format?: TillerLogFormat;
  fileName?: string;
  destination?: DestinationStream;
  consoleDestination?: DestinationStream;
  consoleOutput?: boolean;
  debugEnabled?: boolean;
  console?: Pick<Console, "log" | "debug" | "warn" | "error">;
  now?: () => Date;
  maxLogFileBytes?: number;
  retainedLogFiles?: number;
};

export function createTillerLogger(options: CreateTillerLoggerOptions): TillerLogger {
  const {
    logsDir,
    level: explicitLevel,
    format = "json",
    fileName = "tiller.log",
    destination,
    consoleDestination,
    consoleOutput = false,
    debugEnabled,
    console: consoleOverride,
    maxLogFileBytes,
    retainedLogFiles,
  } = options;

  const out = consoleOverride ?? console;
  const logFile = resolve(logsDir, fileName);
  if (!destination) {
    mkdirSync(logsDir, { recursive: true });
  }
  const resolvedOptions = resolveLoggingOptions(process.env);
  let currentLevel = explicitLevel ?? (debugEnabled ? "debug" : resolvedOptions.level);
  const isLegacyDebugEnabled = () => (
    debugEnabled ?? (currentLevel === "debug" || currentLevel === "trace")
  );
  const mirrorsStructuredLogsToConsole = format === "pretty" && (consoleOutput || Boolean(consoleDestination));
  const logDestination = createLogDestination({
    consoleDestination,
    consoleOutput,
    destination,
    format,
    logFile,
    maxLogFileBytes,
    retainedLogFiles,
  });
  const logger = pino(
    {
      base: null,
      level: currentLevel,
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    logDestination,
  );

  function writeStructured(
    level: TillerLogLevel,
    event: string,
    fields: TillerLogFields = {},
  ) {
    const payload = {
      ...redactEventFields(event, fields),
      event,
      format,
    };
    const writer = logger[level] as PinoLogger[TillerLogLevel];
    writer.call(logger, payload);
  }

  function writeLogLine(level: LogLevel, message: string) {
    const mappedLevel = mapLegacyLogLevel(level);
    writeStructured(mappedLevel, `legacy.${mappedLevel}`, { message });
  }

  return {
    fatal(event, fields) {
      writeStructured("fatal", event, fields);
    },
    trace(event, fields) {
      writeStructured("trace", event, fields);
    },
    info(event, fields) {
      writeStructured("info", event, fields);
    },
    debug(event, fields) {
      writeStructured("debug", event, fields);
    },
    warn(event, fields) {
      writeStructured("warn", event, fields);
    },
    error(event, fields) {
      writeStructured("error", event, fields);
    },
    logInfo(message) {
      writeLogLine("INFO", message);
      if (!mirrorsStructuredLogsToConsole) {
        out.log(message);
      }
    },
    logDebug(message) {
      if (!isLegacyDebugEnabled()) {
        return;
      }
      writeLogLine("DEBUG", message);
      if (!mirrorsStructuredLogsToConsole) {
        out.debug(message);
      }
    },
    logWarn(message) {
      writeLogLine("WARN", message);
      if (!mirrorsStructuredLogsToConsole) {
        out.warn(message);
      }
    },
    logError(message) {
      writeLogLine("ERROR", message);
      if (!mirrorsStructuredLogsToConsole) {
        out.error(message);
      }
    },
    writeLogLine,
    getLevel() {
      return currentLevel;
    },
    setLevel(level) {
      currentLevel = level;
      logger.level = level;
    },
    logFile,
    async close() {
      logger.flush();
      await new Promise<void>((resolveFlush) => setImmediate(resolveFlush));
      if ("end" in logDestination && typeof logDestination.end === "function") {
        const finished = "once" in logDestination && typeof logDestination.once === "function"
          ? once(logDestination as any, "finish").then(() => undefined).catch(() => undefined)
          : undefined;
        logDestination.end();
        if ("flush" in logDestination && typeof logDestination.flush === "function") {
          await logDestination.flush();
        }
        await finished;
      }
    },
  };
}

function redactEventFields(event: string, fields: TillerLogFields): TillerLogFields {
  const redacted = redactLogFields(fields) as TillerLogFields;
  if (event === "updates.latest_available" || event === "updates.preview_available") {
    redacted.command = fields.command;
  }
  if (event === "server.shutdown.started" || event === "server.shutdown.completed") {
    redacted.reason = fields.reason;
  }
  return redacted;
}

function createLogDestination(options: {
  consoleDestination?: DestinationStream;
  consoleOutput: boolean;
  destination?: DestinationStream;
  format: TillerLogFormat;
  logFile: string;
  maxLogFileBytes?: number;
  retainedLogFiles?: number;
}): DestinationStream {
  const rotatingDestination = options.destination ?? createRotatingFileDestination({
    filePath: options.logFile,
    maxFileBytes: options.maxLogFileBytes,
    retainedFiles: options.retainedLogFiles,
  });
  if (options.format === "pretty") {
    const fileDestination = createFilePrettyDestination(rotatingDestination);
    const consoleDestination = options.consoleDestination
      ? createConsolePrettyDestination(options.consoleDestination, false)
      : (options.consoleOutput
        ? createConsolePrettyDestination(process.stdout, !process.env.NO_COLOR)
        : undefined);
    return consoleDestination
      ? teeDestinations([fileDestination, consoleDestination])
      : fileDestination;
  }

  return rotatingDestination;
}

function formatPrettyEvent(log: Record<string, unknown>) {
  if (typeof log.event === "string" && log.event.startsWith("legacy.")) {
    return typeof log.message === "string" ? stripTillerPrefix(log.message) : log.event;
  }
  return typeof log.event === "string" ? log.event : "";
}

function stripTillerPrefix(message: string) {
  return message.replace(/^\[tiller\]\s*/u, "");
}

function createConsolePrettyDestination(destination: DestinationStream, colorizeLevel: boolean) {
  let pending = "";
  const consoleDestination = new Writable({
    write(chunk, _encoding, callback) {
      pending += String(chunk);
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        writeConsolePrettyLine(destination, line, colorizeLevel);
      }
      callback();
    },
    final(callback) {
      if (pending) {
        writeConsolePrettyLine(destination, pending, colorizeLevel);
        pending = "";
      }
      callback();
    },
  });
  return Object.assign(consoleDestination, {
    flush() {
      if ("flush" in destination && typeof destination.flush === "function") {
        return destination.flush();
      }
      return Promise.resolve();
    },
    flushSync() {
      if ("flushSync" in destination && typeof destination.flushSync === "function") {
        destination.flushSync();
      }
    },
  });
}

function createFilePrettyDestination(destination: DestinationStream) {
  let pending = "";
  const fileDestination = new Writable({
    write(chunk, _encoding, callback) {
      pending += String(chunk);
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        writeFilePrettyLine(destination, line);
      }
      callback();
    },
    final(callback) {
      if (pending) {
        writeFilePrettyLine(destination, pending);
        pending = "";
      }
      callback();
    },
  });
  return Object.assign(fileDestination, {
    flush() {
      if ("flush" in destination && typeof destination.flush === "function") {
        return destination.flush();
      }
      return Promise.resolve();
    },
    flushSync() {
      if ("flushSync" in destination && typeof destination.flushSync === "function") {
        destination.flushSync();
      }
    },
  });
}

function writeFilePrettyLine(destination: DestinationStream, line: string) {
  if (!line.trim()) {
    return;
  }
  try {
    const log = JSON.parse(line) as Record<string, unknown>;
    destination.write(`${formatFilePrettyLog(log)}\n`);
  } catch {
    destination.write(line.endsWith("\n") ? line : `${line}\n`);
  }
}

function formatFilePrettyLog(log: Record<string, unknown>) {
  const time = typeof log.time === "string" ? formatLocalTimestamp(new Date(log.time)) : "";
  const level = typeof log.level === "string" ? log.level.toUpperCase() : "INFO";
  const event = formatPrettyEvent(log);
  const fields = formatPrettyJsonFields(log);
  const prefix = time ? `[${time}] ` : "";
  return fields
    ? `${prefix}${level}: ${event} ${fields}`
    : `${prefix}${level}: ${event}`;
}

function writeConsolePrettyLine(
  destination: DestinationStream,
  line: string,
  colorizeLevel: boolean,
) {
  if (!line.trim()) {
    return;
  }
  try {
    const log = JSON.parse(line) as Record<string, unknown>;
    destination.write(`${formatConsolePrettyLog(log, colorizeLevel)}\n`);
  } catch {
    destination.write(line.endsWith("\n") ? line : `${line}\n`);
  }
}

function formatConsolePrettyLog(log: Record<string, unknown>, colorizeLevel: boolean) {
  const time = typeof log.time === "string" ? formatLocalTimestamp(new Date(log.time)) : "";
  const level = typeof log.level === "string" ? log.level.toUpperCase() : "INFO";
  const event = formatPrettyEvent(log);
  const readableMessage = formatConsoleReadableMessage(log, event);
  const fields = formatPrettyJsonFields(log);
  const prefix = time ? `[${time}] ` : "";
  const levelLabel = colorizeLevel ? colorizeLogLevel(level) : level;
  const eventLabel = colorizeLevel ? colorizeEvent(event) : event;
  const fieldsLabel = colorizeLevel ? colorizeJsonFields(fields) : fields;
  if (readableMessage) {
    return `${prefix}${levelLabel}: ${readableMessage}`;
  }
  return fields
    ? `${prefix}${levelLabel}: ${eventLabel} ${fieldsLabel}`
    : `${prefix}${levelLabel}: ${eventLabel}`;
}

function formatConsoleReadableMessage(log: Record<string, unknown>, event: string) {
  if (event.startsWith("legacy.")) {
    return formatPrettyEvent(log);
  }

  switch (event) {
    case "server.listening": {
      const url = readString(log.url)
        ?? `http://${readString(log.host) ?? "unknown"}:${readNumber(log.port) ?? "unknown"}`;
      return `listening on ${url}`;
    }
    case "server.deck_available":
      return `Deck available at ${readString(log.url) ?? "unknown"}`;
    case "server.websocket_available":
      return "WebSocket available on the same origin";
    case "server.auth_mode":
      return `auth mode: ${readString(log.authMode) ?? "unknown"}`;
    case "server.config_stub":
      return `config stub ${readBoolean(log.exists) ? "found" : "not found"} at ${readString(log.path) ?? "unknown"}`;
    case "server.logs_file":
      return `logs at ${readString(log.path) ?? "unknown"}`;
    case "updates.latest_available":
      return [
        "Update available: ",
        readString(log.current) ?? "unknown",
        " -> ",
        readString(log.latest) ?? "unknown",
        "; Run: ",
        readString(log.command) ?? "tiller update",
      ].join("");
    case "updates.preview_available":
      return [
        "Preview available: ",
        readString(log.preview) ?? "unknown",
        "; Try it with: ",
        readString(log.command) ?? "unknown",
      ].join("");
    case "server.shutdown.started":
      return `shutdown reason=${readString(log.reason) ?? "unknown"}; closing ACP connections`;
    case "server.shutdown.completed":
      return `shutdown complete reason=${readString(log.reason) ?? "unknown"}`;
    default:
      return undefined;
  }
}

function formatPrettyJsonFields(log: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(log)) {
    if (!PRETTY_FIELD_IGNORED_KEYS.has(key)) {
      fields[key] = value;
    }
  }
  return Object.keys(fields).length > 0 ? JSON.stringify(fields) : "";
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function formatLocalTimestamp(date: Date) {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hours = padDatePart(date.getHours());
  const minutes = padDatePart(date.getMinutes());
  const seconds = padDatePart(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function colorizeLogLevel(level: string) {
  switch (level) {
    case "TRACE":
      return `\u001B[90m${level}\u001B[39m`;
    case "DEBUG":
      return `\u001B[34m${level}\u001B[39m`;
    case "INFO":
      return `\u001B[32m${level}\u001B[39m`;
    case "WARN":
      return `\u001B[33m${level}\u001B[39m`;
    case "ERROR":
    case "FATAL":
      return `\u001B[31m${level}\u001B[39m`;
    default:
      return level;
  }
}

function colorizeEvent(event: string) {
  return `\u001B[36m${event}\u001B[39m`;
}

function colorizeJsonFields(fields: string) {
  return `\u001B[90m${fields}\u001B[39m`;
}

function teeDestinations(destinations: DestinationStream[]): DestinationStream {
  const destination: DestinationStream & {
    end(): void;
    flush(): Promise<void>;
    flushSync(): void;
  } = {
    write(chunk: string) {
      for (const destination of destinations) {
        destination.write(chunk);
      }
    },
    end() {
      for (const destination of destinations) {
        if ("end" in destination && typeof destination.end === "function") {
          destination.end();
        }
      }
    },
    async flush() {
      await Promise.all(destinations.map((item) =>
        "flush" in item && typeof item.flush === "function"
          ? item.flush()
          : Promise.resolve(),
      ));
    },
    flushSync() {
      for (const destination of destinations) {
        if ("flushSync" in destination && typeof destination.flushSync === "function") {
          destination.flushSync();
        }
      }
    },
  };
  return destination;
}

function mapLegacyLogLevel(level: LogLevel): TillerLogLevel {
  switch (level) {
    case "DEBUG":
      return "debug";
    case "INFO":
      return "info";
    case "WARN":
      return "warn";
    case "ERROR":
      return "error";
  }
}
