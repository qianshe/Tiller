import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionDisplayPanel } from "./display-panel.js";

test("mission overview keeps only worktree, current model and ACP list", () => {
  const html = renderToStaticMarkup(
    createElement(MissionDisplayPanel, {
      style: {},
      pages: [{ id: "overview", title: "概览" }],
      selectedPage: { id: "overview", title: "概览" },
      overviewItems: [
        "HELM · Local Helm",
        "PROJECT · Tiller",
        "WORKTREE · codex/fix-model-config-regression",
        "路径 · D:/myProject/tools/Tiller",
        "摘要 · Project: Tiller Worktree: codex/fix-model-config-regression",
      ],
      runtimeOverviewItems: [
        {
          id: "acp:codex",
          label: "Codex",
          meta: "Tiller · main · 空闲",
          status: "ACP",
          runtimeSessionId: "2 个会话",
          model: "gpt-5.5",
          reasoningEffort: "high",
          children: [
            {
              id: "session-1",
              projectName: "Tiller",
              branchName: "main",
              status: "空闲",
              model: "gpt-5.5",
              reasoningEffort: "high",
            },
          ],
        },
      ],
      currentModelSummary: "当前模型：GPT-5.5 · 推理：Medium",
      selectedDiffFilePath: null,
      diffs: [],
      noDiffSummary: "还没有文件变更。",
      logbookContent: null,
      onAddPage: () => undefined,
      onSelectPage: () => undefined,
      onDragStart: () => undefined,
      onDrop: () => undefined,
      onRenamePage: () => undefined,
      onMovePage: () => undefined,
      onDeletePage: () => undefined,
    }),
  );

  assert.match(html, /ACP/);
  assert.match(html, /2 个会话/);
  assert.match(html, /Codex/);
  assert.match(html, /WORKTREE/);
  assert.ok(html.includes("codex/fix-model-config-regression"));
  assert.match(html, /当前模型：GPT-5.5 · 推理：Medium/);
  assert.match(html, /main · 空闲 · gpt-5.5 · 推理 high/);
  assert.doesNotMatch(html, /HELM/);
  assert.doesNotMatch(html, /PROJECT/);
  assert.doesNotMatch(html, /路径/);
  assert.doesNotMatch(html, /摘要/);
  assert.match(html, /<details[^>]*class="[^"]*mission-runtime-item/);
  assert.doesNotMatch(html, /<details[^>]*\sopen=""/);
});


test("mission overview only shows reconnect for real ACP connections", () => {
  const html = renderToStaticMarkup(
    createElement(MissionDisplayPanel, {
      style: {},
      pages: [{ id: "overview", title: "概览" }],
      selectedPage: { id: "overview", title: "概览" },
      overviewItems: [],
      runtimeOverviewItems: [
        {
          id: "acp:codex:main",
          label: "Codex",
          meta: "main",
          status: "已连接",
          runtimeSessionId: "0 个会话",
          canReconnect: true,
        },
        {
          id: "acp:claude",
          label: "ClaudeCode",
          meta: "暂无连接",
          status: "未连接",
          runtimeSessionId: "暂无连接",
          canConnect: true,
          canReconnect: false,
        },
      ],
      selectedDiffFilePath: null,
      diffs: [],
      noDiffSummary: "还没有文件变更。",
      logbookContent: null,
      onReconnectRuntime: () => undefined,
      onAddPage: () => undefined,
      onSelectPage: () => undefined,
      onDragStart: () => undefined,
      onDrop: () => undefined,
      onRenamePage: () => undefined,
      onMovePage: () => undefined,
      onDeletePage: () => undefined,
    }),
  );

  assert.equal((html.match(/>重连</g) ?? []).length, 1);
  assert.equal((html.match(/>连接</g) ?? []).length, 1);
  assert.match(html, /已连接/);
  assert.match(html, /未连接/);
});
