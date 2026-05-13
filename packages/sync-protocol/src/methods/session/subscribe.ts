import { z } from "zod";
import { OkMessageSchema } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/subscribe" as const;

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
  description: "Subscribe the current Deck client to detailed updates for one session.",
});
