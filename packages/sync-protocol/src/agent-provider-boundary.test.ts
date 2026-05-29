import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const files = ["methods/agent/list.ts", "methods/agent/save.ts"];

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

test("agent protocol methods use explicit ACP runtime provider contract names", () => {
  for (const file of files) {
    const source = readFileSync(join(import.meta.dirname, file), "utf8");
    const broadProviderImports = sharedTypeImports(source).filter(
      (specifier) => specifier === "AcpAgentProvider",
    );

    assert.deepEqual(broadProviderImports, [], `${file} imports broad AcpAgentProvider`);
  }
});
