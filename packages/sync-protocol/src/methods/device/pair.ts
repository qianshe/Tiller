import { z } from "zod";
import type { TrustedClientKind } from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "device/pair" as const;
export const ParamsSchema = z.object({
  pairingCode: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
  clientKind: typedUnknown<TrustedClientKind>(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  token: z.string().optional(),
  trustedUntil: z.string().optional(),
  deviceName: z.string().optional(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Pair a beacon device using a pairing code.",
});
