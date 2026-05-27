import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolveInventoryFixture } from "./fixtures.mjs";

const requireFromHelm = createRequire(new URL("../../apps/helm/package.json", import.meta.url));
const { WebSocketServer } = requireFromHelm("ws");

const HOST = readArg("--host") ?? process.env.TILLER_ADAPTER_PROOF_HOST ?? "127.0.0.1";
const PORT = Number(readArg("--port") ?? process.env.TILLER_ADAPTER_PROOF_PORT ?? 0);
const FIXTURE_MODE = readArg("--fixture") ?? process.env.TILLER_ADAPTER_PROOF_FIXTURE ?? "populated";

const inventory = resolveInventoryFixture(FIXTURE_MODE);
const httpServer = createServer(handleHttpRequest);
const wsServer = new WebSocketServer({ server: httpServer });

wsServer.on("connection", (socket) => {
  socket.on("message", (data) => {
    socket.send(JSON.stringify(handleRpcFrame(String(data))));
  });
});

httpServer.listen(PORT, HOST, () => {
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  console.log(JSON.stringify({ ok: true, host: HOST, port, fixture: FIXTURE_MODE }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    wsServer.close();
    httpServer.close(() => process.exit(0));
  });
}

function handleHttpRequest(_request, response) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end('<!doctype html><html><body><div id="root">Language Adapter Proof</div></body></html>');
}

function handleRpcFrame(rawFrame) {
  let envelope;
  try {
    envelope = JSON.parse(rawFrame);
  } catch {
    return errorResponse(null, -32700, "Parse error");
  }

  if (!isRequestEnvelope(envelope)) {
    return errorResponse(resolveEnvelopeId(envelope), -32600, "Invalid Request");
  }

  switch (envelope.method) {
    case "helm/list":
      return successResponse(envelope.id, inventory.helmList);
    case "project/list":
      return successResponse(envelope.id, inventory.projectList);
    case "agent/list":
      return successResponse(envelope.id, inventory.agentList);
    case "session/list":
      return successResponse(envelope.id, inventory.sessionList);
    default:
      return errorResponse(envelope.id, -32601, `Method not found: ${envelope.method}`);
  }
}

function isRequestEnvelope(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.jsonrpc === "2.0" &&
      (typeof value.id === "string" || typeof value.id === "number") &&
      typeof value.method === "string" &&
      (value.params === undefined || typeof value.params === "object"),
  );
}

function resolveEnvelopeId(value) {
  if (!value || typeof value !== "object" || !("id" in value)) {
    return null;
  }
  return typeof value.id === "string" || typeof value.id === "number" || value.id === null
    ? value.id
    : null;
}

function successResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}
