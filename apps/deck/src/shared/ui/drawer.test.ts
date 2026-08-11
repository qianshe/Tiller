import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const drawerSource = readFileSync(resolve(currentDir, "drawer.tsx"), "utf8");

test("drawer follows the shadcn mobile interaction contract", () => {
  assert.match(drawerSource, /from "vaul"/);
  assert.match(drawerSource, /data-\[vaul-drawer-direction=bottom\]:inset-x-0/);
  assert.match(drawerSource, /data-\[vaul-drawer-direction=bottom\]:bottom-0/);
  assert.match(drawerSource, /data-\[vaul-drawer-direction=bottom\]:max-h-\[80vh\]/);
  assert.match(drawerSource, /group-data-\[vaul-drawer-direction=bottom\]\/drawer-content:block/);
  assert.match(drawerSource, /fixed inset-0 z-50 bg-black\/50/);
  assert.doesNotMatch(drawerSource, /data-\[vaul-drawer-direction=(top|bottom|left|right)\]:border/);
  assert.doesNotMatch(drawerSource, /data-\[vaul-drawer-direction=(top|bottom|left|right)\]:rounded/);
  assert.match(drawerSource, /showHandle\?: boolean/);
  assert.match(drawerSource, /showHandle = true/);
  assert.doesNotMatch(drawerSource, /lucide-react/);
});
