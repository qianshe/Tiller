import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";
import { MermaidViewportController, type MermaidViewportState } from "./mermaid-viewport-controller";

const PHASE_LABEL_BOUNDARY = /(\S)(\[(?:🌳木|🔥火|🏔️土|⚔️金|💧水|🔁知)\])/gu;
const ENGLISH_TO_CJK_PARAGRAPH_BOUNDARY = /(\b[A-Za-z0-9`'"”’)}\]]+\.)(?=[\u4e00-\u9fff])/gu;
const THINKING_PARAGRAPH_PREFIX = /^(?:Thinking|Thought|思考)\b[:：-]?/iu;

const markdownRemarkPlugins = [remarkGfm];
const markdownRehypePlugins = [rehypeSanitize];

type MarkdownHighlight = {
  html: string;
  language?: string;
};

type MermaidRenderState = {
  svg?: string;
  error?: string;
};

const MERMAID_LANGUAGE = "mermaid";
const OPEN_MERMAID_FENCE_LINE = /^([ \t]{0,3})(`{3,}|~{3,})[ \t]*mermaid[ \t]*$/iu;
const OPEN_MARKDOWN_FENCE_LINE = /^[ \t]{0,3}(`{3,}|~{3,})(?:[ \t].*)?$/u;
const CLOSE_MARKDOWN_FENCE_LINE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/u;
const MARKDOWN_INLINE_CODE_CLASS =
  "markdown-inline-code box-decoration-clone break-words rounded-[5px] border border-border-ghost bg-surface-emphasis/70 px-1.5 py-[1px] text-[0.92em] font-semibold text-foreground";
const markdownHighlightCache = new Map<string, MarkdownHighlight>();
let mermaidRenderSequence = 0;

const markdownComponents: Components = {
  a({ children, href, ...props }) {
    const external = Boolean(href && /^(https?:)?\/\//i.test(href));
    return (
      <a
        {...props}
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer noopener" : undefined}
      >
        {children}
      </a>
    );
  },
  img() {
    return null;
  },
  h1({ children, className, node: _node, ...props }) {
    return (
      <h1
        {...props}
        className={[className, "markdown-heading my-1.5 text-[15px] font-semibold leading-snug text-foreground"]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </h1>
    );
  },
  h2({ children, className, node: _node, ...props }) {
    return (
      <h2
        {...props}
        className={[className, "markdown-heading my-1.5 text-[14px] font-semibold leading-snug text-foreground"]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </h2>
    );
  },
  h3({ children, className, node: _node, ...props }) {
    return (
      <h3
        {...props}
        className={[className, "markdown-heading my-1 text-[13px] font-semibold leading-snug text-foreground"]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </h3>
    );
  },
  h4({ children, className, node: _node, ...props }) {
    return (
      <h4
        {...props}
        className={[className, "markdown-heading my-1 text-[12.5px] font-semibold leading-snug text-foreground"]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </h4>
    );
  },
  h5({ children, className, node: _node, ...props }) {
    return (
      <h5
        {...props}
        className={[className, "markdown-heading my-1 text-[12.5px] font-semibold leading-snug text-foreground"]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </h5>
    );
  },
  h6({ children, className, node: _node, ...props }) {
    return (
      <h6
        {...props}
        className={[className, "markdown-heading my-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </h6>
    );
  },
  p({ children, className, node: _node, ...props }) {
    const paragraphClassName = [
      className,
      "markdown-paragraph leading-[1.5] text-foreground",
      isThinkingParagraph(children) ? "markdown-paragraph-thinking italic text-muted-foreground" : null,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <p {...props} className={paragraphClassName}>
        {children}
      </p>
    );
  },
  ul({ children, node: _node, ...props }) {
    return (
      <ul {...props} className="my-1.5 list-disc space-y-0.5 pl-4 marker:text-primary">
        {children}
      </ul>
    );
  },
  ol({ children, node: _node, ...props }) {
    return (
      <ol {...props} className="my-1.5 list-decimal space-y-0.5 pl-4 marker:text-primary">
        {children}
      </ol>
    );
  },
  li({ children, node: _node, ...props }) {
    return (
      <li {...props} className="pl-1 leading-[1.5] text-foreground [&>p]:inline">
        {children}
      </li>
    );
  },
  blockquote({ children, node: _node, ...props }) {
    return (
      <blockquote
        {...props}
        className="my-1.5 border-l-2 border-primary/50 pl-3 text-muted-foreground"
      >
        {children}
      </blockquote>
    );
  },
  code({ children, className, node: _node, ...props }) {
    const isBlockCode = typeof className === "string" && className.includes("language-");

    if (isBlockCode) {
      return (
        <code
          {...props}
          className={[className, "!bg-transparent text-[var(--markdown-code-fg)]"]
            .filter(Boolean)
            .join(" ")}
        >
          {children}
        </code>
      );
    }

    return (
      <code
        {...props}
        className={
          className
            ? `${className} ${MARKDOWN_INLINE_CODE_CLASS}`
            : MARKDOWN_INLINE_CODE_CLASS
        }
      >
        {children}
      </code>
    );
  },
  th({ children, node: _node, ...props }) {
    return (
      <th
        {...props}
        className="markdown-table-head border-b border-border-ghost bg-surface-emphasis px-2.5 py-1.5 text-left text-[11px] font-semibold text-muted-foreground"
      >
        {children}
      </th>
    );
  },
  td({ children, node: _node, ...props }) {
    return (
      <td
        {...props}
        className="markdown-table-cell border-t border-border-ghost px-2.5 py-1.5 align-top text-[12.5px] text-foreground"
      >
        {children}
      </td>
    );
  },
  table({ children, node: _node, ...props }) {
    return (
      <div className="markdown-table-scroll max-w-full overflow-x-auto overflow-y-hidden rounded-md border border-border-ghost">
        <table {...props} className="w-full min-w-max border-collapse text-left text-[12.5px]">
          {children}
        </table>
      </div>
    );
  },
  pre({ children }) {
    const code = extractTextFromReactNode(children).replace(/\n$/, "");
    const language = findCodeLanguage(children);
    if (language === MERMAID_LANGUAGE) {
      return <MarkdownMermaidBlock code={code} />;
    }

    return (
      <MarkdownCodeBlock code={code} language={language}>
        {children}
      </MarkdownCodeBlock>
    );
  },
};

export const MarkdownMessage = memo(function MarkdownMessage({
  text,
}: {
  text: string;
}) {
  const normalizedText = useMemo(() => normalizeMarkdownMessageText(text), [text]);

  return (
    <div className="markdown-message space-y-1.5 text-[12.5px] leading-[1.5] text-foreground">
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
      >
        {normalizedText}
      </ReactMarkdown>
    </div>
  );
});

export { markdownComponents };

export function clearMarkdownHighlightCache() {
  markdownHighlightCache.clear();
}

export function getMarkdownHighlightCacheSize() {
  return markdownHighlightCache.size;
}

export async function resolveMarkdownCodeHighlight(
  code: string,
  language?: string,
): Promise<MarkdownHighlight | null> {
  if (!code.trim()) {
    return null;
  }

  const cacheKey = markdownHighlightCacheKey(code, language);
  const cached = markdownHighlightCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const module = await import("highlight.js/lib/common");
  const hljs = module.default;
  const result =
    language && hljs.getLanguage(language)
      ? hljs.highlight(code, { language, ignoreIllegals: true })
      : hljs.highlightAuto(code);
  const highlighted = {
    html: result.value,
    language: result.language ?? language,
  };
  markdownHighlightCache.set(cacheKey, highlighted);
  return highlighted;
}

export function normalizeMarkdownMessageText(text: string) {
  return deferOpenMermaidFence(
    text
      .replace(ENGLISH_TO_CJK_PARAGRAPH_BOUNDARY, "$1\n\n")
      .replace(PHASE_LABEL_BOUNDARY, "$1\n\n$2"),
  );
}

function deferOpenMermaidFence(text: string) {
  const lines = text.split("\n");
  let openFence: { marker: "`" | "~"; length: number; mermaidLineIndex?: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.replace(/\r$/, "") ?? "";

    if (openFence) {
      const closeMatch = CLOSE_MARKDOWN_FENCE_LINE.exec(line);
      const closeMarker = closeMatch?.[1];
      if (
        closeMarker?.[0] === openFence.marker &&
        closeMarker.length >= openFence.length
      ) {
        openFence = null;
      }
      continue;
    }

    const mermaidMatch = OPEN_MERMAID_FENCE_LINE.exec(line);
    if (mermaidMatch?.[2]) {
      const marker = mermaidMatch[2];
      openFence = {
        marker: marker[0] as "`" | "~",
        length: marker.length,
        mermaidLineIndex: index,
      };
      continue;
    }

    const openMatch = OPEN_MARKDOWN_FENCE_LINE.exec(line);
    const openMarker = openMatch?.[1];
    if (openMarker) {
      openFence = {
        marker: openMarker[0] as "`" | "~",
        length: openMarker.length,
      };
    }
  }

  if (openFence?.mermaidLineIndex === undefined) {
    return text;
  }

  const mermaidFenceLine = lines[openFence.mermaidLineIndex];
  if (mermaidFenceLine === undefined) {
    return text;
  }

  lines[openFence.mermaidLineIndex] = mermaidFenceLine.replace(
    /mermaid/iu,
    "text",
  );
  return lines.join("\n");
}

