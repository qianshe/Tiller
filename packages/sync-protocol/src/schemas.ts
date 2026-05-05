import { z } from "zod";

export const optionalString = z.string().optional();
export const stringArray = z.array(z.string());

export const EmptyParamsSchema = z.object({}).strict();

export const OkMessageSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

export const StopReasonSchema = z.enum([
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "cancelled",
]);

export function typedUnknown<T>() {
  return z.unknown().transform((value) => value as T);
}
