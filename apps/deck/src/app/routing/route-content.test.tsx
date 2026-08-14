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

test("dashboard Git route renders the flattened project scope and history bindings", () => {
  assert.match(routeContentSource, /dashboardSection === "git"/);
  assert.match(routeContentSource, /<DashboardGitWorkspace/);
  assert.match(routeContentSource, /helmRpcClientRefs=\{helmRpcClientRefs\}/);
  assert.match(routeContentSource, /gitStatusByWorktree=\{source\.gitStatusByWorktree \?\? \{\}\}/);
  assert.match(routeContentSource, /gitGraphByWorktree=\{source\.gitGraphByWorktree \?\? \{\}\}/);
  assert.match(routeContentSource, /setGitGraphByWorktree=\{source\.setGitGraphByWorktree\}/);
  assert.doesNotMatch(routeContentSource, /configuredHelms\.find\(\(helm: any\) => endpointKeyForHelm\(helm\) === scope\.helmKey\)/);
  assert.doesNotMatch(routeContentSource, /source\.setSelectedProjectId\?\.\(scope\.projectId\)/);
  assert.doesNotMatch(routeContentSource, /source\.setSelectedCwd\?\.\(scope\.cwd\)/);
});

test("dashboard session actions open an embedded Mission drawer", () => {
  assert.match(routeContentSource, /dashboardMissionSessionId/);
  assert.match(routeContentSource, /setDashboardMissionSessionId/);
  assert.match(routeContentSource, /data-slot="dashboard-mission-drawer"/);
  assert.match(routeContentSource, /DrawerTitle/);
  assert.match(routeContentSource, /<Drawer/);
  assert.match(routeContentSource, /<DrawerContent/);
  assert.match(
    routeContentSource,
    /<MissionRoute[\s\S]*key=\{dashboardMissionSessionId\}[\s\S]*source=\{dashboardMissionSource\}[\s\S]*embedded[\s\S]*chatOnly[\s\S]*\/>/,
  );
  assert.match(routeContentSource, /embedded\?: boolean;\s*chatOnly\?: boolean/);
  assert.match(routeContentSource, /hideSessionCloseAction\?: boolean/);
  assert.match(routeContentSource, /const dashboardMissionDrawerClassName = isMobile/);
  assert.match(routeContentSource, /className=\{dashboardMissionDrawerClassName\}/);
  assert.match(routeContentSource, /userSelect:\s*"text"/);
  assert.match(routeContentSource, /showHandle=\{false\}/);
  assert.match(routeContentSource, /rounded-none border-0/);
  assert.match(routeContentSource, /<Suspense fallback=\{<DashboardMissionDrawerLoading \/>\}>/);
  assert.match(routeContentSource, /direction=\{isMobile \? "bottom" : "right"\}/);
  assert.match(routeContentSource, /h-\[min\(80dvh,720px\)\]/);
  assert.match(routeContentSource, /hideSessionCloseAction/);
  assert.match(routeContentSource, /--dashboard-mission-drawer-width/);
  assert.match(routeContentSource, /w-\[var\(--dashboard-mission-drawer-width\)\]/);
  assert.match(routeContentSource, /max-w-\[calc\(100vw_-_1rem\)\]/);
  assert.match(routeContentSource, /sm:max-w-\[calc\(100vw_-_1rem\)\]/);
  assert.match(routeContentSource, /max-h-\[80dvh\]/);
  assert.match(routeContentSource, /min-h-0 min-w-0 flex-1 overflow-hidden/);
  assert.match(routeContentSource, /dismissible\s+handleOnly=\{!isMobile\}/);
  assert.doesNotMatch(routeContentSource, /dismissible=\{isMobile\}/);
  assert.match(routeContentSource, /width: isMobile \? undefined/);
  assert.match(routeContentSource, /maxWidth: isMobile \? undefined/);
  assert.doesNotMatch(routeContentSource, /sm:right-0/);
  assert.doesNotMatch(routeContentSource, /sm:hidden/);
  assert.match(routeContentSource, /DashboardMissionDrawerResizeHandle/);
  assert.match(routeContentSource, /onCloseSessionView: \(\) => setDashboardMissionSessionId\(null\)/);
  assert.match(routeContentSource, /resolveSessionComposerConfiguration\(\{/);
  assert.match(
    routeContentSource,
    /source\.updateSessionDraftPreferences\(next, dashboardMissionSessionId\)/,
  );
  assert.doesNotMatch(routeContentSource, /<Dialog/);
  assert.doesNotMatch(routeContentSource, /<Sheet/);
  assert.doesNotMatch(routeContentSource, /\[&>button\]:hidden/);
  assert.doesNotMatch(shellStylesSource, /\.dashboard-mission-drawer > button/);
});
