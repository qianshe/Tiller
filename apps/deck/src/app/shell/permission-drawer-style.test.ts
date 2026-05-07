import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readStyles(url: URL): string {
  const styles = readFileSync(url, "utf8");
  return styles.replace(
    /@import\s+["'](?<specifier>[^"']+)["'];/g,
    (_match, specifier: string) => readStyles(new URL(specifier, url)),
  );
}

const styles = readStyles(
  new URL("../../features/mission/styles.css", import.meta.url),
);

function readRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));
  assert.ok(match?.groups?.body, `Missing CSS rule for ${selector}`);
  return match.groups.body;
}

test("mission permission drawer keeps three compact rows visible", () => {
  const drawerRule = readRule(".mission-permission-drawer");
  const copyRule = readRule(".mission-permission-copy");
  const actionsRule = readRule(".mission-permission-actions");

  assert.match(drawerRule, /grid-template-rows\s*:\s*auto\s+auto\s+auto/);
  assert.match(drawerRule, /position\s*:\s*absolute/);
  assert.match(drawerRule, /bottom\s*:\s*var\(--mission-permission-composer-offset,\s*190px\)/);
  assert.match(drawerRule, /transform\s*:\s*translateX\(-50%\)/);
  assert.match(drawerRule, /z-index\s*:\s*31/);
  assert.match(drawerRule, /overflow\s*:\s*visible/);
  assert.match(copyRule, /overflow\s*:\s*visible/);
  assert.match(copyRule, /min-height\s*:\s*0/);
  assert.match(actionsRule, /align-self\s*:\s*stretch/);
  assert.match(actionsRule, /align-items\s*:\s*center/);
  assert.match(actionsRule, /padding-bottom\s*:\s*0/);
});

test("permission drawer path stays on a single second row", () => {
  const headerRule = readRule(".mission-permission-header");
  const titleRule = readRule(".mission-permission-title");
  const workspaceRule = styles.match(
    /(?:\r?\n){2}\.mission-permission-workspace\s*\{(?<body>[^}]*)\}/,
  );

  assert.match(headerRule, /gap\s*:\s*4px/);
  assert.match(titleRule, /font-size\s*:\s*0\.98rem/);
  assert.match(titleRule, /overflow-wrap\s*:\s*anywhere/);
  assert.ok(workspaceRule?.groups?.body, "Missing single-line workspace rule");
  assert.match(workspaceRule.groups.body, /text-overflow\s*:\s*ellipsis/);
  assert.match(workspaceRule.groups.body, /white-space\s*:\s*nowrap/);
});

test("permission drawer detail block keeps raw approval payload readable", () => {
  const detailRule = readRule(".mission-permission-detail");
  const metadataRule = styles.match(
    /\.mission-permission-reason,\s*\.mission-permission-workspace\s*\{(?<body>[^}]*)\}/,
  );
  const buttonRule = readRule(".mission-permission-actions button");

  assert.match(detailRule, /font-family\s*:\s*ui-monospace/);
  assert.match(detailRule, /white-space\s*:\s*pre-wrap/);
  assert.match(detailRule, /overflow-wrap\s*:\s*anywhere/);
  assert.ok(metadataRule?.groups?.body, "Missing compact permission metadata rule");
  assert.match(metadataRule.groups.body, /font-size\s*:\s*0\.78rem/);
  assert.match(buttonRule, /min-width\s*:\s*72px/);
  assert.match(buttonRule, /min-height\s*:\s*30px/);
  assert.match(buttonRule, /padding\s*:\s*5px\s+10px/);
  assert.match(buttonRule, /box-shadow\s*:\s*none/);
});

test("mission light theme overrides Zed dark workbench surfaces", () => {
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.chat-layout\.chat-layout-sidebar\s*\{(?<body>[^}]*)background\s*:\s*var\(--surface-sunken\)/,
  );
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.chat-conversation\s*\{(?<body>[^}]*)background\s*:\s*transparent/,
  );
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.mission-inspector\s*\{(?<body>[^}]*)background\s*:\s*var\(--surface\)/,
  );
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.project-nav-item,\s*\[data-deck-theme="light"\]\s+\.view-sessions\s+\.chat-session-item\s*\{(?<body>[^}]*)color\s*:\s*var\(--foreground\)/,
  );
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.mission-activity-log\s+\.tool-call-card\s*\{(?<body>[^}]*)background\s*:\s*var\(--surface\)/,
  );
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.mission-tree-main\s+strong\s*\{(?<body>[^}]*)color\s*:\s*var\(--foreground\)/,
  );
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.mission-order-editor\.chat-input-form\s*\{(?<body>[^}]*)background\s*:\s*var\(--surface\)/,
  );
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.mission-pane-resizer\s*\{(?<body>[^}]*)background\s*:\s*transparent/,
  );
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.mission-worktree-trigger,\s*\[data-deck-theme="light"\]\s+\.view-sessions\s+\.mission-agent-trigger,\s*\[data-deck-theme="light"\]\s+\.view-sessions\s+\.mission-config-trigger\s*\{(?<body>[^}]*)background\s*:\s*var\(--surface\)/,
  );
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.mission-worktree-menu,\s*\[data-deck-theme="light"\]\s+\.view-sessions\s+\.mission-agent-menu,\s*\[data-deck-theme="light"\]\s+\.view-sessions\s+\.mission-config-menu\s*\{(?<body>[^}]*)background\s*:\s*var\(--surface\)/,
  );
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.mission-tree-session-menu\s*\{(?<body>[^}]*)background\s*:\s*var\(--surface\)/,
  );
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.mission-display-panel\s*\{(?<body>[^}]*)background\s*:\s*transparent/,
  );
  assert.match(
    styles,
    /\.plain-assistant\s+\.markdown-message\s*>\s+\.markdown-paragraph::before\s*\{(?<body>[^}]*)left\s*:\s*0\.2rem/,
  );
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.session-overview-card\s*\{(?<body>[^}]*)background\s*:\s*var\(--surface\)/,
  );
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.session-overview-metric,\s*\[data-deck-theme="light"\]\s+\.view-sessions\s+\.session-overview-preview\s*\{(?<body>[^}]*)background\s*:\s*var\(--surface-elevated\)/,
  );
  assert.match(
    styles,
    /\[data-deck-theme="light"\]\s+\.view-sessions\s+\.session-overview-metric\s+strong,\s*\[data-deck-theme="light"\]\s+\.view-sessions\s+\.session-overview-preview\s+strong\s*\{(?<body>[^}]*)color\s*:\s*var\(--foreground\)/,
  );
});
