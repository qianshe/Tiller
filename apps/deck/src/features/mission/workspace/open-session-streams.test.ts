import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { markSessionHistoryEntriesLoading } from "./open-session-streams";

const openSessionStreamsSourceText = readFileSync(
  new URL("./open-session-streams.ts", import.meta.url),
  "utf8",
);
const workspaceControllerSourceText = readFileSync(
  new URL("./controller.tsx", import.meta.url),
  "utf8",
);

test("markSessionHistoryEntriesLoading marks existing entries as loading", () => {
  const current = {
    "session-1": {
      nextCursor: "cursor-1",
      hasMore: true,
      loading: false,
    },
  };

  const next = markSessionHistoryEntriesLoading(current, ["session-1", "session-2"]);

  assert.notEqual(next, current);
  assert.deepEqual(next["session-1"], {
    nextCursor: "cursor-1",
    hasMore: true,
    loading: true,
  });
  assert.deepEqual(next["session-2"], {
    hasMore: false,
    loading: true,
  });
});

test("markSessionHistoryEntriesLoading avoids unchanged loading updates", () => {
  const current = {
    "session-1": {
      hasMore: false,
      loading: true,
    },
  };

  assert.equal(markSessionHistoryEntriesLoading(current, ["session-1"]), current);
});

test("open session stream hydration reruns when Helm reconnects", () => {
  assert.match(openSessionStreamsSourceText, /connection:\s*string;/);
  assert.match(openSessionStreamsSourceText, /connection !== "connected"/);
  assert.match(
    openSessionStreamsSourceText,
    /\}, \[openSessionStreamKey, pairingState, connection\]\);/,
  );
  assert.match(
    openSessionStreamsSourceText,
    /sessionTimelineBySession,\s*\n\s*sessions,\s*\n\s*connection,/,
  );
  assert.match(
    workspaceControllerSourceText,
    /useOpenSessionStreams\(\{[\s\S]*pairingState,\s*connection,/,
  );
  assert.doesNotMatch(openSessionStreamsSourceText, /session\/get_artifacts/u);
  assert.doesNotMatch(openSessionStreamsSourceText, /openSessionPlanHydrationRef/u);
});