function isThinkingParagraph(node: ReactNode) {
  return THINKING_PARAGRAPH_PREFIX.test(extractTextFromReactNode(node).trimStart());
}

function MarkdownCodeBlock({
  children,
  code,
  language,
}: {
  children: ReactNode;
  code: string;
  language?: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [highlightedCode, setHighlightedCode] = useState<MarkdownHighlight | null>(
    () => readCachedMarkdownCodeHighlight(code, language),
  );

  useEffect(() => {
    let mounted = true;
    const cached = readCachedMarkdownCodeHighlight(code, language);

    if (!code.trim()) {
      setHighlightedCode(null);
      return () => {
        mounted = false;
      };
    }

    if (cached) {
      setHighlightedCode(cached);
      return () => {
        mounted = false;
      };
    }

    setHighlightedCode(null);

    void resolveMarkdownCodeHighlight(code, language)
      .then((result) => {
        if (mounted) {
          setHighlightedCode(result);
        }
      })
      .catch(() => {
        if (mounted) {
          setHighlightedCode(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, [code, language]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1400);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 1800);
    }
  }

  return (
    <div className="markdown-code-block overflow-hidden rounded-lg border border-border-ghost bg-[var(--markdown-code-bg)] text-[12.5px] text-[var(--markdown-code-fg)] shadow-sm">
      <div className="not-prose flex items-center justify-between markdown-code-toolbar border-b border-border-ghost bg-[var(--markdown-code-head)] px-3 py-1.5 text-xs text-muted-foreground">
        <span>{highlightedCode?.language ?? language ?? "text"}</span>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-muted-foreground transition hover:bg-surface hover:text-foreground disabled:opacity-50"
          onClick={copyCode}
          disabled={!code}
          aria-label="复制代码块"
        >
          {copyState === "copied"
            ? "已复制"
            : copyState === "failed"
              ? "复制失败"
              : "复制"}
        </button>
      </div>
      {highlightedCode ? (
        <pre className="overflow-x-auto p-2.5 text-[12px] leading-5 text-[var(--markdown-code-fg)]">
          <code
            className={`hljs !bg-transparent language-${highlightedCode.language ?? language ?? "text"}`}
            dangerouslySetInnerHTML={{ __html: highlightedCode.html }}
          />
        </pre>
      ) : (
        <pre className="overflow-x-auto p-2.5 text-[12px] leading-5 text-[var(--markdown-code-fg)]">{children}</pre>
      )}
    </div>
  );
}

function MarkdownMermaidBlock({ code }: { code: string }) {
  const [renderState, setRenderState] = useState<MermaidRenderState>({});
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    const diagramSource = code.trim();

    if (!diagramSource) {
      setRenderState({ error: "Mermaid 图表内容为空。" });
      return () => {
        mounted = false;
      };
    }

    setRenderState({});
    const renderId = `tiller-mermaid-${++mermaidRenderSequence}`;

    void import("mermaid")
      .then(async (module) => {
        const mermaid = module.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            background: "transparent",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
            primaryColor: "#d7dee5",
            primaryTextColor: "#111820",
            primaryBorderColor: "#909ba6",
            lineColor: "#314963",
            secondaryColor: "#e5ebf0",
            tertiaryColor: "#c6ced6",
          },
        });
        return mermaid.render(renderId, diagramSource);
      })
      .then(({ svg }) => {
        if (mounted) {
          setRenderState({ svg });
        }
      })
      .catch(() => {
        if (mounted) {
          setRenderState({ error: "Mermaid 图表渲染失败，已保留源码。" });
        }
      });

    return () => {
      mounted = false;
    };
  }, [code]);

  return (
    <div className="markdown-mermaid-block overflow-hidden rounded-lg border border-border-ghost bg-surface text-[12.5px] text-foreground shadow-sm">
      <div className="not-prose flex items-center justify-between gap-3 border-b border-border-ghost bg-surface-sunken px-3 py-1.5 text-xs text-muted-foreground">
        <span>Mermaid</span>
        <div className="flex items-center gap-2">
          {renderState.error ? <span>{renderState.error}</span> : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setViewerOpen(true)}
            disabled={!renderState.svg}
          >
            全屏查看
          </Button>
        </div>
      </div>
      {renderState.svg ? (
        <div
          className="overflow-x-auto p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: renderState.svg }}
        />
      ) : (
        <pre className="overflow-x-auto p-2.5 text-[12px] leading-5 text-muted-foreground">
          <code>{code}</code>
        </pre>
      )}
      {renderState.svg ? (
        <MermaidFullscreenViewer
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          svg={renderState.svg}
        />
      ) : null}
    </div>
  );
}

