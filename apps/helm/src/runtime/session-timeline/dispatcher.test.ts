import assert from "node:assert/strict";
import test from "node:test";
import type { SessionTimelineBatch, SessionUpdateRecord } from "@tiller/shared";
import type { SessionTimelineStore } from "@tiller/persistence";
import { createSessionTimelineDispatcher } from "./dispatcher";

test("timeline dispatcher commits updates with materialized entries before publishing", () => {
  const order: string[] = [];
  const batch: SessionTimelineBatch = {
    replace: false,
    deliverySequence: 1,
    lastSequence: 1,
    entries: [],
  };
  const update: SessionUpdateRecord = {
    sessionId: "session-1",
    runtimeSessionId: "runtime-1",
    providerId: "codex",
    sequence: 1,
    source: "acp_live",
    updateType: "message",
    receivedAt: "2026-07-11T16:00:00.000Z",
    payloadJson: '{"type":"message"}',
  };
  const store = {
    commitBatch: (_sessionId: string, _batch: SessionTimelineBatch, updates: SessionUpdateRecord[]) => {
      order.push(`commit:${updates.length}`);
      return [];
    },
  } as unknown as SessionTimelineStore;
  const dispatcher = createSessionTimelineDispatcher({
    store,
    publish: () => order.push("publish"),
  });

  dispatcher.dispatch("session-1", batch, [update]);

  assert.deepEqual(order, ["commit:1", "publish"]);
});

test("timeline dispatcher does not publish when the atomic commit fails", () => {
  let published = false;
  const dispatcher = createSessionTimelineDispatcher({
    store: {
      commitBatch: () => {
        throw new Error("commit failed");
      },
    } as unknown as SessionTimelineStore,
    publish: () => {
      published = true;
    },
  });

  assert.throws(() => dispatcher.dispatch("session-1", {
    replace: false,
    deliverySequence: 1,
    lastSequence: 1,
    entries: [],
  }, []), /commit failed/u);
  assert.equal(published, false);
});
