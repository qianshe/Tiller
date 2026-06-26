import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const inventoryEventsSource = readFileSync(resolve(currentDir, "inventory-events.ts"), "utf8");

test("inventory events clear git status and graph loading state even when RPC returns failure", () => {
  assert.match(
    inventoryEventsSource,
    /case "project\/git\/status":[\s\S]*if \(payload\.cwd\) \{[\s\S]*loading: false,[\s\S]*message: payload\.message,/s,
  );
  assert.match(
    inventoryEventsSource,
    /case "project\/git\/graph":[\s\S]*if \(payload\.cwd\) \{[\s\S]*loading: false,[\s\S]*message: payload\.message,/s,
  );
});
