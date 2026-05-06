import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function readRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));
  assert.ok(match?.groups?.body, `Missing CSS rule for ${selector}`);
  return match.groups.body;
}

test("mission permission drawer keeps approval actions in a fixed bottom row", () => {
  const drawerRule = readRule(".mission-permission-drawer");
  const copyRule = readRule(".mission-permission-copy");
  const actionsRule = readRule(".mission-permission-actions");

  assert.match(drawerRule, /grid-template-rows\s*:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
  assert.match(drawerRule, /max-height\s*:/);
  assert.match(drawerRule, /position\s*:\s*relative/);
  assert.match(drawerRule, /z-index\s*:\s*31/);
  assert.match(drawerRule, /overflow\s*:\s*hidden/);
  assert.match(copyRule, /overflow-y\s*:\s*auto/);
  assert.match(copyRule, /min-height\s*:\s*0/);
  assert.match(actionsRule, /align-self\s*:\s*stretch/);
  assert.match(actionsRule, /align-items\s*:\s*center/);
  assert.match(actionsRule, /padding-bottom\s*:\s*2px/);
});

test("permission drawer title is visually separated from the scrollable request details", () => {
  const headerRule = readRule(".mission-permission-header");
  const titleRule = readRule(".mission-permission-title");

  assert.match(headerRule, /border-bottom\s*:/);
  assert.match(titleRule, /overflow-wrap\s*:\s*anywhere/);
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
  assert.match(buttonRule, /min-width\s*:\s*88px/);
  assert.match(buttonRule, /min-height\s*:\s*32px/);
  assert.match(buttonRule, /padding\s*:\s*6px\s+12px/);
  assert.match(buttonRule, /box-shadow\s*:\s*none/);
});
