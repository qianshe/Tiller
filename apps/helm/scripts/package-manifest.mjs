export const WORKSPACE_PACKAGE_NAME = "@tiller/helm";
export const PUBLISH_PACKAGE_NAME = "@qianshe/tiller";
const INTERNAL_WORKSPACE_SCOPE = "@tiller/";
const PUBLISH_DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];

const PUBLISH_MANIFEST_FIELDS = [
  "version",
  "type",
  "engines",
  "bin",
  "exports",
  "files",
  "dependencies",
  "description",
  "keywords",
  "license",
  "author",
  "homepage",
  "repository",
  "bugs",
  "publishConfig",
];

export function createPublishPackageManifest(workspaceManifest) {
  const manifest = {
    name: PUBLISH_PACKAGE_NAME,
  };

  for (const field of PUBLISH_MANIFEST_FIELDS) {
    if (workspaceManifest[field] !== undefined) {
      manifest[field] = workspaceManifest[field];
    }
  }

  manifest.bin = { tiller: "./dist/index.js" };
  manifest.files = ["dist"];
  manifest.publishConfig = {
    access: "public",
    registry: "https://registry.npmjs.org/",
    ...manifest.publishConfig,
  };
  for (const field of PUBLISH_DEPENDENCY_FIELDS) {
    if (manifest[field] === undefined) {
      continue;
    }
    const sanitized = sanitizePublishDependencyMap(manifest[field], field);
    if (sanitized) {
      manifest[field] = sanitized;
      continue;
    }
    delete manifest[field];
  }

  return manifest;
}

export function sanitizePublishDependencyMap(dependencies, fieldName = "dependencies") {
  const entries = Object.entries(dependencies ?? {});
  if (!entries.length) {
    return undefined;
  }

  const sanitized = {};
  for (const [name, version] of entries) {
    if (name.startsWith(INTERNAL_WORKSPACE_SCOPE)) {
      continue;
    }
    if (typeof version === "string" && version.startsWith("workspace:")) {
      throw new Error(
        `Unsupported publish dependency protocol for ${fieldName}.${name}: ${version}`,
      );
    }
    sanitized[name] = version;
  }

  return Object.keys(sanitized).length ? sanitized : undefined;
}
