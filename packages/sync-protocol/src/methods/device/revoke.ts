import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "device/revoke" as const;
export const ParamsSchema = z.object({ deviceId: z.string() });
export const ResultSchema = z.object({
  ok: z.boolean(),
  deviceId: z.string(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Revoke a trusted Beacon device.",
});
