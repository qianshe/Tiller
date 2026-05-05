import type { z } from "zod";

export type RequestDescriptor<
  M extends string,
  P extends z.ZodType,
  R extends z.ZodType,
> = {
  kind: "request";
  method: M;
  paramsSchema: P;
  resultSchema: R;
  description: string;
};

export type NotificationDescriptor<M extends string, P extends z.ZodType> = {
  kind: "notification";
  method: M;
  paramsSchema: P;
  description: string;
};

export function requestDescriptor<
  M extends string,
  P extends z.ZodType,
  R extends z.ZodType,
>(descriptor: RequestDescriptor<M, P, R>) {
  return descriptor;
}

export function notificationDescriptor<M extends string, P extends z.ZodType>(
  descriptor: NotificationDescriptor<M, P>,
) {
  return descriptor;
}
