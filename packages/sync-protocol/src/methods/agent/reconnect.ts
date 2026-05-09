import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "agent/reconnect" as const;
export const ParamsSchema = z.object({
  providerId: z.string(),
  projectId: z.string().optional(),
  workspaceId: z.string().optional(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  providerId: z.string(),
  workspaceId: z.string().optional(),
  runtimeConnectionId: z.string().optional(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Reconnect an ACP provider process without creating a session.",
});
