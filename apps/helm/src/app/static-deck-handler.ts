import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  SessionAttachmentStore,
  SessionDiffBodyStore,
  SessionOutputBodyStore,
} from "../sessions/facade";
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
  sessionAttachmentStore?: SessionAttachmentStore;
  sessionDiffBodyStore?: SessionDiffBodyStore;
  sessionOutputBodyStore?: SessionOutputBodyStore;
  loadStaticAsset?: StaticDeckAssetLoader;
  logError: (message: string) => void;
};

export function createStaticDeckHandler(options: StaticDeckHandlerOptions) {
  const loadStaticAsset = options.loadStaticAsset ?? loadStaticAssetFromDisk;

  return async function handleStaticDeckRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    if (serveSessionAttachment(request, response, options.sessionAttachmentStore)) {
      return;
    }
    if (serveSessionDiffBody(request, response, options.sessionDiffBodyStore)) {
      return;
    }
    if (serveSessionOutputBody(request, response, options.sessionOutputBodyStore)) {
      return;
    }

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

function serveSessionDiffBody(
  request: IncomingMessage,
  response: ServerResponse,
  diffBodyStore: SessionDiffBodyStore | undefined,
) {
  if (!diffBodyStore) {
    return false;
  }
  const diffRequest = parseSessionDiffRequest(request.url ?? "/");
  if (!diffRequest) {
    return false;
  }
  const bodyRecord = diffBodyStore.get(diffRequest.sessionId, diffRequest.path);
  const body = diffBodyStore.readText(diffRequest.sessionId, diffRequest.path);
  if (!bodyRecord || typeof body !== "string") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Diff body not found.");
    return true;
  }
  response.writeHead(200, {
    "cache-control": "private, max-age=31536000, immutable",
    "content-type": bodyRecord.mimeType,
  });
  response.end(body);
  return true;
}

function serveSessionOutputBody(
  request: IncomingMessage,
  response: ServerResponse,
  outputBodyStore: SessionOutputBodyStore | undefined,
) {
  if (!outputBodyStore) {
    return false;
  }
  const outputRequest = parseSessionOutputRequest(request.url ?? "/");
  if (!outputRequest) {
    return false;
  }

  const outputBody = outputBodyStore.get(outputRequest.sessionId, outputRequest.outputId);
  if (!outputBody) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Output body not found.");
    return true;
  }

  const body = outputBodyStore.readText(outputRequest.sessionId, outputRequest.outputId);
  if (typeof body !== "string") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Output body not found.");
    return true;
  }

  response.writeHead(200, {
    "cache-control": "private, max-age=31536000, immutable",
    "content-type": outputBody.mimeType,
  });
  response.end(body);
  return true;
}

function serveSessionAttachment(
  request: IncomingMessage,
  response: ServerResponse,
  attachmentStore: SessionAttachmentStore | undefined,
) {
  const attachmentRequest = parseSessionAttachmentRequest(request.url ?? "/");
  if (!attachmentRequest) {
    return false;
  }

  const attachment = attachmentStore?.get(attachmentRequest.attachmentId);
  if (!attachment || attachment.sessionId !== attachmentRequest.sessionId) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Attachment not found.");
    return true;
  }

  const body = attachmentStore?.readBytes(attachment.id);
  if (!body) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Attachment not found.");
    return true;
  }

  response.writeHead(200, {
    "cache-control": "private, max-age=31536000, immutable",
    "content-type": attachment.mimeType,
  });
  response.end(body);
  return true;
}

function parseSessionAttachmentRequest(requestUrl: string) {
  const url = new URL(requestUrl, "http://tiller.local");
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts.length !== 5 ||
    parts[0] !== "api" ||
    parts[1] !== "sessions" ||
    parts[3] !== "attachments"
  ) {
    return null;
  }
  return {
    sessionId: decodeURIComponent(parts[2] ?? ""),
    attachmentId: decodeURIComponent(parts[4] ?? ""),
  };
}

function parseSessionOutputRequest(requestUrl: string) {
  const url = new URL(requestUrl, "http://tiller.local");
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts.length !== 5 ||
    parts[0] !== "api" ||
    parts[1] !== "sessions" ||
    parts[3] !== "outputs"
  ) {
    return null;
  }
  return {
    sessionId: decodeURIComponent(parts[2] ?? ""),
    outputId: decodeURIComponent(parts[4] ?? ""),
  };
}

function parseSessionDiffRequest(requestUrl: string) {
  const url = new URL(requestUrl, "http://tiller.local");
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts.length !== 5 ||
    parts[0] !== "api" ||
    parts[1] !== "sessions" ||
    parts[3] !== "diffs"
  ) {
    return null;
  }
  return {
    sessionId: decodeURIComponent(parts[2] ?? ""),
    path: decodeURIComponent(parts[4] ?? ""),
  };
}
