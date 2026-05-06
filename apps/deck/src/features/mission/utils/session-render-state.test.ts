import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectFileSummary } from "@tiller/shared";
import { resolveVisibleProjectFiles } from "./session-render-state.js";

function entry(path: string, kind: ProjectFileSummary["kind"]): ProjectFileSummary {
  return { path, kind } as ProjectFileSummary;
}

test("project file tree defaults directories to collapsed", () => {
  const files = [
    entry("README.md", "file"),
    entry("src", "directory"),
    entry("src/app.ts", "file"),
    entry("src/features", "directory"),
    entry("src/features/chat.ts", "file"),
  ];

  assert.deepEqual(
    resolveVisibleProjectFiles(files, "", new Set()).map((file) => file.path),
    ["README.md", "src"],
  );
});

test("project file tree reveals only children of expanded directories", () => {
  const files = [
    entry("src", "directory"),
    entry("src/app.ts", "file"),
    entry("src/features", "directory"),
    entry("src/features/chat.ts", "file"),
  ];

  assert.deepEqual(
    resolveVisibleProjectFiles(files, "", new Set(["src"])).map(
      (file) => file.path,
    ),
    ["src", "src/app.ts", "src/features"],
  );
});

test("project file search ignores collapsed tree state", () => {
  const files = [
    entry("src", "directory"),
    entry("src/features/chat.ts", "file"),
  ];

  assert.deepEqual(
    resolveVisibleProjectFiles(files, "chat", new Set()).map((file) => file.path),
    ["src/features/chat.ts"],
  );
});
