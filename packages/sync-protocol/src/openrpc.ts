import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { METHODS } from "./methods";

type JsonSchemaInput = Parameters<typeof zodToJsonSchema>[0];

function toJsonSchema(schema: unknown): unknown {
  return zodToJsonSchema(schema as JsonSchemaInput);
}

export type OpenRpcDocument = {
  openrpc: "1.3.2";
  info: { title: string; version: string };
  methods: Array<{
    name: string;
    description: string;
    params: unknown;
    result?: unknown;
  }>;
};

export function generateOpenRpcDocument(): OpenRpcDocument {
  return {
    openrpc: "1.3.2",
    info: { title: "Tiller Sync Protocol", version: "1.0.0" },
    methods: Object.values(METHODS)
      .filter((descriptor) => descriptor !== undefined)
      .map((descriptor) => ({
        name: descriptor.method,
        description: descriptor.description,
        params: toJsonSchema(descriptor.paramsSchema),
        result:
          descriptor.kind === "request"
            ? toJsonSchema(descriptor.resultSchema)
            : undefined,
      })),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const target = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/openrpc.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(generateOpenRpcDocument(), null, 2)}\n`, "utf8");
}
