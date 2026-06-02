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
  stderrBuffer: string,
  logFile: string | undefined,
  provider: AcpAgentProvider,
): Promise<T> {
  const timeoutMs = resolveAcpRequestTimeout(provider, method);
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
      reject(new Error(stderrBuffer.trim() || `Timed out waiting for ACP response: ${method}`));
    }, timeoutMs);
  });

  try {
    writeLogLine(logFile, "sdk-request", method);
    return await Promise.race([operation, exited, timedOut]);
  } catch (error) {
    if (stderrBuffer.trim() && error instanceof Error && !error.message.includes(stderrBuffer.trim())) {
      throw new Error(`${error.message}: ${stderrBuffer.trim()}`);
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
