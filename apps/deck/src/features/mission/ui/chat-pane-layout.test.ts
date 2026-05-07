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
const threadSidebarCssPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "sidebar/thread-sidebar.css",
);
const displayPanelCssPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "display-panel/styles.css",
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
  assert.doesNotMatch(
    source,
    /\.plain-assistant \.markdown-message > \.markdown-paragraph\s*\{[^}]*overflow-x:\s*visible;/s,
  );
});

test("collapsed plain-text user messages use a three-line visual clamp without an overlay", () => {
  const source = readFileSync(threadSidebarCssPath, "utf8");

  assert.match(
    source,
    /\.plain-message-text-collapsed\s*\{[^}]*display:\s*-webkit-box;[^}]*-webkit-line-clamp:\s*3;[^}]*overflow:\s*hidden;/s,
  );
  assert.doesNotMatch(source, /\.plain-message-body-collapsed::after/s);
});

test("assistant markdown paragraphs render with a green marker without shifting the whole message block", () => {
  const source = readFileSync(displayPanelCssPath, "utf8");

  assert.doesNotMatch(
    source,
    /\.plain-assistant \.markdown-message\s*\{[^}]*margin-left:\s*-0\.45rem;/s,
  );
  assert.match(
    source,
    /\.plain-assistant \.markdown-message > :where\(\.markdown-table-scroll, ul, ol, pre, blockquote\)\s*\{[^}]*margin-left:\s*0\.95rem;/s,
  );
  assert.match(
    source,
    /\.plain-assistant \.markdown-message > \.markdown-paragraph\s*\{[^}]*padding-left:\s*0\.95rem;/s,
  );
  assert.match(
    source,
    /\.plain-assistant \.markdown-message > \.markdown-paragraph::before\s*\{[^}]*left:\s*0\.2rem;[^}]*background:\s*#22c55e;/s,
  );
  assert.match(
    source,
    /\.plain-assistant \.markdown-message > \.markdown-paragraph-thinking\s*\{[^}]*font-style:\s*italic;/s,
  );
});
