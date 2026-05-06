import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const workspaceCssPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "workspace/workbench-layout.css",
);
const overflowCssPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "message-timeline/overflow.css",
);

test("mission chat only reserves large bottom space when the permission drawer is visible", () => {
  const source = readFileSync(workspaceCssPath, "utf8");

  assert.match(
    source,
    /\.chat-conversation:has\(\.mission-permission-drawer\)\s*\{\s*--mission-chat-bottom-reserve:\s*170px;/s,
  );
  assert.doesNotMatch(
    source,
    /\.view-sessions \.chat-main\s*\{[^}]*padding-bottom:\s*170px;/s,
  );
});

test("markdown table wrapper opts out of the generic overflow clip rule", () => {
  const source = readFileSync(overflowCssPath, "utf8");

  assert.match(
    source,
    /\.markdown-message > \.markdown-table-scroll\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/s,
  );
});
