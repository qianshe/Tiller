import assert from "node:assert/strict";
import test from "node:test";
import {
  indentTypedMarkdownListMarker,
  insertMarkdownLineBreak,
} from "./list-continuation.js";

function insert(value: string, selectionStart = value.length, selectionEnd = selectionStart) {
  return insertMarkdownLineBreak(value, selectionStart, selectionEnd);
}

function indent(value: string, selectionStart = value.length, selectionEnd = selectionStart) {
  return indentTypedMarkdownListMarker(value, selectionStart, selectionEnd);
}

test("indents a newly typed top-level list marker before its content", () => {
  assert.deepEqual(indent("1. "), {
    nextValue: "  1. ",
    nextCaret: 5,
  });
  assert.deepEqual(indent("说明\n- "), {
    nextValue: "说明\n  - ",
    nextCaret: 7,
  });
});

test("does not add another indent to an already indented or non-empty line", () => {
  assert.equal(indent("  1. "), null);
  assert.equal(indent("1. 内容"), null);
  assert.equal(indent("> 1. "), null);
  assert.equal(indent("```\n1. "), null);
});

test("inserts a plain newline when the current line is not a list item", () => {
  assert.deepEqual(insert("继续"), {
    nextValue: "继续\n",
    nextCaret: 3,
  });
});

test("continues unordered markdown markers and keeps their style", () => {
  for (const marker of ["-", "+", "*"]) {
    const result = insert(`${marker} 第一项`);

    assert.deepEqual(result, {
      nextValue: `${marker} 第一项\n${marker} `,
      nextCaret: `${marker} 第一项\n${marker} `.length,
    });
  }
});

test("increments ordered markdown markers and keeps their delimiter", () => {
  assert.deepEqual(insert("1. 第一项"), {
    nextValue: "1. 第一项\n2. ",
    nextCaret: "1. 第一项\n2. ".length,
  });
  assert.deepEqual(insert("5) 第五项"), {
    nextValue: "5) 第五项\n6) ",
    nextCaret: "5) 第五项\n6) ".length,
  });
  assert.deepEqual(insert("1234567890. 大序号"), {
    nextValue: "1234567890. 大序号\n1234567891. ",
    nextCaret: "1234567890. 大序号\n1234567891. ".length,
  });
});

test("preserves indentation when continuing a nested list", () => {
  assert.deepEqual(insert("  1. 子项"), {
    nextValue: "  1. 子项\n  2. ",
    nextCaret: "  1. 子项\n  2. ".length,
  });
});

test("exits a list after pressing Enter on an empty list item", () => {
  assert.deepEqual(insert("- 第一项\n- "), {
    nextValue: "- 第一项\n\n",
    nextCaret: "- 第一项\n\n".length,
  });
  assert.deepEqual(insert("- "), {
    nextValue: "\n",
    nextCaret: 1,
  });
});

test("continues a list at the caret and keeps the unselected suffix", () => {
  const value = "- 第一项 后续内容";
  const selectionStart = "- 第一项".length;

  assert.deepEqual(insert(value, selectionStart), {
    nextValue: "- 第一项\n-  后续内容",
    nextCaret: "- 第一项\n- ".length,
  });
});

test("replaces a selected range with a plain line break", () => {
  assert.deepEqual(insert("abc", 1, 3), {
    nextValue: "a\n",
    nextCaret: 2,
  });
});

test("does not continue list markers inside fenced code blocks", () => {
  assert.deepEqual(insert("```\n- code"), {
    nextValue: "```\n- code\n",
    nextCaret: "```\n- code\n".length,
  });
  assert.deepEqual(insert("~~~\n1. code"), {
    nextValue: "~~~\n1. code\n",
    nextCaret: "~~~\n1. code\n".length,
  });
});

test("does not treat quoted list text as a top-level list", () => {
  assert.deepEqual(insert("> - 引用列表"), {
    nextValue: "> - 引用列表\n",
    nextCaret: "> - 引用列表\n".length,
  });
});

test("continues a list after a closed fenced code block", () => {
  assert.deepEqual(insert("```\n- code\n```\n- item"), {
    nextValue: "```\n- code\n```\n- item\n- ",
    nextCaret: "```\n- code\n```\n- item\n- ".length,
  });
});
