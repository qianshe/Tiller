import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type AcpProtocolTraceMode = "off" | "summary" | "raw";

export type AcpProtocolLoggingOptions = {
  mode?: AcpProtocolTraceMode;
  logsDir?: string;
};

export type ProtocolLogSink = {
  logFile?: string;
  writeProtocol(stream: "stdin" | "stdout", payload: unknown): void;
  writeChunk(stream: string, chunk: string): void;
  writeLine(stream: string, message: string): void;
};

export function createProtocolLogSink(params: {
  mode?: AcpProtocolTraceMode;
  logsDir?: string;
  filePrefix: string;
  token: string;
}): ProtocolLogSink {
  const mode = params.mode ?? "summary";
  if (mode === "off" || !params.logsDir) {
    return createNoopProtocolLogSink();
  }

  const logFile = resolveProtocolLogFile(params.logsDir, params.filePrefix, params.token);
  mkdirSync(dirname(logFile), { recursive: true });

  return {
    logFile,
    writeProtocol(stream, payload) {
      const loggedPayload = mode === "raw"
        ? payload
        : summarizeProtocolLogPayload(payload);
      writeLogLine(logFile, stream, JSON.stringify(loggedPayload));
    },
    writeChunk(stream, chunk) {
      const message = mode === "raw"
        ? chunk.replace(/\r/g, "\\r").replace(/\n/g, "\\n")
        : `chunk chars=${chunk.length}`;
      writeLogLine(logFile, stream, message);
    },
    writeLine(stream, message) {
      writeLogLine(logFile, stream, message);
    },
  };
}

export function createNoopProtocolLogSink(): ProtocolLogSink {
  return {
    writeProtocol: () => undefined,
    writeChunk: () => undefined,
    writeLine: () => undefined,
  };
}

export function resolveProtocolLogFile(logsDir: string, filePrefix: string, token: string) {
  return resolve(logsDir, `${filePrefix}-${sanitizeLogToken(token)}.log`);
}

export function writeProtocolLog(sink: ProtocolLogSink, stream: "stdin" | "stdout", payload: unknown) {
  sink.writeProtocol(stream, payload);
}

export function sanitizeProtocolLogPayload(payload: unknown): unknown {
  if (!payloadHasRedactableField(payload)) {
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeProtocolLogPayload(item));
  }
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    sanitized[key] = shouldRedactProtocolLogField(key, value)
      ? redactProtocolLogValue(value)
      : sanitizeProtocolLogPayload(value);
  }
  return sanitized;
}

export function summarizeProtocolLogPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map((item) => summarizeProtocolLogPayload(item));
  }
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (shouldRedactProtocolLogField(key, value)) {
      summary[key] = redactProtocolLogValue(value);
    } else if (key === "params" && value && typeof value === "object") {
      summary[key] = summarizeProtocolLogPayload(value);
    } else if (Array.isArray(value)) {
      summary[key] = { items: value.length };
    } else {
      summary[key] = summarizeProtocolScalar(value);
    }
  }
  return summary;
}

export function writeChunkLog(sink: ProtocolLogSink, stream: string, chunk: string) {
  sink.writeChunk(stream, chunk);
}

export function sanitizeLogToken(value: string) {
  return value.replace(/[^a-z0-9._-]+/giu, "-");
}

function payloadHasRedactableField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(payloadHasRedactableField);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  for (const [key, child] of Object.entries(value)) {
    if (shouldRedactProtocolLogField(key, child)) {
      return true;
    }
    if (payloadHasRedactableField(child)) {
      return true;
    }
  }
  return false;
}

function shouldRedactProtocolLogField(key: string, value: unknown) {
  return typeof value === "string" && /^(text|output|patch|content|prompt)$/iu.test(key);
}

function redactProtocolLogValue(value: unknown) {
  return typeof value === "string" ? `[redacted chars=${value.length}]` : "[redacted]";
}

function summarizeProtocolScalar(value: unknown) {
  if (typeof value === "string") {
    return `[string chars=${value.length}]`;
  }
  if (value && typeof value === "object") {
    return summarizeProtocolLogPayload(value);
  }
  return value;
}

export function writeLogLine(logFile: string | undefined, stream: string, message: string) {
  if (!logFile) {
    return;
  }
  mkdirSync(dirname(logFile), { recursive: true });
  appendFileSync(logFile, `${new Date().toISOString()} [${stream}] ${message}\n`, "utf8");
}
