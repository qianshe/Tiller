import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildMissionEffectsSource } from "./mission-effects-source.js";

const missionEffectsSourceText = readFileSync(
  new URL("./mission-effects.ts", import.meta.url),
  "utf8",
);

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

test("mission effects no longer dispatches session history directly", () => {
  assert.doesNotMatch(missionEffectsSourceText, /dispatch\(.*"session\/list_messages"/);
  assert.doesNotMatch(missionEffectsSourceText, /dispatch\(.*"session\/get_artifacts"/);
  assert.doesNotMatch(missionEffectsSourceText, /dispatch\(.*"session\/check_resume"/);
});

test("mission effects leaves session topic subscriptions to the open session grid", () => {
  assert.doesNotMatch(missionEffectsSourceText, /subscribeToSessionTopic/);
  assert.doesNotMatch(missionEffectsSourceText, /unsubscribeFromSessionTopic/);
});

test("mission effects does not force chat-main bottom scrolling for parallel session cards", () => {
  assert.match(missionEffectsSourceText, /openChatSessionIds,/);
  assert.match(
    missionEffectsSourceText,
    /if \(\(openChatSessionIds\?\.length \?\? 0\) > 1\) \{\s*return;\s*\}/,
  );
  assert.match(missionEffectsSourceText, /openChatSessionIds\?\.length/);
});

test("mission effects still consumes pendingSessionScrollToBottomRef for explicit scroll-to-bottom", () => {
  assert.match(missionEffectsSourceText, /pendingSessionScrollToBottomRef/);
});
