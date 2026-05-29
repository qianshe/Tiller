import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deckRoot = resolve(currentDir, "../../..");
const permissionDrawerSource = readFileSync(
  resolve(deckRoot, "src/features/mission/conversation/permission-drawer.tsx"),
  "utf8",
);
const shellStylesSource = readFileSync(resolve(currentDir, "styles.css"), "utf8");

test("mission permission drawer uses an in-pane solid elevated review card", () => {
  assert.match(permissionDrawerSource, /grid-rows-\[auto_auto\]/);
  assert.match(permissionDrawerSource, /sticky/);
  assert.match(permissionDrawerSource, /top-2/);
  assert.doesNotMatch(permissionDrawerSource, /bottom-2/);
  assert.match(permissionDrawerSource, /z-30/);
  assert.doesNotMatch(permissionDrawerSource, /absolute/);
  assert.doesNotMatch(permissionDrawerSource, /bottom-\[calc\(var\(--mission-permission-composer-offset,190px\)\+24px\)\]/);
  assert.doesNotMatch(shellStylesSource, /\.mission-responsive-mode \.mission-permission-drawer/);
  assert.doesNotMatch(permissionDrawerSource, /left-3/);
  assert.doesNotMatch(permissionDrawerSource, /right-3/);
  assert.doesNotMatch(permissionDrawerSource, /sm:right-auto/);
  assert.doesNotMatch(permissionDrawerSource, /sm:w-\[min\(560px,calc\(100%-1\.5rem\)\)\]/);
  assert.match(permissionDrawerSource, /border-warning\/40/);
  assert.match(permissionDrawerSource, /bg-surface-elevated/);
  assert.match(permissionDrawerSource, /shadow-ambient/);
  assert.doesNotMatch(permissionDrawerSource, /bg-popover-glass/);
  assert.doesNotMatch(permissionDrawerSource, /backdrop-blur/);
});

test("permission drawer path and actions stay within the chat pane", () => {
  assert.match(permissionDrawerSource, /mission-permission-header[^\n]+grid-cols-\[auto_minmax\(0,1fr\)\]/);
  assert.match(permissionDrawerSource, /mission-permission-title[^\n]+overflow-hidden/);
  assert.match(permissionDrawerSource, /mission-permission-title[^\n]+text-ellipsis/);
  assert.match(permissionDrawerSource, /mission-permission-worktree[^\n]+break-all/);
  assert.match(permissionDrawerSource, /mission-permission-actions[^\n]+flex-wrap/);
});

test("permission drawer detail block keeps raw approval payload readable", () => {
  assert.match(permissionDrawerSource, /mission-permission-detail[^\n]+font-mono/);
  assert.match(permissionDrawerSource, /mission-permission-detail[^\n]+max-h-28/);
  assert.match(permissionDrawerSource, /mission-permission-detail[^\n]+overflow-hidden/);
  assert.match(permissionDrawerSource, /mission-permission-detail[^\n]+bg-surface-sunken/);
  assert.match(permissionDrawerSource, /<pre className="[^"]*overflow-auto[^"]*whitespace-pre-wrap[^"]*break-all/);
  assert.match(permissionDrawerSource, /mission-permission-reason[^\n]+text-xs/);
  assert.match(permissionDrawerSource, /min-w-\[72px\]/);
  assert.match(permissionDrawerSource, /min-h-8/);
  assert.match(permissionDrawerSource, /px-3/);
  assert.match(permissionDrawerSource, /py-1\.5/);
  assert.match(permissionDrawerSource, /shadow-none/);
});

test("mission light theme critical surfaces use semantic Tailwind tokens", () => {
  const files = [
    "src/features/mission/workspace/workspace.tsx",
    "src/features/mission/conversation/chat-pane.tsx",
    "src/features/mission/inspector/inspector.tsx",
    "src/features/mission/composer/composer.tsx",
    "src/features/mission/display/display-panel.tsx",
    "src/features/mission/display/session-overview-card.tsx",
    "src/features/logbook/ui/activity-log-panel.tsx",
  ].map((relativePath) => readFileSync(resolve(deckRoot, relativePath), "utf8"));
  const combined = files.join("\n");

  assert.match(combined, /bg-surface/);
  assert.match(combined, /bg-surface-sunken/);
  assert.match(combined, /text-foreground/);
  assert.match(combined, /text-muted-foreground/);
  assert.match(combined, /border-border-ghost/);
  assert.match(combined, /shadow-ambient|shadow-none/);
});