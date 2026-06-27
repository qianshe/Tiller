#!/usr/bin/env node
import * as acp from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function splitCommand(commandLine) {
  const parts = [];
  let current = "";
  let quote = null;
  for (const char of commandLine.trim()) {
    if ((char === "\"" || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/u.test(char) && !quote) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

function usage() {
  return [
    "Usage:",
    "  node packages/acp-runtime/scripts/probe-codex-session-load.mjs --cmd \"node path/to/codex-acp.js\" --session <runtime-session-id> --cwd <cwd>",
    "  node packages/acp-runtime/scripts/probe-codex-session-load.mjs --cmd \"node path/to/codex-acp.js\" --cwd <cwd> --roundtrip-prompt \"reply with OK\"",
  ].join("\n");
}

function updateType(update) {
  return update?.sessionUpdate ?? update?.session_update ?? update?.type ?? "<missing>";
}

function summarize(update, index) {
  const type = updateType(update);
  const base = { seq: index + 1, type };
  if (type === "user_message_chunk" || type === "agent_message_chunk" || type === "agent_thought_chunk") {
    const text = update?.content?.text;
    return {
      ...base,
      textLen: typeof text === "string" ? text.length : undefined,
    };
  }
  if (type === "tool_call" || type === "tool_call_update") {
    return {
      ...base,
      toolCallId: update?.toolCallId,
      status: update?.status,
      title: update?.title,
    };
  }
  if (type === "plan") {
    return {
      ...base,
      entries: Array.isArray(update?.entries) ? update.entries.length : undefined,
    };
  }
  if (type === "available_commands_update") {
    return {
      ...base,
      commandCount: Array.isArray(update?.availableCommands) ? update.availableCommands.length : undefined,
    };
  }
  return base;
}

function rawShapeKeys(updates) {
  const shapes = {};
  for (const update of updates) {
    const type = updateType(update);
    shapes[type] ??= Object.keys(update ?? {}).sort();
  }
  return shapes;
}

function countTypes(updates) {
  const counts = {};
  for (const update of updates) {
    const type = updateType(update);
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

function comparableUpdates(updates) {
  return updates
    .filter((update) => updateType(update) !== "available_commands_update")
    .map((update) => ({
      type: updateType(update),
      text: update?.content?.text,
      toolCallId: update?.toolCallId,
      status: update?.status,
    }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const roundtripPrompt = args["roundtrip-prompt"];
  if (!args.cmd || !args.cwd || (!args.session && !roundtripPrompt)) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const [command, ...commandArgs] = splitCommand(args.cmd);
  if (!command) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const child = spawn(command, commandArgs, {
    cwd: args.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  let capturePhase = "init";
  const capturedUpdates = [];
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout),
  );
  const agent = new acp.ClientSideConnection(
    () => ({
      sessionUpdate(params) {
        capturedUpdates.push({ phase: capturePhase, update: params?.update });
      },
      requestPermission() {
        return { outcome: { outcome: "cancelled" } };
      },
      async readTextFile() {
        throw new Error("probe does not serve file reads");
      },
      async writeTextFile() {
        throw new Error("probe does not serve file writes");
      },
      async createTerminal() {
        throw new Error("probe does not serve terminals");
      },
      async terminalOutput() {
        throw new Error("probe does not serve terminals");
      },
      async waitForTerminalExit() {
        throw new Error("probe does not serve terminals");
      },
      async killTerminal() {
        throw new Error("probe does not serve terminals");
      },
      async releaseTerminal() {
        return {};
      },
    }),
    stream,
  );

  try {
    const initialized = await agent.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: { name: "tiller-probe", version: "0.0.0" },
    });

    if (roundtripPrompt) {
      const promptText = roundtripPrompt === "true"
        ? "Reply with TILLER_ACP_ROUNDTRIP_OK. Do not use tools or modify files."
        : roundtripPrompt;
      const created = await agent.newSession({
        cwd: args.cwd,
        mcpServers: [],
      });
      capturePhase = "prompt";
      const promptStartedAt = Date.now();
      await agent.prompt({
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: promptText }],
      });
      const promptDurationMs = Date.now() - promptStartedAt;
      await new Promise((resolve) => setTimeout(resolve, 800));

      capturePhase = "load";
      const loadStartedAt = Date.now();
      const loadResponse = await agent.loadSession({
        sessionId: created.sessionId,
        cwd: args.cwd,
        mcpServers: [],
      });
      const loadDurationMs = Date.now() - loadStartedAt;
      await new Promise((resolve) => setTimeout(resolve, 1_200));

      const promptUpdates = capturedUpdates
        .filter((item) => item.phase === "prompt")
        .map((item) => item.update);
      const loadUpdates = capturedUpdates
        .filter((item) => item.phase === "load")
        .map((item) => item.update);
      const report = {
        agent: initialized.agentInfo,
        roundtrip: {
          cwd: args.cwd,
          sessionId: created.sessionId,
          promptDurationMs,
          loadDurationMs,
          loadResponseKeys: Object.keys(loadResponse ?? {}).sort(),
          comparableEqual: JSON.stringify(comparableUpdates(promptUpdates)) === JSON.stringify(comparableUpdates(loadUpdates)),
        },
        counts: {
          prompt: countTypes(promptUpdates),
          load: countTypes(loadUpdates),
        },
        prompt: promptUpdates.map(summarize),
        load: loadUpdates.map(summarize),
        rawShapeKeys: {
          prompt: rawShapeKeys(promptUpdates),
          load: rawShapeKeys(loadUpdates),
        },
        stderrLines: stderr.split(/\r?\n/u).filter(Boolean).slice(0, 8),
      };
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const startedAt = Date.now();
    capturePhase = "load";
    const response = await agent.loadSession({
      sessionId: args.session,
      cwd: args.cwd,
      mcpServers: [],
    });
    const durationMs = Date.now() - startedAt;
    await new Promise((resolve) => setTimeout(resolve, 300));

    const updates = capturedUpdates
      .filter((item) => item.phase === "load")
      .map((item) => item.update);

    const report = {
      agent: initialized.agentInfo,
      load: {
        durationMs,
        responseKeys: Object.keys(response ?? {}).sort(),
      },
      updateCount: updates.length,
      counts: countTypes(updates),
      first: updates.slice(0, 12).map(summarize),
      last: updates.slice(-10).map((update, offset) => summarize(update, updates.length - 10 + offset)),
      rawShapeKeys: rawShapeKeys(updates),
      stderrLines: stderr.split(/\r?\n/u).filter(Boolean).slice(0, 5),
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    child.kill();
  }
}

await main();
