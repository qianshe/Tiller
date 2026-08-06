import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMissionPromptText,
  parseMissionPromptContext,
  parseSlashCommandName,
  stripMissionPromptContext,
  type MissionPromptContextItem,
} from "./mission-prompt-context";

const DIFF_CONTEXT: MissionPromptContextItem = {
  id: "ctx-diff-1",
  kind: "diff",
  label: "apps/deck/src/features/mission/display/panel.tsx:44-46",
  comment: "这里需要保留 diff 详情上下文",
  excerpt: "@@ -44,2 +44,3 @@\n- old line\n+ --> new line",
  source: {
    kind: "diff",
    filePath: "apps/deck/src/features/mission/display/panel.tsx",
    startLine: 44,
    endLine: 46,
  },
};

const QUOTE_CONTEXT: MissionPromptContextItem = {
  id: "ctx-quote-1",
  kind: "quote",
  label: "assistant 引用",
  comment: "保留这个回答",
  excerpt: "use MCP tools first",
  source: { kind: "quote", messageId: "m1", role: "assistant" },
};

test("parseSlashCommandName extracts the first slash token", () => {
  assert.equal(parseSlashCommandName("/review quick"), "review");
  assert.equal(parseSlashCommandName("  /skills:frontend-design hero"), "skills:frontend-design");
  assert.equal(parseSlashCommandName("/"), null);
  assert.equal(parseSlashCommandName("normal prompt"), null);
  assert.equal(parseSlashCommandName("//review now"), "review");
});

test("mission prompt codec round-trips contexts and body", () => {
  const text = buildMissionPromptText("请检查这里", [DIFF_CONTEXT, QUOTE_CONTEXT]);
  const parsed = parseMissionPromptContext(text);

  assert.match(text, /\[TILLER_CONTEXT_JSON_V1\]/);
  assert.match(text, /\[TILLER_USER_PROMPT\]/);
  assert.equal(parsed.body, "请检查这里");
  assert.equal(parsed.contexts.length, 2);
  assert.equal(parsed.contexts[0]?.comment, DIFF_CONTEXT.comment);
  assert.match(parsed.contexts[0]?.excerpt ?? "", /--> new line/);
  assert.equal(parsed.contexts[1]?.excerpt, "use MCP tools first");
});

test("buildMissionPromptText returns the plain prompt when no contexts", () => {
  assert.equal(buildMissionPromptText("普通文本", []), "普通文本");
});

test("parseMissionPromptContext tolerates malformed json blocks", () => {
  const text = [
    "[TILLER_CONTEXT_JSON_V1]",
    "{ not json",
    "[/TILLER_CONTEXT_JSON_V1]",
    "[TILLER_USER_PROMPT]",
    "body only",
    "[/TILLER_USER_PROMPT]",
  ].join("\n");
  const parsed = parseMissionPromptContext(text);
  assert.deepEqual(parsed.contexts, []);
  assert.equal(parsed.body, "body only");
});

test("parseMissionPromptContext falls back to the whole text as body when no prompt tag", () => {
  const parsed = parseMissionPromptContext("没有任何 marker 的裸文本");
  assert.equal(parsed.body, "没有任何 marker 的裸文本");
  assert.equal(parsed.contexts.length, 0);
});

test("stripMissionPromptContext returns the plain user prompt body", () => {
  const text = buildMissionPromptText("帮我展开", [DIFF_CONTEXT]);
  assert.equal(stripMissionPromptContext(text), "帮我展开");
  assert.equal(stripMissionPromptContext("普通文本"), "普通文本");
});

test("stripMissionPromptContext returns empty for context-only sends", () => {
  const text = buildMissionPromptText("", [DIFF_CONTEXT]);
  assert.equal(stripMissionPromptContext(text), "");
});
