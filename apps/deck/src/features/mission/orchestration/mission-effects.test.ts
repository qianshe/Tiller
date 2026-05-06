import assert from "node:assert/strict";
import test from "node:test";
import { buildMissionEffectsSource } from "./mission-effects-source.js";

test("mission effects source exposes route and top-level refs", () => {
  const lastFilesScopeKeyRef = { current: null as string | null };
  const source = buildMissionEffectsSource({
    runtimeState: {},
    deckData: {},
    missionView: {},
    helmConnection: {},
    controllers: {},
    history: {},
    route: { activeView: "sessions" },
    lastFilesScopeKeyRef,
  });

  assert.equal(source.activeView, "sessions");
  assert.equal(source.lastFilesScopeKeyRef, lastFilesScopeKeyRef);
});
