import assert from "node:assert/strict";
import test from "node:test";
import { resolveToolCallChangeStats } from "./tool-call-change-stats.js";

test("resolveToolCallChangeStats uses explicit per-call counts", () => {
  assert.deepEqual(
    resolveToolCallChangeStats(
      "write",
      JSON.stringify({ path: "src/app.ts", additions: 3, deletions: 1 }),
      "",
    ),
    { additions: 3, deletions: 1 },
  );
});

test("resolveToolCallChangeStats counts a structured replacement", () => {
  assert.deepEqual(
    resolveToolCallChangeStats(
      "write",
      JSON.stringify({
        path: "src/app.ts",
        old_string: "const value = 1;",
        new_string: "const value = 2;",
      }),
      "",
    ),
    { additions: 1, deletions: 1 },
  );
});

test("resolveToolCallChangeStats reads unified patches from nested provider metadata", () => {
  assert.deepEqual(
    resolveToolCallChangeStats(
      "write",
      "",
      JSON.stringify({
        metadata: {
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new\n+next",
        },
      }),
    ),
    { additions: 2, deletions: 1 },
  );
});

test("resolveToolCallChangeStats counts successful Codex ACP apply_patch lines", () => {
  const updateCommand = "$patch = \"*** Begin Patch`n*** Update File: .codex-native-edit-test.txt`n@@`n-phase=create`n-status=temporary`n+phase=edited`n+status=verified`n*** End Patch\"; & 'F:\\devData\\codex-acp.exe' --codex-run-as-apply-patch $patch";
  const addCommand = "$patch = \"*** Begin Patch`n*** Add File: .codex-native-edit-test.txt`n+phase=create`n+status=temporary`n*** End Patch\"; & 'F:\\devData\\codex-acp.exe' --codex-run-as-apply-patch $patch";

  for (const [command, expected] of [
    [updateCommand, { additions: 2, deletions: 2 }],
    [addCommand, { additions: 2, deletions: 0 }],
  ] as const) {
    assert.deepEqual(
      resolveToolCallChangeStats(
        "write",
        JSON.stringify({
          command: ["pwsh.exe", "-Command", command],
          parsed_cmd: [{ type: "unknown", cmd: command }],
        }),
        JSON.stringify({
          stdout: "Success. Updated the following files:\nM .codex-native-edit-test.txt\n",
          status: "completed",
        }),
      ),
      expected,
    );
  }
});

test("resolveToolCallChangeStats ignores failed or uncountable Codex ACP patches", () => {
  const failedUpdate = "$patch = \"*** Begin Patch`n*** Update File: src/app.ts`n@@`n-old`n+new`n*** End Patch\"; apply_patch $patch";
  const successfulDelete = "$patch = \"*** Begin Patch`n*** Delete File: src/app.ts`n*** End Patch\"; apply_patch $patch";

  assert.equal(
    resolveToolCallChangeStats(
      "write",
      JSON.stringify({ parsed_cmd: [{ cmd: failedUpdate }] }),
      JSON.stringify({ stderr: "Invalid patch", status: "failed" }),
    ),
    undefined,
  );
  assert.equal(
    resolveToolCallChangeStats(
      "write",
      JSON.stringify({ parsed_cmd: [{ cmd: successfulDelete }] }),
      JSON.stringify({
        stdout: "Success. Updated the following files:\nD src/app.ts\n",
        status: "completed",
      }),
    ),
    undefined,
  );
});

test("resolveToolCallChangeStats counts a provider-confirmed file creation", () => {
  const content = [
    "# Native tool test",
    "",
    "Created by Claude.",
    "",
    "- marker: native-test-marker",
  ].join("\n");

  assert.deepEqual(
    resolveToolCallChangeStats(
      "write",
      JSON.stringify({ file_path: "native_test_file.md", content }),
      `[]${JSON.stringify([{
        type: "diff",
        path: "native_test_file.md",
        oldText: null,
        newText: content,
      }])}File created successfully`,
    ),
    { additions: 5, deletions: 0 },
  );
});

test("resolveToolCallChangeStats does not guess from cumulative state or non-write calls", () => {
  assert.equal(
    resolveToolCallChangeStats(
      "write",
      JSON.stringify({ path: "src/app.ts", content: "full file body" }),
      "written",
    ),
    undefined,
  );
  assert.equal(
    resolveToolCallChangeStats(
      "read",
      JSON.stringify({ additions: 3, deletions: 1 }),
      "",
    ),
    undefined,
  );
});
