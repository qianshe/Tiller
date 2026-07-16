import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall } from "@tiller/shared";
import { groupToolCalls } from "./timeline.js";
import { resolveToolCallTone } from "./tool-call-tone.js";

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
      kind: "shell",
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

test("groupToolCalls shows MCP titles without the generic Tool prefix", () => {
  const grouped = groupToolCalls([
    {
      id: "call-mcp",
      kind: "mcp",
      title: "Tool: node_repl/js",
      status: "completed",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
    {
      id: "call-old-mcp",
      kind: "tool",
      title: "Tool: sanshu/zhi",
      status: "completed",
      timestamp: "2026-04-30T13:22:47.627Z",
      updatedAt: "2026-04-30T13:22:47.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "node_repl/js");
  assert.equal(grouped[1]?.title, "sanshu/zhi");
});

test("groupToolCalls prefers explicit MCP metadata over legacy provider titles", () => {
  const grouped = groupToolCalls([
    {
      id: "call-claude-mcp",
      kind: "mcp",
      title: "mcpServers_search_context",
      mcp: {
        toolName: "search_context",
        source: "provider-title",
        rawTitle: "mcpServers_search_context",
      },
      status: "completed",
      timestamp: "2026-04-30T13:22:48.627Z",
      updatedAt: "2026-04-30T13:22:48.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "search_context");
});

test("groupToolCalls removes duplicated read and write verbs from titles", () => {
  const grouped = groupToolCalls([
    {
      id: "call-read",
      kind: "read",
      title: "Read packages\\acp-runtime\\src\\tool-events.ts",
      status: "completed",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
    {
      id: "call-write",
      kind: "write",
      title: "Write docs\\bug\\BUG-004.md",
      status: "completed",
      timestamp: "2026-04-30T13:22:47.627Z",
      updatedAt: "2026-04-30T13:22:47.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "packages\\acp-runtime\\src\\tool-events.ts");
  assert.equal(grouped[1]?.title, "docs\\bug\\BUG-004.md");
});

test("resolveToolCallTone trusts explicit read and write kinds for persisted file paths", () => {
  assert.deepEqual(resolveToolCallTone("read", "docs/superpowers/plans/2026-07-07-mobile-composer-density-and-commit-button.md"), {
    label: "Read",
    className: "tool-call-read",
    icon: "◫",
  });
  assert.deepEqual(resolveToolCallTone("write", "docs\\bug\\BUG-004.md"), {
    label: "Write",
    className: "tool-call-write",
    icon: "✎",
  });
});

test("resolveToolCallTone trusts explicit search kind over title heuristics", () => {
  assert.deepEqual(resolveToolCallTone("search", "mcp__morph__codebase_search"), {
    label: "Search",
    className: "tool-call-mcp",
    icon: "⌕",
  });
});

test("resolveToolCallTone renders explicit diagnostics and keeps legacy read compatibility", () => {
  assert.deepEqual(
    resolveToolCallTone(
      "diagnostics",
      "Diagnostics: packages/acp-runtime/src/adapters/opencode/tool-calls.ts",
    ),
    {
      label: "Diagnostics",
      className: "tool-call-read",
      icon: "!",
    },
  );
  assert.deepEqual(
    resolveToolCallTone(
      "read",
      "Diagnostics: packages/acp-runtime/src/adapters/opencode/tool-calls.ts",
    ),
    {
      label: "Diagnostics",
      className: "tool-call-read",
      icon: "!",
    },
  );
  assert.deepEqual(
    resolveToolCallTone(
      "tool",
      "Diagnostics: packages/shared/src/types.ts",
    ),
    {
      label: "Diagnostics",
      className: "tool-call-read",
      icon: "!",
    },
  );
});

test("groupToolCalls preserves long shell commands for the row tooltip", () => {
  const command = [
    "pnpm --filter @tiller/deck test",
    "-- --test-name-pattern",
    '"keeps the complete shell command available instead of truncating after seventy two characters"',
  ].join(" ");
  const grouped = groupToolCalls([
    {
      id: "call-shell-long",
      kind: "shell",
      title: "Shell",
      status: "completed",
      input: JSON.stringify({ command }),
      timestamp: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:01.000Z",
    },
  ]);

  assert.equal(grouped[0]?.title, command);
});


test("groupToolCalls uses structured file paths for read and write titles", () => {
  const grouped = groupToolCalls([
    {
      id: "call-read",
      kind: "read",
      title: "Read",
      status: "completed",
      input: JSON.stringify({ file_path: "D:\\myProject\\tools\\Tiller\\apps\\deck\\src\\features\\logbook\\timeline.ts" }),
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
    {
      id: "call-edit",
      kind: "write",
      title: "Edit",
      status: "completed",
      input: JSON.stringify({ file_path: "apps/deck/src/features/logbook/activity-log-panel.tsx" }),
      timestamp: "2026-04-30T13:22:47.627Z",
      updatedAt: "2026-04-30T13:22:47.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "apps/deck/src/features/logbook/timeline.ts");
  assert.equal(grouped[1]?.title, "apps/deck/src/features/logbook/activity-log-panel.tsx");
});


test("groupToolCalls summarizes search tools from structured query inputs", () => {
  const grouped = groupToolCalls([
    {
      id: "call-grep",
      kind: "search",
      title: "Grep",
      status: "completed",
      input: JSON.stringify({ pattern: "航行日志", output_mode: "files_with_matches" }),
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
    {
      id: "call-glob",
      kind: "search",
      title: "Glob",
      status: "completed",
      input: JSON.stringify({ pattern: "apps/deck/**/*.tsx" }),
      timestamp: "2026-04-30T13:22:47.627Z",
      updatedAt: "2026-04-30T13:22:47.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Grep: 航行日志");
  assert.equal(grouped[1]?.title, "Glob: apps/deck/**/*.tsx");
});

test("groupToolCalls uses structured file paths for diagnostics titles", () => {
  const grouped = groupToolCalls([
    {
      id: "call-diagnostics",
      kind: "diagnostics",
      title: "Diagnostics",
      status: "completed",
      input: JSON.stringify({
        filePath: "D:\\myProject\\tools\\Tiller\\packages\\acp-runtime\\src\\events.ts",
      }),
      timestamp: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:01.000Z",
    },
  ]);

  assert.equal(
    grouped[0]?.title,
    "Diagnostics: packages/acp-runtime/src/events.ts",
  );
});

test("groupToolCalls preserves the server-assigned shell kind for structured Grep payloads", () => {
  const grouped = groupToolCalls([
    {
      id: "call-shell-grep",
      kind: "shell",
      title: "Shell",
      status: "completed",
      input: JSON.stringify({
        pattern: "Tiller",
        glob: "**/README.md",
        output_mode: "files_with_matches",
      }),
      timestamp: "2026-07-07T08:06:52.322Z",
      updatedAt: "2026-07-07T08:06:53.266Z",
    },
  ]);

  assert.equal(grouped[0]?.toolKind, "shell");
});

test("groupToolCalls preserves the server-assigned shell kind for structured Find payloads", () => {
  const grouped = groupToolCalls([
    {
      id: "call-shell-find",
      kind: "shell",
      title: "Find `**/AGENTS.md`",
      status: "completed",
      input: JSON.stringify({
        pattern: "**/AGENTS.md",
      }),
      timestamp: "2026-07-07T14:42:00.952Z",
      updatedAt: "2026-07-07T14:42:02.458Z",
    },
  ]);

  assert.equal(grouped[0]?.toolKind, "shell");
});

test("resolveToolCallTone displays todo as a generic built-in activity", () => {
  assert.deepEqual(resolveToolCallTone("todo", "0 todos"), {
    label: "Todo",
    className: "tool-call-builtin",
    icon: "☑",
  });
});

test("resolveToolCallTone trusts explicit kinds over subagent-like titles", () => {
  assert.deepEqual(resolveToolCallTone("search", "Explore async refresh flow"), {
    label: "Search",
    className: "tool-call-mcp",
    icon: "⌕",
  });
});

test("resolveToolCallTone does not infer MCP from bare router-style tool names", () => {
  assert.deepEqual(resolveToolCallTone("tool", "search_context"), {
    label: "Tool",
    className: "tool-call-generic",
    icon: "·",
  });
});

test("groupToolCalls summarizes Codex rawInput shell command arrays", () => {
  const grouped = groupToolCalls([
    {
      id: "call-shell-raw",
      kind: "shell",
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
      kind: "shell",
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
      kind: "shell",
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
      kind: "shell",
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

