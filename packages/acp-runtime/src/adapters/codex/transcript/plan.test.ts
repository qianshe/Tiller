import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  extractCodexPlanFromTranscriptText,
  readCodexTranscriptPlanFromDisk,
} from "./plan.js";

test("extractCodexPlanFromTranscriptText rebuilds the latest Codex update_plan state", () => {
  const transcript = [
    JSON.stringify({
      timestamp: "2026-07-07T11:06:05.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "update_plan",
        arguments: JSON.stringify({
          plan: [
            { step: "检查适配器", status: "completed", priority: "medium" },
            { step: "修正回灌", status: "in_progress", priority: "high" },
          ],
        }),
        call_id: "call-plan-1",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T11:06:06.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "update_plan",
        arguments: JSON.stringify({
          plan: [
            { step: "检查适配器", status: "completed", priority: "medium" },
            { step: "修正回灌", status: "completed", priority: "high" },
          ],
        }),
        call_id: "call-plan-2",
      },
    }),
  ].join("\n");

  assert.deepEqual(extractCodexPlanFromTranscriptText(transcript), {
    updatedAt: "2026-07-07T11:06:06.000Z",
    entries: [
      { content: "检查适配器", status: "completed", priority: "medium" },
      { content: "修正回灌", status: "completed", priority: "high" },
    ],
  });
});

test("readCodexTranscriptPlanFromDisk reads matching rollout files", () => {
  const codexDir = mkdtempSync(join(tmpdir(), "tiller-codex-plan-"));
  const sessionDir = join(codexDir, "sessions", "2026", "07", "07");
  mkdirSync(sessionDir, { recursive: true });
  const transcriptPath = join(
    sessionDir,
    "rollout-2026-07-07T19-03-16-019f3c3f-0732-7461-b3b5-1992ad381665.jsonl",
  );
  writeFileSync(
    transcriptPath,
    JSON.stringify({
      timestamp: "2026-07-07T11:06:05.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "update_plan",
        arguments: JSON.stringify({
          entries: [{ step: "恢复计划", status: "in_progress" }],
        }),
        call_id: "call-plan",
      },
    }),
    "utf8",
  );

  assert.deepEqual(
    readCodexTranscriptPlanFromDisk({
      runtimeSessionId: "019f3c3f-0732-7461-b3b5-1992ad381665",
      cwd: "D:/repo",
      codexConfigDir: codexDir,
    }),
    {
      updatedAt: "2026-07-07T11:06:05.000Z",
      entries: [{ content: "恢复计划", status: "in_progress", priority: "medium" }],
    },
  );
});
