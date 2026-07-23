import assert from "node:assert/strict";
import test from "node:test";
import type { FileDiffSummary } from "@tiller/shared";
import {
  DIFF_PATCH_PREVIEW_CHARS,
  MAX_INLINE_DIFF_PATCH_BYTES,
  materializeDiffPayloads,
} from "./diff-payload.js";

test("materializeDiffPayloads externalizes oversized patches and keeps a bounded preview", () => {
  const writes: Array<{ sessionId: string; path: string; text: string }> = [];
  const diffs = materializeDiffPayloads(
    "session-1",
    [{
      path: "large.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "x".repeat(MAX_INLINE_DIFF_PATCH_BYTES + 1),
    }],
    {
      putText: (input) => {
        writes.push(input);
        return {
          id: "diff-1",
          sessionId: input.sessionId,
          path: input.path,
          mimeType: "text/plain; charset=utf-8",
          sha256: "sha256",
          byteSize: Buffer.byteLength(input.text, "utf8"),
          storageKey: "storage-key",
          uri: "/api/sessions/session-1/diffs/large.ts",
          createdAt: "2026-07-12T00:00:00.000Z",
        };
      },
      get: () => undefined,
      readText: () => undefined,
      removeSession: () => undefined,
    },
  );

  assert.equal(writes.length, 1);
  assert.equal(diffs[0]?.patch?.length, DIFF_PATCH_PREVIEW_CHARS);
  assert.equal(diffs[0]?.patchTruncated, true);
  assert.deepEqual(diffs[0]?.patchRef, {
    id: "diff-1",
    uri: "/api/sessions/session-1/diffs/large.ts",
    mimeType: "text/plain; charset=utf-8",
    byteSize: MAX_INLINE_DIFF_PATCH_BYTES + 1,
    sha256: "sha256",
  });
});

test("materializeDiffPayloads externalizes later patches after the live snapshot budget", () => {
  const writes: string[] = [];
  const patch = "x".repeat(8 * 1024);
  const files: FileDiffSummary[] = Array.from({ length: 33 }, (_, index) => ({
    path: `file-${index}.ts`,
    status: "modified",
    additions: 1,
    deletions: 0,
    patch,
  }));
  const diffs = materializeDiffPayloads("session-1", files, {
    putText: (input) => {
      writes.push(input.path);
      return {
        id: input.path,
        sessionId: input.sessionId,
        path: input.path,
        mimeType: "text/plain; charset=utf-8",
        sha256: "sha256",
        byteSize: Buffer.byteLength(input.text, "utf8"),
        storageKey: input.path,
        uri: `/api/sessions/session-1/diffs/${input.path}`,
        createdAt: "2026-07-12T00:00:00.000Z",
      };
    },
    get: () => undefined,
    readText: () => undefined,
    removeSession: () => undefined,
  });

  assert.equal(diffs.filter((diff) => diff.patchTruncated).length, 1);
  assert.deepEqual(writes, ["file-32.ts"]);
});
