import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_TEMPLATES,
  applyAgentTemplate,
  findMatchingTemplate,
} from "./agent-templates";

test("AGENT_TEMPLATES exposes the three common ACP agents", () => {
  assert.deepEqual(
    AGENT_TEMPLATES.map((template) => template.id),
    ["codex", "claude-code", "opencode"],
  );
});

test("codex template matches the codex-acp adapter command", () => {
  const codex = AGENT_TEMPLATES.find((template) => template.id === "codex");
  assert.ok(codex);
  assert.equal(codex.command, "codex-acp");
  assert.deepEqual(codex.args, []);
  assert.match(codex.installHint, /@agentclientprotocol\/codex-acp/);
});

test("claude-code template uses claude-agent-acp command", () => {
  const claude = AGENT_TEMPLATES.find((template) => template.id === "claude-code");
  assert.ok(claude);
  assert.equal(claude.command, "claude-agent-acp");
  assert.deepEqual(claude.args, []);
  assert.match(claude.installHint, /@agentclientprotocol\/claude-agent-acp/);
});

test("opencode template uses opencode acp args", () => {
  const opencode = AGENT_TEMPLATES.find((template) => template.id === "opencode");
  assert.ok(opencode);
  assert.equal(opencode.command, "opencode");
  assert.deepEqual(opencode.args, ["acp"]);
  assert.match(opencode.installHint, /opencode-ai/);
});

test("applyAgentTemplate returns an independent draft copy", () => {
  const opencode = AGENT_TEMPLATES.find((template) => template.id === "opencode");
  assert.ok(opencode);
  const draft = applyAgentTemplate(opencode);
  assert.deepEqual(draft, { name: "OpenCode", command: "opencode", args: ["acp"] });
  draft.args.push("--pure");
  assert.deepEqual(opencode.args, ["acp"]);
});

test("findMatchingTemplate resolves by command", () => {
  assert.equal(findMatchingTemplate({ command: "codex-acp" })?.id, "codex");
  assert.equal(findMatchingTemplate({ command: "claude-agent-acp" })?.id, "claude-code");
  assert.equal(findMatchingTemplate({ command: "opencode" })?.id, "opencode");
});

test("findMatchingTemplate trims whitespace and ignores empty input", () => {
  assert.equal(findMatchingTemplate({ command: "  codex-acp  " })?.id, "codex");
  assert.equal(findMatchingTemplate({ command: "  " }), undefined);
  assert.equal(findMatchingTemplate({ command: "" }), undefined);
});

test("findMatchingTemplate returns undefined for unknown commands", () => {
  assert.equal(findMatchingTemplate({ command: "gemini" }), undefined);
  assert.equal(findMatchingTemplate({ command: "codex-acp --sandbox" }), undefined);
});
