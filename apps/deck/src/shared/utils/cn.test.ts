import { test } from "node:test";
import assert from "node:assert/strict";
import { cn } from "./cn";

test("cn merges plain class strings", () => {
  assert.equal(cn("a", "b"), "a b");
});

test("cn drops falsy values", () => {
  assert.equal(cn("a", false, null, undefined, "b"), "a b");
});

test("cn picks the last conflicting tailwind class (tailwind-merge)", () => {
  assert.equal(cn("p-2", "p-4"), "p-4");
  assert.equal(cn("text-sm", "text-lg"), "text-lg");
});

test("cn keeps Workbench text tokens with color and alignment utilities", () => {
  const result = cn("text-left text-section text-foreground");

  assert.match(result, /text-left/);
  assert.match(result, /text-section/);
  assert.match(result, /text-foreground/);
});

test("cn merges conflicting Workbench font-size tokens with last one winning", () => {
  assert.equal(cn("text-meta text-section"), "text-section");
  assert.equal(cn("text-2xs text-default"), "text-default");
});

test("cn treats Tailwind and Workbench font sizes as the same conflict group", () => {
  assert.equal(cn("text-sm text-action"), "text-action");
  assert.equal(cn("text-display text-xs"), "text-xs");
});

test("cn handles arrays and objects via clsx", () => {
  assert.equal(cn(["a", "b"], { c: true, d: false }), "a b c");
});
