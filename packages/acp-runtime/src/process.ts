import { execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";

export function resolveLaunchSpec(
  command: string,
  args: string[],
) {
  const runtimeArgs = args;
  if (process.platform !== "win32") {
    return { command, args: runtimeArgs };
  }

  const resolvedCommand = resolveWindowsCommand(command);
  if (!resolvedCommand.toLowerCase().endsWith(".cmd")) {
    return { command: resolvedCommand, args: runtimeArgs };
  }

  const cmdContent = readFileSync(resolvedCommand, "utf8");
  const scriptMatch = cmdContent.match(/"%_prog%"\s+"([^"]+)"\s+%\*/u);
  if (scriptMatch) {
    const scriptPath = expandWindowsBatchTarget(scriptMatch[1], resolvedCommand).replace(/\\/g, "/");
    const localNode = join(dirname(resolvedCommand), "node.exe");
    return {
      command: existsSync(localNode) ? localNode : process.execPath,
      args: [scriptPath, ...runtimeArgs],
    };
  }

  const executableMatch = cmdContent.match(/"([^"]+\.(?:exe|cmd|bat))"\s+%\*/iu);
  if (!executableMatch) {
    return { command: resolvedCommand, args: runtimeArgs };
  }

  return {
    command: expandWindowsBatchTarget(executableMatch[1], resolvedCommand),
    args: runtimeArgs,
  };
}

function resolveWindowsCommand(command: string) {
  try {
    const output = execFileSync("where.exe", [command], { encoding: "utf8" });
    const resolved = output.split(/\r?\n/u).find(Boolean)?.trim() ?? command;
    if (!resolved.includes(".") && existsSync(`${resolved}.cmd`)) {
      return `${resolved}.cmd`;
    }
    return resolved;
  } catch {
    return command;
  }
}

function expandWindowsBatchTarget(target: string, resolvedCommand: string) {
  return target.replace(/%dp0%/giu, dirname(resolvedCommand));
}

export function terminateChildProcess(pid: number | undefined) {
  if (!pid) {
    return;
  }

  try {
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
      return;
    }
  } catch {
    // best effort fallback below
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore: process already exited
  }
}

export async function terminateChildProcessAndWait(
  child: ChildProcess | undefined,
  timeoutMs = 5_000,
): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      child.removeListener("close", finish);
      child.removeListener("exit", finish);
      child.removeListener("error", finish);
      resolve();
    };

    child.once("close", finish);
    child.once("exit", finish);
    child.once("error", finish);
    if (child.exitCode !== null || child.signalCode !== null) {
      finish();
      return;
    }
    timeout = setTimeout(finish, timeoutMs);
    terminateChildProcess(child.pid);
  });
}

export function createProtocolStdoutStream(
  source: NodeJS.ReadableStream,
  onDiscardLine?: (line: string) => void,
): Transform {
  let pending = "";
  const filter = new Transform({
    transform(chunk, _encoding, callback) {
      pending += String(chunk);
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = pending.slice(0, newlineIndex + 1);
        pending = pending.slice(newlineIndex + 1);
        pushProtocolLine(this, line, onDiscardLine);
        newlineIndex = pending.indexOf("\n");
      }
      callback();
    },
    flush(callback) {
      if (pending) {
        pushProtocolLine(this, pending, onDiscardLine);
      }
      callback();
    },
  });
  return source.pipe(filter);
}

function pushProtocolLine(
  stream: Transform,
  line: string,
  onDiscardLine?: (line: string) => void,
) {
  if (line.trimStart().startsWith("{")) {
    stream.push(line);
    return;
  }
  const trimmed = line.trim();
  if (trimmed) {
    onDiscardLine?.(trimmed);
  }
}

