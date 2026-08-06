import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createProtocolStdoutStream, resolveLaunchSpec } from "./process.js";

async function collect(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

test("resolveLaunchSpec keeps existing Windows executable paths intact", () => {
  if (process.platform !== "win32") {
    return;
  }

  const tempDir = mkdtempSync(join(tmpdir(), "tiller-process-path-"));
  const executablePath = join(tempDir, "agent.exe");
  writeFileSync(executablePath, "", "utf8");

  try {
    assert.deepEqual(resolveLaunchSpec(executablePath, ["acp"]), {
      command: executablePath,
      args: ["acp"],
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("createProtocolStdoutStream drops taskkill success lines before ACP JSON parsing", async () => {
  const discarded: string[] = [];
  const source = Readable.from([
    '{"jsonrpc":"2.0","id":1,"result":{}}\n',
    'SUCCESS: The process with PID 43752 has been terminated.\r\n',
    '{"jsonrpc":"2.0","method":"session/update","params":{}}\n',
  ]);

  const output = await collect(createProtocolStdoutStream(source, (line) => discarded.push(line)));

  assert.equal(
    output,
    '{"jsonrpc":"2.0","id":1,"result":{}}\n{"jsonrpc":"2.0","method":"session/update","params":{}}\n',
  );
  assert.deepEqual(discarded, ["SUCCESS: The process with PID 43752 has been terminated."]);
});

test("createProtocolStdoutStream emits a newline-terminated ACP JSON line immediately", async () => {
  const source = new Readable({ read() {} });
  const output = createProtocolStdoutStream(source);
  const chunks: string[] = [];
  output.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
  });

  source.push('{"jsonrpc":"2.0","id":1,"result":{}}\n');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(chunks, ['{"jsonrpc":"2.0","id":1,"result":{}}\n']);
  source.push(null);
});
