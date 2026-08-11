import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const routeContentSource = readFileSync(resolve(currentDir, "route-content.tsx"), "utf8");
const shellStylesSource = readFileSync(resolve(currentDir, "../shell/styles.css"), "utf8");

test("dashboard route delegates view-model derivation and keeps response handler", () => {
  assert.match(routeContentSource, /buildDashboardViewModel/);
  assert.match(routeContentSource, /\.\.\/\.\.\/features\/dashboard/);
  assert.doesNotMatch(routeContentSource, /function resolveDashboardApprovalDecision/);
  assert.doesNotMatch(routeContentSource, /function resolveDashboardApprovalText/);
  assert.match(
    routeContentSource,
    /onRespondApproval=\{\(approvalRequestId, decision\) =>\s*respondToPermission\(approvalRequestId, decision\)\s*\}/,
  );
  assert.match(routeContentSource, /onSelectSection=\{setDashboardSection\}/);
  assert.match(routeContentSource, /onOpenMission=\{\(\) => navigateToView\("sessions"\)\}/);
  assert.match(routeContentSource, /onOpenSearchSession=\{openDashboardMission\}/);
  assert.doesNotMatch(routeContentSource, /onOpenSearchSession=\{\(sessionId\) =>[\s\S]*navigateToView\("sessions"\)/);
  assert.match(routeContentSource, /embeddedContent=/);
  assert.doesNotMatch(routeContentSource, /onNavigateSessions=/);
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

test("dashboard embeds the dedicated Agents presentation mode and add Helm action", () => {
  assert.match(routeContentSource, /dashboardSection === "agents"\s*\? renderAgents\("dashboard"\)/);
  assert.match(routeContentSource, /dashboardSection === "settings"\s*\? renderSettings\("dashboard"\)/);
  assert.match(routeContentSource, /openFleetAddHelmModal=\{openFleetAddHelmModal\}/);
  assert.match(routeContentSource, /mode=\{mode\}/);
});

test("dashboard session actions open an embedded Mission dialog", () => {
  assert.match(routeContentSource, /dashboardMissionSessionId/);
  assert.match(routeContentSource, /setDashboardMissionSessionId/);
  assert.match(routeContentSource, /data-slot="dashboard-mission-dialog"/);
  assert.match(routeContentSource, /DialogTitle/);
  assert.match(
    routeContentSource,
    /<MissionRoute[\s\S]*key=\{dashboardMissionSessionId\}[\s\S]*source=\{dashboardMissionSource\}[\s\S]*embedded[\s\S]*chatOnly[\s\S]*\/>/,
  );
  assert.match(routeContentSource, /embedded\?: boolean;\s*chatOnly\?: boolean/);
  assert.match(routeContentSource, /className="dashboard-mission-dialog/);
  assert.match(routeContentSource, /\[&>button\]:hidden/);
  assert.match(routeContentSource, /onCloseSessionView: \(\) => setDashboardMissionSessionId\(null\)/);
  assert.doesNotMatch(shellStylesSource, /\.dashboard-mission-dialog > button/);
});
