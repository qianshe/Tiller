import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: unknown;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type ProbeOptions = {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
};

type ModelOption = {
  modelId: string;
  name: string;
  description?: string;
};

type SessionModelState = {
  currentModelId?: string;
  options: ModelOption[];
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../..");
const LOG_DIR = resolve(REPO_ROOT, "logs", "acp");
const LOG_FILE = resolve(LOG_DIR, `probe-codex-models-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`);

mkdirSync(LOG_DIR, { recursive: true });

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = createJsonRpcClient(options);

  console.log(`Codex ACP probe command: ${quoteCommand(options.command, options.args)}`);
  console.log(`cwd: ${options.cwd}`);
  console.log(`raw log: ${LOG_FILE}`);

  try {
    const initializeResult = await client.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "tiller-codex-model-probe", version: "0.1.0" },
    });

    const initializeRecord = readRecord(initializeResult);
    const capabilities = initializeRecord?.capabilities ?? initializeRecord?.agentCapabilities ?? null;
    console.log("initialize.capabilities:", JSON.stringify(capabilities, null, 2));

    const sessionResult = await client.request("session/new", {
      cwd: options.cwd,
      mcpServers: [],
    });

    const sessionRecord = readRecord(sessionResult);
    const sessionId = readString(sessionRecord?.sessionId) ?? readString(sessionRecord?.session_id) ?? readString(sessionRecord?.id);
    console.log(`session id: ${sessionId ?? "<not returned>"}`);

    const modelState = extractSessionModelState(sessionResult);
    const configModelState = extractConfigModelState(sessionResult);
    if (!modelState && !configModelState) {
      console.warn("No ACP session.models or model configOptions returned. Inspect the raw log for provider-specific fields.");
      console.log(`raw session/new result: ${JSON.stringify(sessionResult, null, 2)}`);
      return;
    }

    if (modelState) {
      console.log(`models.currentModelId: ${modelState.currentModelId ?? "<none>"}`);
      printModelTable("models.availableModels", modelState.options);
    }

    if (configModelState) {
      console.log(`configOptions.model.currentValue: ${configModelState.currentModelId ?? "<none>"}`);
      printModelTable("configOptions.model.options", configModelState.options);
    }
  } finally {
    client.close();
  }
}

function createJsonRpcClient(options: ProbeOptions) {
  const launch = resolveLaunchCommand(options.command, options.args);
  const child = spawn(launch.command, launch.args, {
    cwd: options.cwd,
    env: sanitizeChildEnv(process.env),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let sequence = 1;
  let stdoutBuffer = "";
  const pending = new Map<string, PendingRequest>();

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        handleStdoutLine(line, pending);
      }
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    appendLog({ stream: "stderr", text });
    process.stderr.write(text);
  });

  child.on("exit", (code, signal) => {
    const message = `ACP process exited before all requests completed (code=${code ?? "unknown"}, signal=${signal ?? "none"}).`;
    appendLog({ stream: "exit", code, signal });
    rejectAll(pending, new Error(message));
  });

  child.on("error", (error) => {
    appendLog({ stream: "process-error", message: error.message });
    rejectAll(pending, error);
  });

  return {
    request(method: string, params: Record<string, JsonValue>) {
      const id = `probe-${sequence++}`;
      const payload = { jsonrpc: "2.0", id, method, params };
      appendLog({ stream: "stdin", payload });

      return new Promise<unknown>((resolvePromise, rejectPromise) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          rejectPromise(new Error(`Timed out waiting for ACP response to ${method} after ${options.timeoutMs}ms.`));
        }, options.timeoutMs);

        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolvePromise(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            rejectPromise(error);
          },
          timeout,
        });

        child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
          if (error) {
            const pendingRequest = pending.get(id);
            pending.delete(id);
            pendingRequest?.reject(error);
          }
        });
      });
    },
    close() {
      rejectAll(pending, new Error("ACP probe closed."));
      closeChild(child);
    },
  };
}

function handleStdoutLine(line: string, pending: Map<string, PendingRequest>) {
  appendLog({ stream: "stdout", line });

  let message: JsonRpcResponse;
  try {
    message = JSON.parse(line) as JsonRpcResponse;
  } catch {
    appendLog({ stream: "parse-error", line });
    return;
  }

  if (message.id === undefined || message.id === null) {
    return;
  }

  const request = pending.get(String(message.id));
  if (!request) {
    return;
  }

  pending.delete(String(message.id));
  if (message.error !== undefined) {
    request.reject(new Error(`ACP error for ${message.id}: ${JSON.stringify(message.error)}`));
    return;
  }
  request.resolve(message.result);
}

function rejectAll(pending: Map<string, PendingRequest>, error: Error) {
  for (const [id, request] of pending) {
    pending.delete(id);
    clearTimeout(request.timeout);
    request.reject(error);
  }
}

function closeChild(child: ChildProcessWithoutNullStreams) {
  if (child.killed) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }

  child.kill();
}

function extractSessionModelState(payload: unknown): SessionModelState | null {
  const session = readRecord(payload);
  const models = readRecord(session?.models);
  if (!models) {
    return null;
  }

  const availableModels = readArray(models.availableModels) ?? readArray(models.available_models) ?? [];
  const currentModelId = readString(models.currentModelId) ?? readString(models.current_model_id);
  const options = availableModels.map(normalizeModel).filter((model): model is ModelOption => model !== null);

  return { currentModelId, options };
}

function normalizeModel(payload: unknown): ModelOption | null {
  const record = readRecord(payload);
  if (!record) {
    return null;
  }

  const modelId = readString(record.modelId) ?? readString(record.model_id) ?? readString(record.id);
  if (!modelId) {
    return null;
  }

  return {
    modelId,
    name: readString(record.name) ?? modelId,
    description: readString(record.description),
  };
}

