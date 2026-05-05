import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(root, "src");
const allowedStoreFeatureImports = new Set([
  normalize("features/auth/beacon-cache"),
  normalize("features/helm-connection/daemon-profiles"),
  normalize("features/preferences/storage"),
]);
const bannedCrossFeatureInternals = new Set([
  normalize("utils/agent-model-options-cache"),
  normalize("utils/agent-identity"),
  normalize("utils/composer-options"),
  normalize("utils/project-files-key"),
  normalize("actions/session-command-actions"),
  normalize("actions/session-message-actions"),
  normalize("storage"),
  normalize("enhancer"),
  normalize("timeline"),
  normalize("store"),
]);
const allowedBoundaryImports = new Set([
  `${normalize("features/overview/ui/page.tsx")} -> ${normalize("app/routing/routes")}`,
  `${normalize("shared/ui/layout/top-nav.tsx")} -> ${normalize("app/routing/routes")}`,
  `${normalize("shared/ui/layout/top-nav.tsx")} -> ${normalize("features/preferences/storage")}`,
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

function isFeaturePublicImport(path) {
  const segments = normalize(path).split(sep).filter(Boolean);
  return segments[0] === "features" && segments.length === 2;
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
  const fromSegments = fromRel.split(sep).filter(Boolean);
  const fromFeature = fromSegments[0] === "features" ? fromSegments[1] : null;
  for (const match of source.matchAll(importPattern)) {
    const imported = sourceModulePath(file, match[1]);
    if (!imported) {
      continue;
    }
    const importedArea = sourceArea(imported);
    const importedSegments = imported.split(sep).filter(Boolean);
    const importedFeature = importedSegments[0] === "features" ? importedSegments[1] : null;
    const importedInternalPath = normalize(importedSegments.slice(2).join(sep));
    if (allowedBoundaryImports.has(`${fromRel} -> ${imported}`)) {
      continue;
    }
    if (fromArea === "shared" && ["app", "features", "store"].includes(importedArea)) {
      failures.push(`${fromRel} must not import ${imported} from shared`);
    }
    if (fromArea === "app" && importedArea === "features" && !isFeaturePublicImport(imported)) {
      failures.push(`${fromRel} must import feature public API instead of ${imported}`);
    }
    if (
      fromArea === "features" &&
      importedArea === "features" &&
      fromFeature &&
      importedFeature &&
      fromFeature !== importedFeature &&
      bannedCrossFeatureInternals.has(importedInternalPath)
    ) {
      failures.push(`${fromRel} must not import cross-feature internal ${imported}; use a facade or public API`);
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
