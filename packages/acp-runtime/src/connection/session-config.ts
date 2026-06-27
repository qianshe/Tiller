import type { SessionConfigOptionValue } from "@tiller/shared";
import type { AcpSessionConfigOption } from "../runtime-types";

export type RequestedRuntimeSession = {
  tillerSessionId: string;
} & (
  | { kind: "new" }
  | { kind: "load"; runtimeSessionId: string }
  | { kind: "resume"; runtimeSessionId: string }
);

export function resolveRequestedRuntimeSessionId(request: RequestedRuntimeSession): string {
  return request.kind === "load" ? request.runtimeSessionId : request.tillerSessionId;
}

export function updateSessionConfigOptionValueById(
  options: AcpSessionConfigOption[],
  configId: string,
  value: SessionConfigOptionValue,
): AcpSessionConfigOption[] {
  return options.map((option) =>
    option.id === configId
      ? {
          ...option,
          currentValue: value,
          selectedValue: value,
          value,
        }
      : option,
  );
}

export function updateSessionConfigOptionValue(
  options: AcpSessionConfigOption[],
  category: string,
  value: string,
): AcpSessionConfigOption[] {
  return options.map((option) =>
    option.category?.toLowerCase() === category
      ? {
          ...option,
          currentValue: value,
          selectedValue: value,
          value,
        }
      : option,
  );
}
