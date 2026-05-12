import { spawn } from "node:child_process";

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

export async function runLatestUpdate(): Promise<number> {
  const { command, args } = buildLatestUpdateCommand();
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
