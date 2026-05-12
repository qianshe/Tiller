import { z } from "zod";
import { OkMessageSchema } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/unsubscribe" as const;

export const ParamsSchema = z.object({
  sessionId: z.string().min(1),
});

export const ResultSchema = OkMessageSchema;
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;

export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Unsubscribe the current Deck client from detailed updates for one session.",
});
