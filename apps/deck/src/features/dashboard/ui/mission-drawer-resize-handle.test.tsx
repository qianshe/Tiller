import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  clampDashboardMissionDrawerWidth,
  DASHBOARD_MISSION_DRAWER_DEFAULT_WIDTH,
  DASHBOARD_MISSION_DRAWER_MAX_WIDTH,
  DASHBOARD_MISSION_DRAWER_MIN_WIDTH,
} from "./mission-drawer-resize-handle";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, "mission-drawer-resize-handle.tsx"), "utf8");

test("mission drawer width stays within its desktop bounds", () => {
  assert.equal(
    clampDashboardMissionDrawerWidth(DASHBOARD_MISSION_DRAWER_MIN_WIDTH - 1),
    DASHBOARD_MISSION_DRAWER_MIN_WIDTH,
  );
  assert.equal(
    clampDashboardMissionDrawerWidth(DASHBOARD_MISSION_DRAWER_MAX_WIDTH + 1),
    DASHBOARD_MISSION_DRAWER_MAX_WIDTH,
  );
  assert.equal(
    clampDashboardMissionDrawerWidth(Number.NaN),
    DASHBOARD_MISSION_DRAWER_DEFAULT_WIDTH,
  );
});

test("mission drawer resize handle exposes pointer and keyboard controls", () => {
  assert.match(source, /role="separator"/);
  assert.match(source, /onPointerDown=\{handlePointerDown\}/);
  assert.doesNotMatch(source, /onPointerDownCapture/);
  assert.doesNotMatch(source, /event\.stopPropagation\(\)/);
  // 拖拽通过 window 层 pointermove/pointerup 跟踪，不使用 setPointerCapture，
  // 避免 capture 残留导致拖拽后首次点击被吞掉。
  assert.doesNotMatch(source, /setPointerCapture/);
  assert.match(source, /window\.addEventListener\("pointermove", handlePointerMove\)/);
  assert.match(source, /window\.addEventListener\("pointerup", stopResizing\)/);
  assert.match(source, /onKeyDown=\{handleKeyDown\}/);
  assert.match(source, /event\.key === "ArrowLeft"/);
  assert.match(source, /event\.key === "ArrowRight"/);
  assert.match(source, /event\.key === "Home"/);
  assert.match(source, /event\.key === "End"/);
  assert.match(source, /DASHBOARD_MISSION_DRAWER_MIN_WIDTH/);
  assert.match(source, /DASHBOARD_MISSION_DRAWER_MAX_WIDTH/);
});
