import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDiffLineRangeLabel,
  buildDiffSelectionSnapshot,
  diffLineKey,
  parseDiffPatchLines,
  selectContiguousDiffLines,
} from "./diff-comment-selection";

test("buildDiffLineRangeLabel uses the selected real line range", () => {
  const patch = [
    "@@ -10,2 +10,3 @@",
    " const keep = true;",
    "-const oldValue = 1;",
    "+const newValue = 2;",
    "+const newerValue = 3;",
  ].join("\n");
  const lines = parseDiffPatchLines(patch);
  const selectedLineKeys = new Set([
    diffLineKey(lines[2]!),
    diffLineKey(lines[4]!),
  ]);

  assert.equal(buildDiffLineRangeLabel(selectedLineKeys, { patch }), "L11-12");
});

test("parseDiffPatchLines keeps actual old/new line numbers", () => {
  const patch = [
    "diff --git a/a.ts b/a.ts",
    "@@ -10,2 +10,3 @@",
    " const keep = true;",
    "-const oldValue = 1;",
    "+const newValue = 2;",
  ].join("\n");

  const lines = parseDiffPatchLines(patch);
  assert.equal(lines[0]?.kind, "hunk");
  assert.equal(lines[1]?.newLineNumber, 10);
  assert.equal(lines[2]?.oldLineNumber, 11);
  assert.equal(lines[3]?.newLineNumber, 11);
  assert.ok(diffLineKey(lines[3]!).length > 0);
});

test("selectContiguousDiffLines expands to the full visible range between anchor and target", () => {
  const lines = parseDiffPatchLines([
    "@@ -10,2 +10,3 @@",
    " const keep = true;",
    "-const oldValue = 1;",
    "+const newValue = 2;",
    "+const newerValue = 3;",
  ].join("\n"));

  const selected = selectContiguousDiffLines(
    lines,
    diffLineKey(lines[1]!),
    diffLineKey(lines[3]!),
  );

  assert.equal(selected.length, 3);
  assert.deepEqual(selected.map((line) => line.text), [
    " const keep = true;",
    "-const oldValue = 1;",
    "+const newValue = 2;",
  ]);
});

test("selectContiguousDiffLines returns empty when the anchor is missing", () => {
  const lines = parseDiffPatchLines([
    "@@ -10,2 +10,3 @@",
    " const keep = true;",
  ].join("\n"));

  assert.deepEqual(selectContiguousDiffLines(lines, "missing", diffLineKey(lines[1]!)), []);
});

test("buildDiffSelectionSnapshot labels the real file line range", () => {
  const snapshot = buildDiffSelectionSnapshot({
    filePath: "apps/deck/src/features/mission/display/panel.tsx",
    selectedLines: [
      { displayLineNumber: 3, kind: "deleted", text: "-const oldValue = 1;", oldLineNumber: 44 },
      { displayLineNumber: 4, kind: "added", text: "+const newValue = 2;", newLineNumber: 44 },
      { displayLineNumber: 5, kind: "added", text: "+const newerValue = 3;", newLineNumber: 45 },
    ],
    comment: "问问为什么要改这里",
  });

  assert.equal(snapshot.kind, "diff");
  assert.equal(snapshot.comment, "问问为什么要改这里");
  assert.match(snapshot.excerpt, /oldValue/);
  assert.match(snapshot.label, /panel\.tsx:44-45/);
});

test("buildDiffSelectionSnapshot trims leading display numbers when no real lines exist", () => {
  const snapshot = buildDiffSelectionSnapshot({
    filePath: "a.ts",
    selectedLines: [
      { displayLineNumber: 2, kind: "hunk", text: "@@ -1,1 +1,1 @@" },
      { displayLineNumber: 3, kind: "context", text: " ctx", oldLineNumber: 1, newLineNumber: 1 },
    ],
    comment: "  带空白的评论  ",
  });
  // hunk filtered out by selectContiguous but build snapshot receives what caller passes;
  // context line carries real line numbers so label uses them.
  assert.match(snapshot.label, /a\.ts:1-1/);
  assert.equal(snapshot.comment, "带空白的评论");
});
