import assert from "node:assert/strict";
import test from "node:test";
import { buildMissionEffectsSource } from "./mission-effects-source.js";

test("mission effects source exposes the active route view", () => {
  const source = buildMissionEffectsSource({
    runtimeState: {},
    deckData: {},
    missionView: {},
    helmConnection: {},
    controllers: {},
    history: {},
    route: { activeView: "sessions" },
  });

  assert.equal(source.activeView, "sessions");
});
