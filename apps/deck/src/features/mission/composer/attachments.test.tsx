import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MissionPromptContextItem } from "@tiller/shared";
import { ComposerAttachments } from "./attachments";

const DRAFT_CONTEXTS: MissionPromptContextItem[] = [
  {
    id: "quote-1",
    kind: "quote",
    label: "assistant 引用",
    comment: "解释这里",
    excerpt: "selected text",
    source: { kind: "quote", messageId: "message-1", role: "assistant" },
  },
  {
    id: "diff-1",
    kind: "diff",
    label: "panel.tsx:44-46",
    comment: "检查改动",
    excerpt: "+ next line",
    source: { kind: "diff", filePath: "panel.tsx", startLine: 44, endLine: 46 },
  },
];

test("composer collapses draft contexts into one counted comments trigger", () => {
  const html = renderToStaticMarkup(createElement(ComposerAttachments, {
    promptImages: [],
    removePromptImage: () => undefined,
    reviewContext: {
      draftContexts: DRAFT_CONTEXTS,
      removeDraftContext: () => undefined,
    },
  }));

  assert.match(html, /aria-label="评论 2，展开查看"/u);
  assert.equal((html.match(/mission-attachment-chip/gu) ?? []).length, 1);
  assert.doesNotMatch(html, /assistant 引用/u);
  assert.doesNotMatch(html, /panel\.tsx:44-46/u);
});

test("composer keeps comments and images in one row with comments first", () => {
  const html = renderToStaticMarkup(createElement(ComposerAttachments, {
    promptImages: [
      { type: "image", mimeType: "image/png", data: "AAA", name: "one.png" },
      { type: "image", mimeType: "image/png", data: "BBB", name: "two.png" },
    ],
    removePromptImage: () => undefined,
    reviewContext: {
      draftContexts: [DRAFT_CONTEXTS[0]!],
      removeDraftContext: () => undefined,
    },
  }));

  assert.match(html, /mission-attachment-strip[^\"]*flex[^\"]*overflow-x-auto/);
  assert.match(html, /aria-label="待发送评论上下文"/u);
  assert.match(html, /aria-label="待发送图片"/u);
  assert.ok(
    html.indexOf('aria-label="评论 1，展开查看"') < html.indexOf("图片 1"),
    "comments should render before the first image",
  );
  assert.ok(
    html.indexOf("图片 1") < html.indexOf("图片 2"),
    "images should preserve their input order",
  );
});
