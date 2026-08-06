import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const routeContentSource = readFileSync(resolve(currentDir, "route-content.tsx"), "utf8");

test("dashboard route delegates view-model derivation and keeps response handler", () => {
  assert.match(routeContentSource, /buildDashboardViewModel/);
  assert.match(routeContentSource, /\.\.\/\.\.\/features\/dashboard/);
  assert.doesNotMatch(routeContentSource, /function resolveDashboardApprovalDecision/);
  assert.doesNotMatch(routeContentSource, /function resolveDashboardApprovalText/);
  assert.match(
    routeContentSource,
    /onRespondApproval=\{\(approvalRequestId, decision\) =>\s*respondToPermission\(approvalRequestId, decision\)\s*\}/,
  );
});

test("route content uses typed route context bridge", () => {
  assert.match(routeContentSource, /import type \{ AppRouteContext, MissionRouteSource \} from "\.\/route-context"/);
  assert.doesNotMatch(routeContentSource, /ctx\s*}: \{ ctx: any \}/);
  assert.doesNotMatch(routeContentSource, /source }: \{ source: any \}/);
});

test("agents route forwards the requested initial tab", () => {
  assert.match(routeContentSource, /agentsInitialTab,/);
  assert.match(routeContentSource, /initialTab=\{agentsInitialTab\}/);
});
