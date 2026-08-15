import { spawn, type SpawnOptions } from "node:child_process";

export type UpdateCommand = { command: string; args: string[] };

export function resolveUpdateExecutable(platform = process.platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function buildLatestUpdateCommand(platform = process.platform): UpdateCommand {
  return {
    command: resolveUpdateExecutable(platform),
    args: ["install", "-g", "@qianshe/tiller@latest"],
  };
}

export function resolveUpdateSpawnOptions(platform = process.platform): SpawnOptions {
  return platform === "win32"
    ? { stdio: "inherit", shell: true, windowsHide: true }
    : { stdio: "inherit", shell: false };
}

export async function runLatestUpdate(): Promise<number> {
  const { command, args } = buildLatestUpdateCommand();
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, resolveUpdateSpawnOptions());
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
