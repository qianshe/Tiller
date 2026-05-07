import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspaceSource = readFileSync(resolve(currentDir, "workspace.tsx"), "utf8");
const chatPaneSource = readFileSync(resolve(currentDir, "chat-pane.tsx"), "utf8");
const plainMessagesSource = readFileSync(resolve(currentDir, "plain-messages.tsx"), "utf8");

test("mission chat reserves permission drawer space through localized drawer positioning", () => {
  const permissionDrawerSource = readFileSync(resolve(currentDir, "permission-drawer.tsx"), "utf8");

  assert.match(permissionDrawerSource, /bottom-\[var\(--mission-permission-composer-offset,190px\)\]/);
  assert.doesNotMatch(chatPaneSource, /padding-bottom:\s*170px/);
});

test("markdown table wrapper keeps horizontal scrolling without generic overflow CSS", () => {
  assert.match(plainMessagesSource, /\[&_\.markdown-table-scroll\]:overflow-x-auto/);
  assert.match(plainMessagesSource, /\[&_\.markdown-table-scroll\]:overflow-y-hidden/);
  assert.doesNotMatch(plainMessagesSource, /plain-assistant[^\n]+overflow-x-visible/);
});

test("collapsed plain-text user messages use a three-line visual clamp without an overlay", () => {
  assert.match(plainMessagesSource, /plain-message-text-collapsed line-clamp-3 overflow-hidden/);
  assert.doesNotMatch(plainMessagesSource, /plain-message-body-collapsed::after/);
});

test("assistant markdown paragraphs render with a green marker without shifting the whole message block", () => {
  assert.doesNotMatch(plainMessagesSource, /margin-left:\s*-0\.45rem/);
  assert.match(plainMessagesSource, /\[&_blockquote\]:ml-4/);
  assert.match(plainMessagesSource, /\[&_\.markdown-paragraph\]:pl-4/);
  assert.match(plainMessagesSource, /\[&_\.markdown-paragraph\]:before:left-1/);
  assert.match(plainMessagesSource, /\[&_\.markdown-paragraph\]:before:bg-green-500/);
  assert.match(plainMessagesSource, /\[&_\.markdown-paragraph-thinking\]:italic/);
});

test("mission workspace uses Tailwind pane layout instead of feature css", () => {
  assert.match(workspaceSource, /grid-cols-\[minmax\(220px,22%\)_6px_minmax\(0,1fr\)_6px_minmax\(280px,24%\)\]/);
  assert.match(workspaceSource, /mission-sidebar-collapsed/);
  assert.match(workspaceSource, /mission-inspector-collapsed/);
});
