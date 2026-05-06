import assert from "node:assert/strict";
import test from "node:test";
import { formatRenderError } from "./error-boundary.js";

test("formatRenderError returns concrete render error messages", () => {
  assert.equal(formatRenderError(new Error("Git diff render failed")), "Git diff render failed");
  assert.equal(formatRenderError("plain failure"), "plain failure");
  assert.equal(formatRenderError(null), "未知渲染错误");
});
