import { execFileSync } from "node:child_process";
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
  if (!scriptMatch) {
    return { command: resolvedCommand, args: runtimeArgs };
  }

  const scriptPath = scriptMatch[1].replace(/%dp0%?/giu, dirname(resolvedCommand).replace(/\\/g, "/"));
  const localNode = join(dirname(resolvedCommand), "node.exe");
  return {
    command: existsSync(localNode) ? localNode : process.execPath,
    args: [scriptPath, ...runtimeArgs],
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

export function createProtocolStdoutStream(
  source: NodeJS.ReadableStream,
  onDiscardLine?: (line: string) => void,
): Transform {
  let pending = "";
  const filter = new Transform({
    transform(chunk, _encoding, callback) {
      pending += String(chunk);
      const lines = pending.split(/(?<=\n)/u);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        pushProtocolLine(this, line, onDiscardLine);
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

