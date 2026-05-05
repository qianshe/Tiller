import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LOGS_DIR = resolve(REPO_ROOT, "logs");
export const ACP_LOGS_DIR = resolve(LOGS_DIR, "acp");

mkdirSync(ACP_LOGS_DIR, { recursive: true });

export function writeProtocolLog(logFile: string, stream: "stdin" | "stdout", payload: unknown) {
  writeLogLine(logFile, stream, JSON.stringify(sanitizeProtocolLogPayload(payload)));
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

export function writeChunkLog(logFile: string, stream: string, chunk: string) {
  const trimmed = chunk.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  writeLogLine(logFile, stream, trimmed);
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
  return typeof value === "string" && /^(text|output|patch|content)$/iu.test(key);
}

function redactProtocolLogValue(value: unknown) {
  return typeof value === "string" ? `[redacted chars=${value.length}]` : "[redacted]";
}

export function writeLogLine(logFile: string, stream: string, message: string) {
  appendFileSync(logFile, `${new Date().toISOString()} [${stream}] ${message}\n`, "utf8");
}
