import assert from "node:assert/strict";
import test from "node:test";
import { classifyStructuredFileOperation } from "./file-operation";

test("structured file operation recognition supports common ACP path shapes", () => {
  const cases = [
    [{ path: "src/index.ts" }, { kind: "read", path: "src/index.ts" }],
    [{ file_path: "src/legacy.ts" }, { kind: "read", path: "src/legacy.ts" }],
    [{ filePath: "src/camel.ts" }, { kind: "read", path: "src/camel.ts" }],
    [{ relative_path: "src/snake.ts" }, { kind: "read", path: "src/snake.ts" }],
    [{ relativePath: "src/relative.ts" }, { kind: "read", path: "src/relative.ts" }],
    [{ path: "src/edit.ts", repl: "next" }, { kind: "write", path: "src/edit.ts" }],
  ] as const;

  for (const [input, expected] of cases) {
    assert.deepEqual(classifyStructuredFileOperation(input), expected);
  }
  assert.equal(classifyStructuredFileOperation({ command: "pnpm test" }), null);
});
