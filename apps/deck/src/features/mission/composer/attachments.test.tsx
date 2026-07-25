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
