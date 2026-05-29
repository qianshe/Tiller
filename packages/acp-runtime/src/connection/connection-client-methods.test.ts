import assert from "node:assert/strict";
import test from "node:test";
import { createConnectionClientMethods } from "./connection-client-methods";

test("createConnectionClientMethods delegates session updates and returns undefined", async () => {
  const seenUpdates: unknown[] = [];
  const clientMethods = createConnectionClientMethods({
    onSessionUpdate: (params) => {
      seenUpdates.push(params);
    },
    onRequestPermission: async () => ({ outcome: { outcome: "cancelled" } }) as any,
    readTextFile: async () => ({ content: "" }),
    writeTextFile: async () => ({}),
    createTerminal: async () => ({ terminalId: "terminal-1" }),
    terminalOutput: async () => ({ output: "", truncated: false }),
    waitForTerminalExit: async () => ({ exitCode: 0, signal: null }),
    killTerminal: async () => ({}),
    releaseTerminal: async () => ({}),
  });

  const result = await clientMethods.sessionUpdate({ sessionId: "runtime-1" });

  assert.equal(result, undefined);
  assert.deepEqual(seenUpdates, [{ sessionId: "runtime-1" }]);
});

test("createConnectionClientMethods preserves terminal delegation results", async () => {
  const clientMethods = createConnectionClientMethods({
    onSessionUpdate: () => undefined,
    onRequestPermission: async () => ({ outcome: { outcome: "cancelled" } }) as any,
    readTextFile: async () => ({ content: "" }),
    writeTextFile: async () => ({}),
    createTerminal: async () => ({ terminalId: "terminal-1" }),
    terminalOutput: async () => ({
      output: "hello",
      truncated: false,
      exitStatus: { exitCode: null, signal: "SIGTERM" },
    }),
    waitForTerminalExit: async () => ({ exitCode: null, signal: "SIGTERM" }),
    killTerminal: async () => ({}),
    releaseTerminal: async () => ({}),
  });

  assert.deepEqual(await clientMethods.terminalOutput({ terminalId: "terminal-1" }), {
    output: "hello",
    truncated: false,
    exitStatus: { exitCode: null, signal: "SIGTERM" },
  });
  assert.deepEqual(await clientMethods.waitForTerminalExit({ terminalId: "terminal-1" }), {
    exitCode: null,
    signal: "SIGTERM",
  });
});
