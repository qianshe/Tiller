import type { ChildProcess } from "node:child_process";
import type { AcpAgentProvider } from "@tiller/shared";
import { resolveAcpRequestTimeout } from "../constants";
import { writeLogLine } from "../protocol-logging";

/**
 * Guards one ACP SDK request with process-exit and timeout handling.
 */
export async function withConnectionRequest<T>(
  method: string,
  operation: Promise<T>,
  child: ChildProcess,
  getStderrBuffer: () => string,
  logFile: string | undefined,
  provider: AcpAgentProvider,
  onTimeout?: () => void,
): Promise<T> {
  const timeoutMs = resolveAcpRequestTimeout(provider, method);
  const stderrStart = getStderrBuffer().length;
  const getRequestStderr = () => getStderrBuffer().slice(stderrStart);
  let requestTimedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let exitHandler: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
  const exited = new Promise<never>((_resolve, reject) => {
    exitHandler = (code, signal) => {
      reject(new Error(`ACP process exited before ${method}: code=${code ?? "none"} signal=${signal ?? "none"}`));
    };
    child.once("exit", exitHandler);
  });
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      requestTimedOut = true;
      const message = `Timed out waiting for ACP response: ${method} after ${timeoutMs}ms`;
      writeLogLine(logFile, "sdk-timeout", message);
      reject(new Error(message));
      try {
        onTimeout?.();
      } catch {
        // Keep the timeout as the primary request error.
      }
    }, timeoutMs);
  });

  try {
    writeLogLine(logFile, "sdk-request", method);
    return await Promise.race([operation, exited, timedOut]);
  } catch (error) {
    const stderr = getRequestStderr().trim();
    if (!requestTimedOut && stderr && error instanceof Error && !error.message.includes(stderr)) {
      throw new Error(`${error.message}: ${stderr}`);
    }
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (exitHandler) {
      child.off("exit", exitHandler);
    }
  }
}
