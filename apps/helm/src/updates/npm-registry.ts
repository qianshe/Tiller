export const TILLER_NPM_PACKAGE = "@qianshe/tiller";
export const TILLER_NPM_REGISTRY_URL = "https://registry.npmjs.org/@qianshe%2ftiller";

export type NpmDistTags = { latest?: string; preview?: string };

export async function fetchTillerNpmDistTags(
  fetchImpl: typeof fetch = fetch,
): Promise<NpmDistTags> {
  const response = await fetchImpl(TILLER_NPM_REGISTRY_URL, {
    headers: { accept: "application/vnd.npm.install-v1+json, application/json" },
  });
  if (!response.ok) {
    throw new Error(`npm registry responded with HTTP ${response.status}`);
  }
  const body = (await response.json()) as unknown;
  const distTags =
    body && typeof body === "object"
      ? (body as { "dist-tags"?: unknown })["dist-tags"]
      : undefined;
  const latest =
    distTags && typeof distTags === "object"
      ? (distTags as { latest?: unknown }).latest
      : undefined;
  if (typeof latest !== "string" || !latest.trim()) {
    throw new Error("npm registry did not return a latest version.");
  }
  const preview =
    distTags && typeof distTags === "object"
      ? (distTags as { preview?: unknown }).preview
      : undefined;
  return {
    latest: latest.trim(),
    ...(typeof preview === "string" && preview.trim()
      ? { preview: preview.trim() }
      : {}),
  };
}
