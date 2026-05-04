import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(root, "src");
const allowedStoreFeatureImports = new Set([
  normalize("features/auth/beacon-cache"),
  normalize("features/helm-connection/daemon-profiles"),
  normalize("features/preferences/preferences-storage"),
]);
const allowedBoundaryImports = new Set([
  `${normalize("features/overview/ui/overview-page.tsx")} -> ${normalize("app/routes")}`,
  `${normalize("shared/ui/layout/top-nav.tsx")} -> ${normalize("app/routes")}`,
  `${normalize("shared/ui/layout/top-nav.tsx")} -> ${normalize("features/preferences/preferences-storage")}`,
]);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      return walk(path);
    }
    return [path];
  });
}

function extensionless(path) {
  return path.replace(/\.(test\.)?[cm]?[tj]sx?$/u, "");
}

function sourceModulePath(file, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const absolute = resolve(dirname(file), specifier);
  return normalize(extensionless(relative(srcRoot, absolute)));
}

function sourceArea(path) {
  return path.split(sep)[0] ?? "";
}

const sourceFiles = walk(srcRoot).filter((file) =>
  [".ts", ".tsx"].includes(extname(file)),
);
const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/gu;
const failures = [];

for (const file of sourceFiles) {
  const source = readFileSync(file, "utf8");
  const fromRel = normalize(relative(srcRoot, file));
  const fromArea = sourceArea(fromRel);
  for (const match of source.matchAll(importPattern)) {
    const imported = sourceModulePath(file, match[1]);
    if (!imported) {
      continue;
    }
    const importedArea = sourceArea(imported);
    if (allowedBoundaryImports.has(`${fromRel} -> ${imported}`)) {
      continue;
    }
    if (fromArea === "shared" && ["app", "features", "store"].includes(importedArea)) {
      failures.push(`${fromRel} must not import ${imported} from shared`);
    }
    if (fromArea === "store" && importedArea === "app") {
      failures.push(`${fromRel} must not import app module ${imported}`);
    }
    if (
      fromArea === "store" &&
      importedArea === "features" &&
      !allowedStoreFeatureImports.has(imported)
    ) {
      failures.push(`${fromRel} must not import feature internals ${imported}`);
    }
    if (fromArea === "features" && importedArea === "app") {
      failures.push(`${fromRel} must not import app module ${imported}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`import boundary lint passed (${sourceFiles.length} files)`);
