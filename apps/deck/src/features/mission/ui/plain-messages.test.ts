import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@tiller/shared";
import {
  DEFAULT_VISIBLE_MESSAGE_LIMIT,
  resolveVisiblePlainMessages,
} from "./plain-messages.js";

function message(index: number): AgentMessage {
  return {
    id: `m-${index}`,
    role: index % 2 === 0 ? "assistant" : "user",
    text: `message ${index}`,
    timestamp: `2026-05-06T00:${String(index).padStart(2, "0")}:00.000Z`,
  };
}

test("plain message timeline initially renders the latest 20 messages", () => {
  const messages = Array.from({ length: 25 }, (_, index) => message(index + 1));

  assert.deepEqual(
    resolveVisiblePlainMessages(messages, DEFAULT_VISIBLE_MESSAGE_LIMIT).map(
      (item) => item.id,
    ),
    messages.slice(-20).map((item) => item.id),
  );
});

test("plain message timeline can reveal older loaded messages", () => {
  const messages = Array.from({ length: 45 }, (_, index) => message(index + 1));

  assert.deepEqual(
    resolveVisiblePlainMessages(messages, DEFAULT_VISIBLE_MESSAGE_LIMIT * 2).map(
      (item) => item.id,
    ),
    messages.slice(-40).map((item) => item.id),
  );
});

test("plain message timeline uses chronological latest messages from newest-first pages", () => {
  const messages = Array.from({ length: 25 }, (_, index) => message(index + 1));
  const newestFirstMessages = [...messages].reverse();

  assert.deepEqual(
    resolveVisiblePlainMessages(newestFirstMessages, DEFAULT_VISIBLE_MESSAGE_LIMIT).map(
      (item) => item.id,
    ),
    messages.slice(-20).map((item) => item.id),
  );
});
