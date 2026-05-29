import type { IncomingMessage, ServerResponse } from "node:http";
import {
  loadStaticAsset as loadStaticAssetFromDisk,
  type StaticAssetResponse,
} from "../runtime/static-assets";

export type StaticDeckAssetLoader = (
  rootDir: string,
  requestUrl?: string,
) => Promise<StaticAssetResponse>;

export type StaticDeckHandlerOptions = {
  deckStaticDir: string;
  loadStaticAsset?: StaticDeckAssetLoader;
  logError: (message: string) => void;
};

export function createStaticDeckHandler(options: StaticDeckHandlerOptions) {
  const loadStaticAsset = options.loadStaticAsset ?? loadStaticAssetFromDisk;

  return async function handleStaticDeckRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    const asset = await loadStaticAsset(options.deckStaticDir, request.url ?? "/");
    if (!asset.ok) {
      response.writeHead(asset.statusCode, { "content-type": "text/plain; charset=utf-8" });
      response.end(
        asset.statusCode === 404
          ? "Tiller Deck assets not found. Run pnpm --filter @tiller/helm build."
          : "Forbidden",
      );
      return;
    }

    try {
      response.writeHead(200, {
        "cache-control": asset.immutable ? "public, max-age=31536000, immutable" : "no-cache",
        "content-type": asset.contentType,
      });
      response.end(asset.body);
    } catch (error) {
      options.logError(
        `[tiller] failed to serve Deck asset: ${error instanceof Error ? error.message : String(error)}`,
      );
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Failed to serve Tiller Deck asset.");
    }
  };
}
