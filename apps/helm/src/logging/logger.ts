import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { resolve } from "node:path";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type TillerLogger = {
  logInfo(message: string): void;
  logDebug(message: string): void;
  logWarn(message: string): void;
  logError(message: string): void;
  writeLogLine(level: LogLevel, message: string): void;
  readonly logFile: string;
  close(): void;
};

export type CreateTillerLoggerOptions = {
  logsDir: string;
  debugEnabled?: boolean;
  fileName?: string;
  logStream?: WriteStream;
  console?: Pick<Console, "log" | "debug" | "warn" | "error">;
  now?: () => Date;
};

export function createTillerLogger(options: CreateTillerLoggerOptions): TillerLogger {
  const {
    logsDir,
    debugEnabled = /^(1|true|yes)$/iu.test(process.env.TILLER_DEBUG ?? ""),
    fileName = "tiller.log",
    logStream,
    console: consoleOverride,
    now = () => new Date(),
  } = options;

  const out = consoleOverride ?? console;
  const logFile = resolve(logsDir, fileName);
  let stream = logStream;
  if (!stream) {
    mkdirSync(logsDir, { recursive: true });
    stream = createWriteStream(logFile, { flags: "a" });
  }

  function writeLogLine(level: LogLevel, message: string) {
    stream!.write(`${now().toISOString()} [${level}] ${message}\n`);
  }

  return {
    logInfo(message) {
      writeLogLine("INFO", message);
      out.log(message);
    },
    logDebug(message) {
      if (!debugEnabled) {
        return;
      }
      writeLogLine("DEBUG", message);
      out.debug(message);
    },
    logWarn(message) {
      writeLogLine("WARN", message);
      out.warn(message);
    },
    logError(message) {
      writeLogLine("ERROR", message);
      out.error(message);
    },
    writeLogLine,
    logFile,
    close() {
      stream!.end();
    },
  };
}
