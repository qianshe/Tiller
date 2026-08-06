import assert from "node:assert/strict";
import test from "node:test";
import { mapSessionUpdateNotification } from "../../events";

test("Claude TaskOutput source notifications stay subagent events with structured results", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-task-output-source",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "task-output-source",
          title: "TaskOutput",
          kind: "other",
          status: "completed",
          rawInput: { task_id: "child-1", block: true },
          rawOutput: {
            retrieval_status: "success",
            task: {
              task_id: "child-1",
              output: "child result",
            },
          },
          _meta: { claudeCode: { toolName: "TaskOutput" } },
        },
      },
    },
    { providerId: "claude-code" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected a live Claude TaskOutput tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "Subagent");
  assert.equal(mapped.event.toolCall.commandId, "subagent:child-1");
  assert.equal(mapped.event.toolCall.status, "completed");
  assert.equal(mapped.event.toolCall.output, "child result");
});

test("Claude Agent and TaskOutput updates with different tool ids share one subagent", () => {
  const sessionId = "session-claude-cross-id-subagent";
  const providerId = "claude-code";
  const launch = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "toolu_agent_launch",
          title: "Agent",
          kind: "tool",
          status: "running",
          rawInput: {
            description: "Read package metadata",
            prompt: "Read package.json",
            subagent_type: "Explore",
            run_in_background: true,
          },
          rawOutput: "Async agent launched successfully.\nagentId: child-agent-1",
        },
      },
    },
    { providerId },
  );
  const result = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "toolu_task_output",
          title: "TaskOutput",
          kind: "other",
          status: "completed",
          rawInput: { task_id: "child-agent-1", block: true },
          rawOutput: {
            retrieval_status: "success",
            task: {
              task_id: "child-agent-1",
              output: "name=tiller version=0.1.9",
            },
          },
          _meta: { claudeCode: { toolName: "TaskOutput" } },
        },
      },
    },
    { providerId },
  );

  assert.equal(launch?.event.type, "tool-call");
  assert.equal(result?.event.type, "tool-call");
  if (launch?.event.type !== "tool-call" || result?.event.type !== "tool-call") {
    throw new Error("Expected Claude subagent tool-call events");
  }
  assert.equal(launch.event.toolCall.kind, "subagent");
  assert.equal(launch.event.toolCall.status, "running");
  assert.equal(result.event.toolCall.kind, "subagent");
  assert.equal(result.event.toolCall.id, launch.event.toolCall.id);
  assert.equal(result.event.toolCall.status, "completed");
  assert.equal(result.event.toolCall.output, "name=tiller version=0.1.9");
});

test("Claude structured TaskOutput strips provider envelope from the final output", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-task-output-envelope",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "task-output-envelope",
          title: "TaskOutput",
          kind: "other",
          status: "completed",
          rawInput: { task_id: "child-envelope", block: true },
          rawOutput: {
            retrieval_status: "success",
            task: {
              task_id: "child-envelope",
              output: [
                { type: "text", text: "<task_id>child-envelope</task_id>" },
                { type: "text", text: "<status>completed</status>" },
                { type: "text", text: "<output>name=tiller version=0.1.9</output>" },
                { type: "text", text: "<usage>tool_uses: 1</usage>" },
              ],
            },
          },
          _meta: { claudeCode: { toolName: "TaskOutput" } },
        },
      },
    },
    { providerId: "claude-code" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected a Claude TaskOutput tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.status, "completed");
  assert.equal(mapped.event.toolCall.output, "name=tiller version=0.1.9");
  assert.doesNotMatch(mapped.event.toolCall.output ?? "", /<task_id>|<status>|<usage>/u);
});