function extractConfigModelState(payload: unknown): SessionModelState | null {
  const configOptions = extractConfigOptions(payload);
  const modelOption = configOptions.find((option) => readString(option.category)?.toLowerCase() === "model");
  if (!modelOption) {
    return null;
  }

  const optionValues = readArray(modelOption.options) ?? [];
  const options = optionValues.map(normalizeConfigModel).filter((model): model is ModelOption => model !== null);
  if (options.length === 0) {
    return null;
  }

  return {
    currentModelId: readString(modelOption.currentValue) ?? readString(modelOption.selectedValue) ?? readString(modelOption.value),
    options,
  };
}

function extractConfigOptions(payload: unknown): Record<string, unknown>[] {
  const record = readRecord(payload);
  const sessionConfig = readRecord(record?.sessionConfig);
  const update = readRecord(record?.update);
  const rawOptions = readArray(record?.configOptions) ?? readArray(sessionConfig?.configOptions) ?? readArray(update?.configOptions) ?? [];
  return rawOptions.map(readRecord).filter((option): option is Record<string, unknown> => option !== null);
}

function normalizeConfigModel(payload: unknown): ModelOption | null {
  const record = readRecord(payload);
  if (!record) {
    return null;
  }

  const modelId = readString(record.value) ?? readString(record.modelId) ?? readString(record.model_id) ?? readString(record.id);
  if (!modelId) {
    return null;
  }

  return {
    modelId,
    name: readString(record.label) ?? readString(record.name) ?? modelId,
    description: readString(record.description),
  };
}

function printModelTable(title: string, options: ModelOption[]) {
  if (options.length === 0) {
    console.warn(`${title} is empty.`);
    return;
  }

  console.log(`${title}: ${options.length} option(s)`);
  console.table(
    options.map((model) => ({
      modelId: model.modelId,
      name: model.name,
      description: model.description ?? "",
    })),
  );
}

function parseArgs(args: string[]): ProbeOptions {
  const parsed: ProbeOptions = {
    command: process.env.ACP_PROBE_COMMAND ?? "codex-acp",
    args: parseEnvArgs(process.env.ACP_PROBE_ARGS),
    cwd: resolve(process.env.ACP_PROBE_CWD ?? process.cwd()),
    timeoutMs: Number(process.env.ACP_PROBE_TIMEOUT_MS ?? 15_000),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--command") {
      parsed.command = requireValue(args, (index += 1), arg);
    } else if (arg === "--cwd") {
      parsed.cwd = resolve(requireValue(args, (index += 1), arg));
    } else if (arg === "--timeout") {
      parsed.timeoutMs = Number(requireValue(args, (index += 1), arg));
    } else if (arg === "--arg") {
      parsed.args.push(requireValue(args, (index += 1), arg));
    } else if (arg === "--help" || arg === "-h") {
      printUsageAndExit();
    } else {
      throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
    }
  }

  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
    throw new Error("--timeout must be a positive number of milliseconds.");
  }

  return parsed;
}

function parseEnvArgs(value: string | undefined) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Fall through to whitespace splitting for simple env usage.
  }
  return value.split(/\s+/).filter(Boolean);
}

function resolveLaunchCommand(command: string, args: string[]) {
  if (process.platform !== "win32") {
    return { command, args };
  }

  const executable = resolveWindowsExecutable(command);
  if (!executable.toLowerCase().endsWith(".cmd") && !executable.toLowerCase().endsWith(".bat")) {
    return { command: executable, args };
  }

  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", quoteCommand(executable, args)],
  };
}

function resolveWindowsExecutable(command: string) {
  if (/[\\/]/u.test(command)) {
    return command;
  }

  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.toLowerCase());
  const candidates = pathEntries.flatMap((entry) => {
    const direct = resolve(entry, command);
    return [direct, ...extensions.map((extension) => `${direct}${extension}`)];
  });

  const cmdCandidate = candidates.find((candidate) => candidate.toLowerCase().endsWith(".cmd") && existsSync(candidate));
  return cmdCandidate ?? candidates.find((candidate) => existsSync(candidate)) ?? command;
}

function requireValue(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function printUsageAndExit(): never {
  console.log(`Usage:
  pnpm --filter @qianshe/tiller probe:acp-models
  pnpm --filter @qianshe/tiller probe:codex-models -- --cwd D:/repo --timeout 30000
  pnpm --filter @qianshe/tiller probe:opencode-models -- --cwd D:/repo --timeout 30000
  pnpm --filter @qianshe/tiller probe:acp-models -- --command codex-acp --arg -c --arg model=gpt-5.4
  pnpm --filter @qianshe/tiller probe:acp-models -- --command opencode --arg acp

Environment:
  ACP_PROBE_COMMAND      default: codex-acp
  ACP_PROBE_ARGS         JSON string array or whitespace-separated args
  ACP_PROBE_CWD          default: current working directory
  ACP_PROBE_TIMEOUT_MS   default: 15000`);
  process.exit(0);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sanitizeChildEnv(env: NodeJS.ProcessEnv) {
  const childEnv = { ...env };
  delete childEnv.NODE_OPTIONS;
  delete childEnv.TSX_TSCONFIG_PATH;
  delete childEnv.TSX_DISABLE_CACHE;
  return childEnv;
}

function quoteCommand(command: string, args: string[]) {
  return [command, ...args].map((part) => (/[\s"]/u.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function appendLog(entry: Record<string, unknown>) {
  appendFileSync(LOG_FILE, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`, "utf8");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`raw log: ${LOG_FILE}`);
  process.exitCode = 1;
});
