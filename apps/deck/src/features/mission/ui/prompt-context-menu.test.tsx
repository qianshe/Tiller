import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MissionPromptContextItem } from "@tiller/shared";
import { PromptContextMenu } from "./prompt-context-menu";

const currentDir = dirname(fileURLToPath(import.meta.url));
const promptContextMenuSource = readFileSync(
  resolve(currentDir, "./prompt-context-menu.tsx"),
  "utf8",
);

const CONTEXT: MissionPromptContextItem = {
  id: "quote-1",
  kind: "quote",
  label: "assistant 引用",
  comment: "检查这段",
  excerpt: "详细引用内容不在菜单条目中展示",
  source: { kind: "quote", messageId: "message-1", role: "assistant" },
};

test("prompt context menu keeps the shared upward floating menu compact", () => {
  const html = renderToStaticMarkup(createElement(PromptContextMenu, {
    contexts: [CONTEXT],
    resolveTitle: (item) => item.label,
  }));

  assert.match(html, /aria-label="评论 1，展开查看"/u);
  assert.match(html, /aria-expanded="false"/u);
  assert.doesNotMatch(html, /详细引用内容不在菜单条目中展示/u);
  assert.match(promptContextMenuSource, /side="top"/u);
  assert.match(promptContextMenuSource, /avoidCollisions=\{false\}/u);
  assert.match(promptContextMenuSource, /collisionBoundary=\{collisionBoundary \?\? undefined\}/u);
  assert.match(promptContextMenuSource, /collisionPadding=\{8\}/u);
  assert.match(promptContextMenuSource, /max-w-\[var\(--radix-dropdown-menu-content-available-width\)\]/u);
  assert.doesNotMatch(promptContextMenuSource, /DropdownMenuLabel|DropdownMenuSeparator/u);
  assert.match(promptContextMenuSource, /gap-0 py-1 text-xs/u);
  assert.match(promptContextMenuSource, /text-2xs leading-3 text-muted-foreground/u);
  assert.doesNotMatch(promptContextMenuSource, /item\.excerpt/u);
});
