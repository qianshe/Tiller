import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FileDiffSummary } from "@tiller/shared";
import {
  buildMissionDiffTree,
  renderDiffPatch,
  renderDiffStats,
} from "./diff-tree.js";

function diff(path: string, additions = 1, deletions = 1): FileDiffSummary {
  return {
    path,
    status: "modified",
    additions,
    deletions,
    patch: "",
  } as FileDiffSummary;
}

test("diff patch renders hunk lines with semantic colors and horizontal scrolling", () => {
  const patch = [
    "diff --git a/a.ts b/a.ts",
    "index 111..222 100644",
    "@@ -1,2 +1,3 @@",
    " const keep = true;",
    "-const oldValue = 1;",
    "+const newValue = 2;",
  ].join("\n");

  const html = renderToStaticMarkup(renderDiffPatch(patch));

  assert.match(html, /max-w-full/);
  assert.match(html, /min-w-0/);
  assert.match(html, /overflow-x-auto/);
  assert.match(html, /diff-line-meta/);
  assert.match(html, /diff-line-hunk/);
  assert.match(html, /diff-line-deleted/);
  assert.match(html, /diff-line-added/);
  assert.match(html, /bg-\[var\(--diff-added-bg\)\]/);
  assert.match(html, /text-\[var\(--diff-added-text\)\]/);
  assert.match(html, /bg-\[var\(--diff-deleted-bg\)\]/);
  assert.match(html, /text-\[var\(--diff-deleted-text\)\]/);
  assert.match(html, /bg-\[var\(--diff-hunk-bg\)\]/);
});

test("diff tree compacts single-directory chains", () => {
  const tree = buildMissionDiffTree([
    diff("apps/deck/src/features/mission/hooks/slash-commands.ts"),
    diff("apps/deck/src/features/mission/ui/slash-command-popup.tsx"),
    diff("apps/helm/src/runtime/events.ts"),
  ]);

  const apps = tree.find((node) => node.name === "apps");
  const compactDeck = apps?.children?.find(
    (node) => node.name === "deck/src/features/mission",
  );

  assert.equal(apps?.path, "apps");
  assert.equal(compactDeck?.path, "apps/deck/src/features/mission");
  assert.equal(compactDeck?.count, 2);
});

test("diff stats color additions and deletions by semantic value", () => {
  const html = renderToStaticMarkup(renderDiffStats(diff("a.ts", 3, 0)));

  assert.match(html, /diff-additions[^\"]*text-success/);
  assert.match(html, /diff-deletions[^\"]*text-muted-foreground/);
  assert.match(html, /\+3/);
  assert.match(html, /-0/);
});
