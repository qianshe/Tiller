import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import { createTillerLogger } from "./logger";

function createMemoryDestination() {
  const chunks: string[] = [];
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      const text = String(chunk);
      chunks.push(text);
      lines.push(...text.split("\n").filter(Boolean));
      callback();
    },
  });

  return Object.assign(destination, {
    chunks,
    flushSync() {},
    lines,
  });
}

test("normal mode suppresses debug logs", () => {
  const destination = createMemoryDestination();
  const logger = createTillerLogger({
    logsDir: ".",
    level: "info",
    destination,
    console: { log() {}, debug() {}, warn() {}, error() {} },
  });

  logger.logDebug("debug hidden");
  logger.logInfo("info visible");

  assert.equal(destination.lines.some((line) => line.includes("debug hidden")), false);
  assert.equal(destination.lines.some((line) => line.includes("info visible")), true);
});

test("debug level enables legacy debug logs", () => {
  const destination = createMemoryDestination();
  const logger = createTillerLogger({
    logsDir: ".",
    level: "debug",
    destination,
    console: { log() {}, debug() {}, warn() {}, error() {} },
  });

  logger.logDebug("debug visible");

  assert.equal(destination.lines.some((line) => line.includes("debug visible")), true);
});

test("structured logs redact forbidden text fields", () => {
  const destination = createMemoryDestination();
  const logger = createTillerLogger({
    logsDir: ".",
    level: "debug",
    destination,
    console: { log() {}, debug() {}, warn() {}, error() {} },
  });

  logger.info("runtime.message", {
    sessionId: "session-1",
    text: "assistant secret",
    content: "prompt secret",
    chars: 16,
  });

  const joined = destination.lines.join("\n");
  assert.equal(joined.includes("assistant secret"), false);
  assert.equal(joined.includes("prompt secret"), false);
  assert.equal(joined.includes("[redacted chars=16]"), true);
});

test("legacy writeLogLine still writes through the structured logger", () => {
  const destination = createMemoryDestination();
  const logger = createTillerLogger({
    logsDir: ".",
    level: "debug",
    destination,
    console: { log() {}, debug() {}, warn() {}, error() {} },
  });

  logger.writeLogLine("WARN", "legacy warning");

  const line = destination.lines.find((line) => line.includes("legacy warning"));
  assert.ok(line);
  assert.equal(JSON.parse(line).level, "warn");
});

test("pretty format writes human-readable event lines", () => {
  const destination = createMemoryDestination();
  const logger = createTillerLogger({
    logsDir: ".",
    level: "info",
    format: "pretty",
    destination,
    console: { log() {}, debug() {}, warn() {}, error() {} },
  });

  logger.info("runtime.started", { sessionId: "session-1" });
  logger.close();

  const joined = destination.lines.join("\n");
  assert.match(joined, /runtime\.started/);
  assert.match(joined, /sessionId/);
  assert.match(joined, /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/u);
  assert.doesNotMatch(joined, /\+\d{4}/u);
  assert.doesNotMatch(joined, /\d{2}:\d{2}:\d{2}[.\s]\d{3}/u);
  assert.doesNotMatch(joined, /"event"/u);
  assert.doesNotMatch(joined, /"format"/u);
  assert.equal(joined.trimStart().startsWith("{"), false);
});

test("pretty console mirror avoids duplicate legacy console output", () => {
  const destination = createMemoryDestination();
  const consoleDestination = createMemoryDestination();
  const consoleLines: string[] = [];
  const logger = createTillerLogger({
    logsDir: ".",
    level: "info",
    format: "pretty",
    destination,
    consoleDestination,
    console: {
      log(message) {
        consoleLines.push(String(message));
      },
      debug(message) {
        consoleLines.push(String(message));
      },
      warn(message) {
        consoleLines.push(String(message));
      },
      error(message) {
        consoleLines.push(String(message));
      },
    },
  });

  logger.logInfo("[tiller] runtime ready");
  logger.close();

  const fileOutput = destination.lines.join("\n");
  const consoleOutput = consoleDestination.lines.join("\n");
  assert.match(fileOutput, /runtime ready/);
  assert.match(consoleOutput, /runtime ready/);
  assert.doesNotMatch(fileOutput, /legacy\.info/u);
  assert.doesNotMatch(consoleOutput, /legacy\.info/u);
  assert.doesNotMatch(fileOutput, /\[tiller\]/u);
  assert.doesNotMatch(consoleOutput, /\[tiller\]/u);
  assert.doesNotMatch(fileOutput, /"event"/u);
  assert.doesNotMatch(consoleOutput, /"event"/u);
  assert.doesNotMatch(fileOutput, /"message"/u);
  assert.doesNotMatch(consoleOutput, /"message"/u);
  assert.deepEqual(consoleLines, []);
});

test("pretty console mirror writes structured fields as plain json", () => {
  const destination = createMemoryDestination();
  const consoleDestination = createMemoryDestination();
  const logger = createTillerLogger({
    logsDir: ".",
    level: "info",
    format: "pretty",
    destination,
    consoleDestination,
    console: { log() {}, debug() {}, warn() {}, error() {} },
  });

  logger.info("session.resume.completed", { sessionId: "session-1" });
  logger.info("session.resume.checked", { sessionId: "session-1" });
  logger.close();

  const fileOutput = destination.lines.join("\n");
  const consoleOutput = consoleDestination.lines.join("\n");
  const rawConsoleOutput = consoleDestination.chunks.join("");
  assert.match(fileOutput, /session\.resume\.completed/);
  assert.match(fileOutput, /sessionId/);
  assert.match(consoleOutput, /session\.resume\.completed/);
  assert.match(consoleOutput, /session\.resume\.checked/);
  assert.match(consoleOutput, /"sessionId":"session-1"/);
  assert.match(rawConsoleOutput, /session\.resume\.completed \{[^\n]+\}\n\[/u);
  assert.doesNotMatch(rawConsoleOutput, /\u001B\[/u);
});

test("pretty console mirror renders simple server and update events as readable text", () => {
  const destination = createMemoryDestination();
  const consoleDestination = createMemoryDestination();
  const logger = createTillerLogger({
    logsDir: ".",
    level: "info",
    format: "pretty",
    destination,
    consoleDestination,
    console: { log() {}, debug() {}, warn() {}, error() {} },
  });

  logger.info("server.deck_available", { url: "http://127.0.0.1:47631" });
  logger.warn("updates.latest_available", {
    current: "0.0.0-dev",
    latest: "0.1.5",
    command: "npm install -g @qianshe/tiller@latest",
  });
  logger.close();

  const fileOutput = destination.lines.join("\n");
  const consoleOutput = consoleDestination.lines.join("\n");
  assert.match(fileOutput, /server\.deck_available/);
  assert.match(fileOutput, /"url":"http:\/\/127\.0\.0\.1:47631"/);
  assert.match(consoleOutput, /Deck available at http:\/\/127\.0\.0\.1:47631/);
  assert.match(consoleOutput, /Update available: 0\.0\.0-dev -> 0\.1\.5/);
  assert.match(consoleOutput, /Run: npm install -g @qianshe\/tiller@latest/);
  assert.doesNotMatch(consoleOutput, /server\.deck_available/u);
  assert.doesNotMatch(consoleOutput, /updates\.latest_available/u);
  assert.doesNotMatch(consoleOutput, /"url"/u);
  assert.doesNotMatch(consoleOutput, /"current"/u);
});
