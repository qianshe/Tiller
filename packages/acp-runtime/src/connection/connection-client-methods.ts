import * as acp from "@agentclientprotocol/sdk";

export type ConnectionClientMethodsOptions = {
  onSessionUpdate: (params: unknown) => void;
  onRequestPermission: (params: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>;
  readTextFile: (params: any) => Promise<{ content: string }>;
  writeTextFile: (params: any) => Promise<Record<string, never>>;
  createTerminal: (params: any) => Promise<{ terminalId: string }>;
  terminalOutput: (params: any) => Promise<{
    output: string;
    truncated: boolean;
    exitStatus?: {
      exitCode: number | null;
      signal: string | null;
    };
  }>;
  waitForTerminalExit: (params: any) => Promise<{
    exitCode: number | null;
    signal: string | null;
  }>;
  killTerminal: (params: any) => Promise<Record<string, never>>;
  releaseTerminal: (params: any) => Promise<Record<string, never>>;
};

export function createConnectionClientMethods(options: ConnectionClientMethodsOptions) {
  return {
    async sessionUpdate(params: unknown) {
      options.onSessionUpdate(params);
      return undefined;
    },
    async requestPermission(params: acp.RequestPermissionRequest) {
      return await options.onRequestPermission(params);
    },
    async readTextFile(params: any) {
      return await options.readTextFile(params);
    },
    async writeTextFile(params: any) {
      return await options.writeTextFile(params);
    },
    async createTerminal(params: any) {
      return await options.createTerminal(params);
    },
    async terminalOutput(params: any) {
      return await options.terminalOutput(params);
    },
    async waitForTerminalExit(params: any) {
      return await options.waitForTerminalExit(params);
    },
    async killTerminal(params: any) {
      return await options.killTerminal(params);
    },
    async releaseTerminal(params: any) {
      return await options.releaseTerminal(params);
    },
  };
}
