import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "device/authenticate" as const;
export const ParamsSchema = z.object({
  deviceId: z.string(),
  token: z.string(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  trustedUntil: z.string().optional(),
  requiresPairing: z.boolean().optional(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Authenticate a previously paired beacon device.",
});
