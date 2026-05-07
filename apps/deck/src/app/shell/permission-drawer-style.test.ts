import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deckRoot = resolve(currentDir, "../../..");
const permissionDrawerSource = readFileSync(
  resolve(deckRoot, "src/features/mission/ui/permission-drawer.tsx"),
  "utf8",
);

test("mission permission drawer keeps three compact rows visible", () => {
  assert.match(permissionDrawerSource, /grid-rows-\[auto_auto_auto\]/);
  assert.match(permissionDrawerSource, /absolute/);
  assert.match(permissionDrawerSource, /bottom-\[var\(--mission-permission-composer-offset,190px\)\]/);
  assert.match(permissionDrawerSource, /-translate-x-1\/2/);
  assert.match(permissionDrawerSource, /z-30/);
  assert.match(permissionDrawerSource, /overflow-visible/);
  assert.match(permissionDrawerSource, /mission-permission-copy[^\n]+overflow-visible/);
  assert.match(permissionDrawerSource, /mission-permission-actions[^\n]+items-center/);
  assert.match(permissionDrawerSource, /mission-permission-actions[^\n]+pb-0/);
});

test("permission drawer path stays on a single second row", () => {
  assert.match(permissionDrawerSource, /mission-permission-header[^\n]+gap-1/);
  assert.match(permissionDrawerSource, /mission-permission-title[^\n]+text-\[0\.98rem\]/);
  assert.match(permissionDrawerSource, /mission-permission-title[^\n]+break-words/);
  assert.match(permissionDrawerSource, /mission-permission-workspace[^\n]+truncate/);
});

test("permission drawer detail block keeps raw approval payload readable", () => {
  assert.match(permissionDrawerSource, /mission-permission-detail[^\n]+font-mono/);
  assert.match(permissionDrawerSource, /mission-permission-detail[^\n]+whitespace-pre-wrap/);
  assert.match(permissionDrawerSource, /mission-permission-detail[^\n]+break-words/);
  assert.match(permissionDrawerSource, /mission-permission-reason[^\n]+text-xs/);
  assert.match(permissionDrawerSource, /min-w-\[72px\]/);
  assert.match(permissionDrawerSource, /min-h-8/);
  assert.match(permissionDrawerSource, /px-3/);
  assert.match(permissionDrawerSource, /py-1\.5/);
  assert.match(permissionDrawerSource, /shadow-none/);
});

test("mission light theme critical surfaces use semantic Tailwind tokens", () => {
  const files = [
    "src/features/mission/ui/workspace.tsx",
    "src/features/mission/ui/chat-pane.tsx",
    "src/features/mission/ui/inspector.tsx",
    "src/features/mission/ui/composer.tsx",
    "src/features/mission/ui/display-panel.tsx",
    "src/features/mission/ui/session-overview-card.tsx",
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
