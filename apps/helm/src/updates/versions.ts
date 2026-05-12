type ParsedVersion = { major: number; minor: number; patch: number; prerelease: string[] };

const PRERELEASE_ORDER = new Map([
  ["alpha", 0],
  ["beta", 1],
  ["rc", 2],
]);

export function isVersionGreater(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export function compareVersions(left: string, right: string): -1 | 0 | 1 {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] > b[key]) return 1;
    if (a[key] < b[key]) return -1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

function parseVersion(version: string): ParsedVersion {
  const [core = "0.0.0", prereleaseText = ""] = version.trim().split("-", 2);
  const [major = 0, minor = 0, patch = 0] = core.split(".").map((part) => Number(part));
  return {
    major: Number.isInteger(major) ? major : 0,
    minor: Number.isInteger(minor) ? minor : 0,
    patch: Number.isInteger(patch) ? patch : 0,
    prerelease: prereleaseText ? prereleaseText.split(".") : [],
  };
}

function comparePrerelease(left: string[], right: string[]): -1 | 0 | 1 {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const result = comparePrereleasePart(left[index], right[index]);
    if (result !== 0) return result;
  }
  return 0;
}

function comparePrereleasePart(left = "", right = ""): -1 | 0 | 1 {
  if (left === right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isInteger(leftNumber) && Number.isInteger(rightNumber)) {
    return leftNumber > rightNumber ? 1 : -1;
  }

  const leftRank = PRERELEASE_ORDER.get(left);
  const rightRank = PRERELEASE_ORDER.get(right);
  if (leftRank !== undefined && rightRank !== undefined && leftRank !== rightRank) {
    return leftRank > rightRank ? 1 : -1;
  }

  return left > right ? 1 : -1;
}
