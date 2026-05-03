export const WORKSPACE_PACKAGE_NAME = "@tiller/helm";
export const PUBLISH_PACKAGE_NAME = "@qianshe/tiller";

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

  return manifest;
}
