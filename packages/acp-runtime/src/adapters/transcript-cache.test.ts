import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCachedTranscriptParser } from "./transcript-cache";

test("createCachedTranscriptParser reuses unchanged parsed transcripts", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-transcript-cache-"));
  const transcriptPath = join(tempDir, "session.jsonl");
  writeFileSync(transcriptPath, "first", "utf8");
  let pathResolutions = 0;
  let parseCalls = 0;
  const readTranscript = createCachedTranscriptParser<{ sessionId: string }, string>({
    cacheKey: (context) => context.sessionId,
    resolvePath: () => {
      pathResolutions += 1;
      return transcriptPath;
    },
    parse: (raw) => {
      parseCalls += 1;
      return raw;
    },
  });

  try {
    assert.equal(readTranscript({ sessionId: "session-1" }), "first");
    assert.equal(readTranscript({ sessionId: "session-1" }), "first");
    assert.equal(pathResolutions, 1);
    assert.equal(parseCalls, 1);

    writeFileSync(transcriptPath, "second version", "utf8");

    assert.equal(readTranscript({ sessionId: "session-1" }), "second version");
    assert.equal(pathResolutions, 1);
    assert.equal(parseCalls, 2);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("createCachedTranscriptParser evicts the least recently used transcript", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-transcript-cache-"));
  const paths = new Map([
    ["session-1", join(tempDir, "session-1.jsonl")],
    ["session-2", join(tempDir, "session-2.jsonl")],
    ["session-3", join(tempDir, "session-3.jsonl")],
  ]);
  for (const [sessionId, path] of paths) {
    writeFileSync(path, sessionId, "utf8");
  }
  let parseCalls = 0;
  const readTranscript = createCachedTranscriptParser<{ sessionId: string }, string>({
    cacheKey: (context) => context.sessionId,
    resolvePath: (context) => paths.get(context.sessionId),
    parse: (raw) => {
      parseCalls += 1;
      return raw;
    },
    maxEntries: 2,
  });

  try {
    assert.equal(readTranscript({ sessionId: "session-1" }), "session-1");
    assert.equal(readTranscript({ sessionId: "session-2" }), "session-2");
    assert.equal(readTranscript({ sessionId: "session-1" }), "session-1");
    assert.equal(readTranscript({ sessionId: "session-3" }), "session-3");
    assert.equal(readTranscript({ sessionId: "session-1" }), "session-1");
    assert.equal(readTranscript({ sessionId: "session-2" }), "session-2");
    assert.equal(parseCalls, 4);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});
