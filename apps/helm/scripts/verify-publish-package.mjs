import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const INTERNAL_STATIC_IMPORT_PATTERN =
  /\b(?:import|export)\s+(?:(?:[^"'();]+?)\s+from\s+)?["']@tiller\/[^"']+["']/u;
const INTERNAL_DYNAMIC_IMPORT_PATTERN =
  /\bimport\s*\(\s*["']@tiller\/[^"']+["']\s*\)/u;
const WORKSPACE_PROTOCOL_PATTERN = /^workspace:/u;
const DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];

export function assertPublishManifestIsPortable(manifest) {
  for (const field of DEPENDENCY_FIELDS) {
    const dependencyMap = manifest?.[field];
    if (!dependencyMap || typeof dependencyMap !== "object") {
      continue;
    }
    for (const [name, version] of Object.entries(dependencyMap)) {
      if (name.startsWith("@tiller/")) {
        throw new Error(
          `Publish manifest contains internal workspace dependency ${field}.${name}.`,
        );
      }
      if (typeof version === "string" && WORKSPACE_PROTOCOL_PATTERN.test(version)) {
        throw new Error(
          `Publish manifest contains workspace protocol in ${field}.${name}: ${version}`,
        );
      }
    }
  }
}

export function assertPublishBundleHasNoInternalImports(bundleSource) {
  const match =
    bundleSource.match(INTERNAL_STATIC_IMPORT_PATTERN) ??
    bundleSource.match(INTERNAL_DYNAMIC_IMPORT_PATTERN);
  if (match) {
    throw new Error(`Publish bundle contains internal bare import ${match[0]}.`);
  }
}

export function verifyPublishPackage(options = {}) {
  const publishRoot = options.publishRoot
    ? resolve(options.publishRoot)
    : resolve(import.meta.dirname, "..", "dist-package");
  const manifestPath = resolve(publishRoot, "package.json");
  const bundlePath = resolve(publishRoot, "dist", "index.js");

  if (!existsSync(manifestPath)) {
    throw new Error(`Publish manifest not found: ${manifestPath}`);
  }
  if (!existsSync(bundlePath)) {
    throw new Error(`Publish bundle not found: ${bundlePath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bundleSource = readFileSync(bundlePath, "utf8");

  assertPublishManifestIsPortable(manifest);
  assertPublishBundleHasNoInternalImports(bundleSource);

  return { manifestPath, bundlePath };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  verifyPublishPackage();
}
