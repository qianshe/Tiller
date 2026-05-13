import { z } from "zod";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "agent/connect" as const;
export const ParamsSchema = z.object({
  providerId: z.string(),
  projectId: z.string().optional(),
  cwd: z.string().optional(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  providerId: z.string(),
  cwd: z.string().optional(),
  runtimeConnectionId: z.string().optional(),
  connection: typedUnknown().optional(),
  connections: z.array(typedUnknown()).default([]),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Open or reuse an ACP provider connection without creating a session.",
});
