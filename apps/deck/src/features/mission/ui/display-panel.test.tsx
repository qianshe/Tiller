import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionDisplayPanel } from "./display-panel.js";

test("mission overview renders active ACP connections below project cards", () => {
  const html = renderToStaticMarkup(
    createElement(MissionDisplayPanel, {
      style: {},
      pages: [{ id: "overview", title: "概览" }],
      selectedPage: { id: "overview", title: "概览" },
      overviewItems: ["Project · Tiller"],
      runtimeOverviewItems: [
        {
          id: "acp:codex",
          label: "Codex",
          meta: "Tiller · main · 空闲",
          status: "ACP",
          runtimeSessionId: "2 个会话",
          children: [
            {
              id: "session-1",
              projectName: "Tiller",
              branchName: "main",
              status: "空闲",
              model: "gpt-5.5",
            },
          ],
        },
      ],
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
  assert.match(html, /Tiller/);
  assert.match(html, /main · 空闲 · gpt-5.5/);
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
