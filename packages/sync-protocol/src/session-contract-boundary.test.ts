import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const canonicalSessionTypes = new Set(["SessionResumeInfo", "SessionStatus", "SessionSummary"]);

const files = [
  "methods/approval/created.ts",
  "methods/session/check-resume.ts",
  "methods/session/list.ts",
  "methods/session/new.ts",
  "methods/session/prompt.ts",
  "methods/session/resume.ts",
  "methods/session/update.ts",
];

function sharedTypeImports(source: string) {
  const imports: string[] = [];
  const pattern = /import\s+type\s+\{(?<specifiers>[^}]*?)\}\s+from\s+"@tiller\/shared";/g;
  for (const match of source.matchAll(pattern)) {
    const specifiers = match.groups?.specifiers ?? "";
    imports.push(
      ...specifiers
        .split(",")
        .map((specifier) => specifier.trim())
        .filter(Boolean),
    );
  }
  return imports;
}

test("session protocol methods import canonical session DTOs from domain-contracts", () => {
  for (const file of files) {
    const source = readFileSync(join(import.meta.dirname, file), "utf8");
    const sharedCanonicalImports = sharedTypeImports(source).filter((specifier) =>
      canonicalSessionTypes.has(specifier),
    );

    assert.deepEqual(sharedCanonicalImports, [], `${file} imports canonical session DTOs from shared`);
  }
});
