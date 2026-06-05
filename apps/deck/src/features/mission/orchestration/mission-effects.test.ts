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

test("opening an old session requests only the latest message and activity pages", () => {
  assert.match(
    missionEffectsSourceText,
    /dispatch\(rpcClientRef\.current,\s*"session\/list_messages",\s*\{\s*sessionId:\s*activeSessionId,\s*limit:\s*DEFAULT_MESSAGE_PAGE_LIMIT,\s*\}\)/s,
  );
  assert.doesNotMatch(
    missionEffectsSourceText,
    /"session\/list_messages"[\s\S]{0,160}\bbefore\s*:/,
  );
  assert.match(
    missionEffectsSourceText,
    /dispatch\(rpcClientRef\.current,\s*"session\/get_artifacts",\s*\{\s*sessionId:\s*activeSessionId,\s*limit:\s*DEFAULT_ACTIVITY_PAGE_LIMIT,\s*\}\)/s,
  );
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

test("mission effects leaves active-session history refresh to open session streams in parallel card mode", () => {
  assert.match(
    missionEffectsSourceText,
    /!\s*activeSessionId\s*\|\|\s*\(openChatSessionIds\?\.length \?\? 0\) > 1\s*\|\|\s*pairingState !== "paired"/,
  );
  assert.match(
    missionEffectsSourceText,
    /\}, \[activeSessionId, openChatSessionIds\?\.length, pairingState\]\);/,
  );
});
