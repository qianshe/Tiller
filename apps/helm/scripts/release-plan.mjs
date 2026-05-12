import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function createReleasePlan(bump) {
  switch (bump) {
    case "prerelease-alpha":
      return {
        bump,
        distTag: "preview",
        npmVersionArgs: ["prerelease", "--preid", "alpha"],
      };
    case "prerelease-beta":
      return {
        bump,
        distTag: "preview",
        npmVersionArgs: ["prerelease", "--preid", "beta"],
      };
    case "prerelease-rc":
      return {
        bump,
        distTag: "preview",
        npmVersionArgs: ["prerelease", "--preid", "rc"],
      };
    case "patch":
    case "minor":
    case "major":
      return {
        bump,
        distTag: "latest",
        npmVersionArgs: [bump],
      };
    default:
      throw new Error(`Unsupported bump type: ${bump}`);
  }
}

export function writeGitHubOutputs(plan, output = process.stdout) {
  output.write(`bump=${plan.bump}\n`);
  output.write(`dist_tag=${plan.distTag}\n`);
  output.write(`npm_version_args=${plan.npmVersionArgs.join(" ")}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    writeGitHubOutputs(createReleasePlan(process.argv[2]));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
