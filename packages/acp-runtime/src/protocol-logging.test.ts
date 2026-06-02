import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createProtocolLogSink } from "./protocol-logging";

function withTempDir(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "tiller-acp-log-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("summary protocol logging redacts payload content and chunk text", () => {
  withTempDir((dir) => {
    const sink = createProtocolLogSink({
      mode: "summary",
      logsDir: dir,
      filePrefix: "protocol",
      token: "agent one",
    });

    sink.writeProtocol("stdout", {
      method: "session/update",
      params: {
        content: "SECRET_PAYLOAD",
        nested: { text: "HIDDEN_TEXT" },
      },
    });
    sink.writeChunk("stderr", "SECRET_STDERR\n");

    assert.ok(sink.logFile);
    const log = readFileSync(sink.logFile, "utf8");
    assert.match(log, /"content":"\[redacted chars=14\]"/u);
    assert.match(log, /"text":"\[redacted chars=11\]"/u);
    assert.match(log, /chunk chars=14/u);
    assert.doesNotMatch(log, /SECRET_PAYLOAD|HIDDEN_TEXT|SECRET_STDERR/u);
  });
});

test("raw protocol logging keeps explicit raw payload and chunks", () => {
  withTempDir((dir) => {
    const sink = createProtocolLogSink({
      mode: "raw",
      logsDir: dir,
      filePrefix: "protocol",
      token: "agent one",
    });

    sink.writeProtocol("stdout", { params: { content: "RAW_PAYLOAD" } });
    sink.writeChunk("stderr", "RAW_STDERR\n");

    assert.ok(sink.logFile);
    const log = readFileSync(sink.logFile, "utf8");
    assert.match(log, /RAW_PAYLOAD/u);
    assert.match(log, /RAW_STDERR\\n/u);
  });
});

test("off protocol logging does not create a log file", () => {
  withTempDir((dir) => {
    const sink = createProtocolLogSink({
      mode: "off",
      logsDir: dir,
      filePrefix: "protocol",
      token: "agent one",
    });

    sink.writeProtocol("stdout", { params: { content: "IGNORED" } });
    sink.writeChunk("stderr", "IGNORED\n");

    assert.equal(sink.logFile, undefined);
    assert.equal(existsSync(join(dir, "protocol-agent-one.log")), false);
  });
});
