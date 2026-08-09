import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const routesSource = readFileSync(resolve(currentDir, "../../shared/utils/routes.ts"), "utf8");
const routeContentSource = readFileSync(resolve(currentDir, "route-content.tsx"), "utf8");
const rootSource = readFileSync(resolve(currentDir, "../shell/root.tsx"), "utf8");

test("v6 dashboard is a first-class route and radial destination", () => {
  assert.match(routesSource, /\"dashboard\"/);
  assert.match(routesSource, /dashboard:\s*\"\/dashboard\"/);
  assert.match(routeContentSource, /features\/dashboard\/ui\/page/);
  assert.match(routeContentSource, /activeView === \"dashboard\"/);
  assert.match(routeContentSource, /sessionPlans/);
  assert.match(routeContentSource, /onOpenSession=\{\(sessionId\) =>/);
  assert.match(rootSource, /RadialMenu/);
  assert.match(rootSource, /id:\s*\"dashboard\"/);
  assert.match(rootSource, /enabled=\{route\.activeView !== "dashboard"\}/);
});
