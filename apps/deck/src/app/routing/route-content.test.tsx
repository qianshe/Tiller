import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const routeContentSource = readFileSync(resolve(currentDir, "route-content.tsx"), "utf8");

test("dashboard route maps approvals with session labels, tool labels, and response handler", () => {
  assert.match(routeContentSource, /resolvePermissionCommandDisplay/);
  assert.match(routeContentSource, /sessionName/);
  assert.match(routeContentSource, /allowDecision:/);
  assert.match(routeContentSource, /respondToPermission,/);
  assert.match(
    routeContentSource,
    /onRespondApproval=\{\(approvalRequestId, decision\) =>\s*respondToPermission\(approvalRequestId, decision\)\s*\}/,
  );
});
