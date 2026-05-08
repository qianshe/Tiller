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

test("cn handles arrays and objects via clsx", () => {
  assert.equal(cn(["a", "b"], { c: true, d: false }), "a b c");
});
