import assert from "node:assert/strict";
import test from "node:test";
import type { SessionStatus } from "@tiller/shared";
import {
  isSessionCompletionUnreadTransition,
  isUnacknowledgedSessionCompletion,
} from "./session-completion.js";

test("marks an active session that becomes idle as completed unread", () => {
  const activeStatuses: SessionStatus[] = [
    "starting",
    "running",
    "waiting_for_permission",
  ];

  for (const previousStatus of activeStatuses) {
    assert.equal(
      isSessionCompletionUnreadTransition(previousStatus, "idle"),
      true,
    );
  }
});

test("does not mark non-completion status changes as completed unread", () => {
  const transitions: Array<[SessionStatus | undefined, SessionStatus]> = [
    [undefined, "idle"],
    ["idle", "idle"],
    ["error", "idle"],
    ["cancelled", "idle"],
    ["canceled" as SessionStatus, "idle"],
    ["running", "error"],
  ];

  for (const [previousStatus, nextStatus] of transitions) {
    assert.equal(
      isSessionCompletionUnreadTransition(previousStatus, nextStatus),
      false,
    );
  }
});

test("completion versions only restore markers newer than the device acknowledgement", () => {
  assert.equal(
    isUnacknowledgedSessionCompletion(
      "2026-05-04T01:00:00.000Z",
      "2026-05-04T00:59:59.000Z",
    ),
    true,
  );
  assert.equal(
    isUnacknowledgedSessionCompletion(
      "2026-05-04T01:00:00.000Z",
      "2026-05-04T01:00:00.000Z",
    ),
    false,
  );
  assert.equal(isUnacknowledgedSessionCompletion(undefined, undefined), false);
});
