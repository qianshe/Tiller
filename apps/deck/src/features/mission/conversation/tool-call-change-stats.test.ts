import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveToolCallChangeStats,
  resolveToolCallDiff,
} from "./tool-call-change-stats.js";

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
  const output = JSON.stringify({
    metadata: {
      path: "src/app.ts",
      diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new\n+next",
    },
  });
  assert.deepEqual(
    resolveToolCallChangeStats(
      "write",
      "",
      output,
    ),
    { additions: 2, deletions: 1 },
  );
  assert.deepEqual(resolveToolCallDiff("write", "", output), {
    path: "src/app.ts",
    patch: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new\n+next",
  });
});

test("resolveToolCallChangeStats aggregates Codex ACP diff content arrays", () => {
  const output = JSON.stringify([
    {
      type: "diff",
      path: "src/updated.ts",
      oldText: "keep\nold\n",
      newText: "keep\nnew\nextra\n",
    },
    {
      type: "diff",
      path: "src/created.ts",
      oldText: null,
      newText: "first\nsecond\n",
    },
  ]);

  assert.deepEqual(
    resolveToolCallChangeStats("write", "", output),
    { additions: 4, deletions: 1 },
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

test("resolveToolCallDiff builds display patches for supported Write inputs", () => {
  assert.deepEqual(
    resolveToolCallDiff(
      "write",
      JSON.stringify({
        path: "src/app.ts",
        old_string: "const value = 1;",
        new_string: "const value = 2;",
      }),
      "",
    ),
    {
      path: "src/app.ts",
      patch: "@@ -1,1 +1,1 @@\n-const value = 1;\n+const value = 2;",
    },
  );

  const command = "$patch = \"*** Begin Patch`n*** Update File: src/app.ts`n@@`n-old`n+new`n*** End Patch\"; & 'F:\\devData\\codex-acp.exe' --codex-run-as-apply-patch $patch";
  assert.deepEqual(
    resolveToolCallDiff(
      "write",
      JSON.stringify({ parsed_cmd: [{ cmd: command }] }),
      JSON.stringify({
        stdout: "Success. Updated the following files:\nM src/app.ts\n",
      }),
    ),
    {
      path: "src/app.ts",
      patch: "@@\n-old\n+new",
    },
  );
});

test("resolveToolCallDiff does not invent content from counts or failed writes", () => {
  assert.equal(
    resolveToolCallDiff(
      "write",
      JSON.stringify({ path: "src/app.ts", additions: 4, deletions: 2 }),
      "",
    ),
    undefined,
  );

  const command = "$patch = \"*** Begin Patch`n*** Update File: src/app.ts`n@@`n-old`n+new`n*** End Patch\"; apply_patch $patch";
  assert.equal(
    resolveToolCallDiff(
      "write",
      JSON.stringify({ parsed_cmd: [{ cmd: command }] }),
      JSON.stringify({ stderr: "Invalid patch", status: "failed" }),
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

  const input = JSON.stringify({ file_path: "native_test_file.md", content });
  const output = `[]${JSON.stringify([{
    type: "diff",
    path: "native_test_file.md",
    oldText: null,
    newText: content,
  }])}File created successfully`;

  assert.deepEqual(
    resolveToolCallChangeStats(
      "write",
      input,
      output,
    ),
    { additions: 5, deletions: 0 },
  );
  assert.deepEqual(resolveToolCallDiff("write", input, output), {
    path: "native_test_file.md",
    patch: [
      "+# Native tool test",
      "+",
      "+Created by Claude.",
      "+",
      "+- marker: native-test-marker",
    ].join("\n"),
  });
});

test("resolveToolCallChangeStats recognizes an OpenCode Write file creation", () => {
  const content = [
    "# OpenCode test",
    "",
    "Created by Write.",
  ].join("\n");
  const input = JSON.stringify({
    filePath: "docs/opencode-write-test.md",
    content,
  });
  const output = JSON.stringify({
    output: "Wrote file successfully.",
    metadata: {
      filepath: "D:/myProject/tools/Tiller/docs/opencode-write-test.md",
      exists: false,
      diagnostics: {},
    },
  });

  assert.deepEqual(
    resolveToolCallChangeStats("write", input, output),
    { additions: 3, deletions: 0 },
  );
  assert.deepEqual(resolveToolCallDiff("write", input, output), {
    path: "docs/opencode-write-test.md",
    patch: "+# OpenCode test\n+\n+Created by Write.",
  });
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
