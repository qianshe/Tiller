import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createProtocolStdoutStream } from "./process.js";

async function collect(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

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
