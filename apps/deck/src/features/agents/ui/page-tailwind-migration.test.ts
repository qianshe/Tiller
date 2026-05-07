import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));

function readUiFile(fileName: string): string {
  return readFileSync(resolve(currentDir, fileName), "utf8");
}

test("agents overview layout uses shared UI and Tailwind classes", () => {
  const page = readUiFile("page.tsx");
  const helmHub = readUiFile("helm-hub.tsx");
  const helmDetail = readUiFile("helm-detail-section.tsx");
  const migratedSource = [page, helmHub, helmDetail].join("\n");

  assert.match(page, /import \{ Card \} from "@\/shared\/ui"/);
  assert.match(helmHub, /import \{ Button, Card, CardContent, CardHeader, CardTitle \} from "@\/shared\/ui"/);
  assert.match(helmDetail, /import \{ Badge, Card, CardContent, CardHeader \} from "@\/shared\/ui"/);

  for (const legacyClass of [
    "fleet-command-panel",
    "fleet-title-row",
    "fleet-hub",
    "fleet-hub-head",
    "fleet-hub-node",
    "helm-status-dot",
    "helm-detail-panel",
    "helm-detail-facts",
    "helm-inventory-list-stack",
  ]) {
    assert.doesNotMatch(migratedSource, new RegExp(`className=[^\\n]*${legacyClass}`));
  }
});
