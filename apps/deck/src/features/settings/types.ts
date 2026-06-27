export type LoggingLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LoggingSettings = {
  level: LoggingLevel;
  format: string;
  acpTrace: string;
};
