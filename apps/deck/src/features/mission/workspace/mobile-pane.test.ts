import assert from "node:assert/strict";
import test from "node:test";
import { MISSION_MOBILE_PANE_ORDER, selectAdjacentMissionMobilePane } from "./mobile-pane";

test("MISSION_MOBILE_PANE_ORDER keeps the mission mobile navigation order", () => {
  assert.deepEqual(MISSION_MOBILE_PANE_ORDER, ["project", "chat", "display", "inspector"]);
});

test("selectAdjacentMissionMobilePane moves within pane bounds", () => {
  assert.equal(selectAdjacentMissionMobilePane("project", -1), "project");
  assert.equal(selectAdjacentMissionMobilePane("project", 1), "chat");
  assert.equal(selectAdjacentMissionMobilePane("chat", 1), "display");
  assert.equal(selectAdjacentMissionMobilePane("inspector", 1), "inspector");
});