function MermaidFullscreenViewer({
  open,
  onOpenChange,
  svg,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  svg: string;
}) {
  const controllerRef = useRef(new MermaidViewportController());
  const viewportContentRef = useRef<HTMLDivElement | null>(null);
  const viewportFrameRef = useRef<number | null>(null);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const [viewportState, setViewportState] = useState<MermaidViewportState>(() =>
    controllerRef.current.getState(),
  );

  useEffect(() => {
    if (open) {
      controllerRef.current.reset();
      setViewportState(controllerRef.current.getState());
      applyViewportTransform();
    }
  }, [open, svg]);

  useEffect(() => {
    return () => {
      if (viewportFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportFrameRef.current);
      }
      activePointersRef.current.clear();
    };
  }, []);

  function applyViewportTransform() {
    const viewportContent = viewportContentRef.current;
    if (!viewportContent) {
      return;
    }
    viewportContent.style.transform = controllerRef.current.getTransformStyle();
  }

  function scheduleViewportTransform() {
    if (viewportFrameRef.current !== null) {
      return;
    }
    viewportFrameRef.current = window.requestAnimationFrame(() => {
      viewportFrameRef.current = null;
      applyViewportTransform();
    });
  }

  function syncViewportState() {
    setViewportState(controllerRef.current.getState());
    scheduleViewportTransform();
  }

  function pointerDistance() {
    const pointers = Array.from(activePointersRef.current.values());
    const first = pointers[0];
    const second = pointers[1];
    if (!first || !second) {
      return 0;
    }
    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  function remainingPointer() {
    return Array.from(activePointersRef.current.values())[0];
  }

  function zoomIn() {
    controllerRef.current.zoomIn();
    syncViewportState();
  }

  function zoomOut() {
    controllerRef.current.zoomOut();
    syncViewportState();
  }

  function resetViewport() {
    controllerRef.current.reset();
    syncViewportState();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (activePointersRef.current.size >= 2) {
      controllerRef.current.beginPinch(pointerDistance());
      syncViewportState();
      return;
    }

    controllerRef.current.beginDrag(event.clientX, event.clientY);
    syncViewportState();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activePointersRef.current.has(event.pointerId)) {
      return;
    }
    activePointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (activePointersRef.current.size >= 2) {
      controllerRef.current.pinchTo(pointerDistance());
      scheduleViewportTransform();
      return;
    }

    if (!controllerRef.current.getState().dragging) {
      return;
    }
    controllerRef.current.dragTo(event.clientX, event.clientY);
    scheduleViewportTransform();
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointersRef.current.delete(event.pointerId);

    if (activePointersRef.current.size >= 2) {
      controllerRef.current.beginPinch(pointerDistance());
      syncViewportState();
      return;
    }

    controllerRef.current.endPinch();
    const pointer = remainingPointer();
    if (pointer) {
      controllerRef.current.beginDrag(pointer.x, pointer.y);
      syncViewportState();
      return;
    }

    controllerRef.current.endDrag();
    syncViewportState();
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    controllerRef.current.zoomByWheel(event.deltaY);
    syncViewportState();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[94vw] max-w-none grid-rows-[auto_1fr] flex-col gap-3 overflow-hidden p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
          <div>
            <DialogTitle>Mermaid 全屏查看</DialogTitle>
            <DialogDescription>单指拖动平移，双指或滚轮缩放。</DialogDescription>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Button type="button" variant="secondary" size="sm" onClick={zoomOut}>
              缩小
            </Button>
            <span className="min-w-12 text-center">{Math.round(viewportState.scale * 100)}%</span>
            <Button type="button" variant="secondary" size="sm" onClick={zoomIn}>
              放大
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={resetViewport}>
              重置
            </Button>
          </div>
        </div>
        <div
          className="relative min-h-0 flex-1 touch-none overflow-hidden overscroll-contain rounded-lg border border-border-ghost bg-surface-sunken"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgb(148_163_184_/_0.2)_1px,transparent_0)] [background-size:24px_24px]" />
          <div
            ref={viewportContentRef}
            className="absolute left-1/2 top-1/2 max-w-none select-none [&_svg]:h-auto [&_svg]:max-w-none"
            style={{
              cursor: viewportState.dragging ? "grabbing" : "grab",
              transform: controllerRef.current.getTransformStyle(),
              transformOrigin: "center",
              touchAction: "none",
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function extractTextFromReactNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractTextFromReactNode).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return extractTextFromReactNode(node.props.children);
  return "";
}

function findCodeLanguage(node: ReactNode): string | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ className?: string; children?: ReactNode }>(child))
      continue;
    const match = /language-([\w-]+)/.exec(child.props.className ?? "");
    if (match?.[1]) return match[1];
    const nested = findCodeLanguage(child.props.children);
    if (nested) return nested;
  }
  return undefined;
}

function readCachedMarkdownCodeHighlight(
  code: string,
  language?: string,
): MarkdownHighlight | null {
  return (
    markdownHighlightCache.get(markdownHighlightCacheKey(code, language)) ?? null
  );
}

function markdownHighlightCacheKey(code: string, language?: string) {
  return `${language ?? ""}\0${code}`;
}
