import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall } from "../types";
import { compactBinaryToolCallOutput } from "./tool-call-output";

test("compactBinaryToolCallOutput replaces inline image data with a local file summary", () => {
  const toolCall: AgentToolCall = {
    id: "call-view-image",
    kind: "read",
    title: "D:/repo/apps/deck/public/landing/command-deck-bg.png",
    status: "completed",
    input: JSON.stringify({
      path: "D:/repo/apps/deck/public/landing/command-deck-bg.png",
      detail: "high",
    }),
    output: JSON.stringify([
      {
        type: "input_image",
        image_url: `data:image/png;base64,${"A".repeat(2048)}`,
        detail: "high",
      },
    ]),
    timestamp: "2026-07-08T06:00:00.000Z",
    updatedAt: "2026-07-08T06:00:00.000Z",
  };

  assert.deepEqual(compactBinaryToolCallOutput(toolCall), {
    ...toolCall,
    output: [
      "[image content omitted from history]",
      "path: D:/repo/apps/deck/public/landing/command-deck-bg.png",
      "mimeType: image/png",
      "detail: high",
    ].join("\n"),
  });
});

test("compactBinaryToolCallOutput keeps ordinary read output unchanged", () => {
  const toolCall: AgentToolCall = {
    id: "call-read-file",
    kind: "read",
    title: "README.md",
    status: "completed",
    output: "# Tiller",
    timestamp: "2026-07-08T06:00:00.000Z",
    updatedAt: "2026-07-08T06:00:00.000Z",
  };

  assert.equal(compactBinaryToolCallOutput(toolCall), toolCall);
});

test("compactBinaryToolCallOutput strips inline image data from MCP output", () => {
  const toolCall: AgentToolCall = {
    id: "call-mcp-image",
    kind: "mcp",
    title: "mcp__image_tool",
    status: "completed",
    output: JSON.stringify({
      content: [
        { type: "text", text: "preview ready" },
        {
          type: "image",
          data: `data:image/jpeg;base64,${"A".repeat(2048)}`,
          mimeType: "image/jpeg",
        },
      ],
      requestId: "request-1",
    }),
    timestamp: "2026-08-15T06:00:00.000Z",
    updatedAt: "2026-08-15T06:00:00.000Z",
  };

  const compacted = compactBinaryToolCallOutput(toolCall);

  assert.equal(
    compacted.output,
    JSON.stringify({
      content: [
        { type: "text", text: "preview ready" },
        {
          type: "image",
          data: "[image content omitted from history]",
          mimeType: "image/jpeg",
        },
      ],
      requestId: "request-1",
    }),
  );
  assert.doesNotMatch(compacted.output ?? "", /data:image\/jpeg;base64/u);
});
