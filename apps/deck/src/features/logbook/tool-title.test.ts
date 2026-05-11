import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall } from "@tiller/shared";
import { groupToolCalls } from "./timeline.js";

const superpowersSkillPath =
  "C:/Users/qjq/.codex/plugins/cache/openai-curated/superpowers/56bcc02e/skills/brainstorming/SKILL.md";
const systemOpenaiSkillPath =
  "C:/Users/qjq/.codex/skills/.system/openai-docs/SKILL.md";
const codexSkillPath =
  "C:\\Users\\qjq\\.codex\\plugins\\cache\\openai-curated\\superpowers\\3c463363\\skills\\brainstorming\\SKILL.md";

test("groupToolCalls uses shell command prefix as title and expands only output", () => {
  const grouped = groupToolCalls([
    {
      id: "call-shell",
      kind: "terminal",
      title: "Tool: shell",
      status: "completed",
      input: JSON.stringify({
        command: "pnpm --filter @tiller/helm test -- --reporter spec",
      }),
      output: "PASS",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(
    grouped[0]?.title,
    "pnpm --filter @tiller/helm test -- --reporter spec",
  );
  assert.equal(grouped[0]?.text, "PASS");
});

test("groupToolCalls summarizes Codex rawInput shell command arrays", () => {
  const grouped = groupToolCalls([
    {
      id: "call-shell-raw",
      kind: "terminal",
      title: "call-shell-raw",
      status: "completed",
      input: JSON.stringify({
        command: [
          "powershell.exe",
          "-Command",
          "Get-Content -Raw 'C:/Users/qjq/.codex/skills/foo/SKILL.md'",
        ],
        parsed_cmd: [
          {
            type: "unknown",
            cmd: "Get-Content -Raw 'C:/Users/qjq/.codex/skills/foo/SKILL.md'",
          },
        ],
      }),
      output: "skill docs",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: foo");
  assert.equal(grouped[0]?.text, "skill docs");
});

test("groupToolCalls shows SKILL.md shell reads as skill names", () => {
  const grouped = groupToolCalls([
    {
      id: "call-skill-read",
      kind: "terminal",
      title: `Get-Content -Raw '${superpowersSkillPath}'`,
      status: "completed",
      input: JSON.stringify({
        command: `Get-Content -Raw '${superpowersSkillPath}'`,
      }),
      output: "skill docs",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: superpowers:brainstorming");
  assert.equal(grouped[0]?.text, "skill docs");
});

test("groupToolCalls extracts skill names from terminal titles without input", () => {
  const grouped = groupToolCalls([
    {
      id: "call-skill-title",
      kind: "terminal",
      title: `Get-Content -Raw '${systemOpenaiSkillPath}'`,
      status: "completed",
      output: "skill docs",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: openai-docs");
});

test("groupToolCalls recognizes OpenCode skill tools from tool stdout payloads", () => {
  const grouped = groupToolCalls([
    {
      id: "tool-opencode-skill",
      kind: "tool",
      title: "Tool: frontend-design",
      status: "completed",
      output: JSON.stringify({
        output:
          "## Skill frontend-design\n\n**Base directory:** C:/Users/qjq/.claude/skills/frontend-design",
      }),
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: frontend-design");
});

test("groupToolCalls recognizes OpenCode skill tools from plain stdout payloads", () => {
  const grouped = groupToolCalls([
    {
      id: "tool-opencode-plain-skill",
      kind: "tool",
      title: "skill",
      status: "completed",
      output: "Skill: webapp-testing\nloaded",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: webapp-testing");
});

test("groupToolCalls recognizes OpenCode slash-prefixed skill headings", () => {
  const grouped = groupToolCalls([
    {
      id: "tool-opencode-slash-skill",
      kind: "tool",
      title: "skill",
      status: "completed",
      output:
        "# /superpowers:dispatching-parallel-agents Command\n\n**Description:** Use when facing independent tasks.",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: superpowers:dispatching-parallel-agents");
});

test("groupToolCalls recognizes OpenCode skill tools that combine heading and colon", () => {
  const grouped = groupToolCalls([
    {
      id: "tool-opencode-heading-colon",
      kind: "tool",
      title: "Tool: review-work",
      status: "completed",
      output: JSON.stringify({
        output:
          "## Skill: review-work\n\n**Base directory:** C:/Users/qjq/.claude/skills/review-work",
      }),
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: review-work");
});

test("groupToolCalls extracts Claude Code Skill tool invocations from structured input", () => {
  // Real payload from C:/Users/qjq/.claude/projects/.../*.jsonl: tool_use
  // entries with name="Skill" and input={"skill":"<name>"}, transported through
  // ACP as kind:"tool" with title="Tool: Skill" and a JSON-encoded input.
  const grouped = groupToolCalls([
    {
      id: "call-claude-skill",
      kind: "tool",
      title: "Tool: Skill",
      status: "completed",
      input: JSON.stringify({ skill: "update-config" }),
      output: "Skill loaded.",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: update-config");
});

test("groupToolCalls ignores generic 'name' input fields to avoid false skill matches", () => {
  const grouped = groupToolCalls([
    {
      id: "call-not-skill",
      kind: "tool",
      title: "Tool: read_resource",
      status: "completed",
      input: JSON.stringify({ name: "config.json" }),
      output: "{...}",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Tool: read_resource");
});

test("groupToolCalls extracts Codex skill names when kind is 'tool' (not terminal)", () => {
  const grouped = groupToolCalls([
    {
      id: "call-codex-skill-tool-kind",
      kind: "tool",
      title: `Get-Content -Raw '${codexSkillPath}'`,
      status: "completed",
      input: JSON.stringify({
        command: [
          "powershell.exe",
          "-Command",
          `Get-Content -Raw '${codexSkillPath}'`,
        ],
      }),
      output: "---\nname: brainstorming\ndescription: ...\n---",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: superpowers:brainstorming");
});

test("groupToolCalls falls back to SKILL.md frontmatter name when path is unavailable", () => {
  const grouped = groupToolCalls([
    {
      id: "call-codex-frontmatter-only",
      kind: "tool",
      title: "Tool: read_file",
      status: "completed",
      output:
        "---\nname: brainstorming\ndescription: design ideation\n---\n\n# Brainstorming",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: brainstorming");
});

test("groupToolCalls does not classify Codex terminal output as a skill without a SKILL.md command", () => {
  const grouped = groupToolCalls([
    {
      id: "tool-codex-shell-output",
      kind: "terminal",
      title: "echo docs",
      status: "completed",
      input: JSON.stringify({ command: "echo docs" }),
      output: "## Skill frontend-design\nthis is just stdout",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "echo docs");
});
