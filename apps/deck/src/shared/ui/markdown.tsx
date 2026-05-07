import {
  Children,
  isValidElement,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const PHASE_LABEL_BOUNDARY = /(\S)(\[(?:🌳木|🔥火|🏔️土|⚔️金|💧水|🔁知)\])/gu;
const ENGLISH_TO_CJK_PARAGRAPH_BOUNDARY = /(\b[A-Za-z0-9`'"”’)}\]]+\.)(?=[\u4e00-\u9fff])/gu;
const THINKING_PARAGRAPH_PREFIX = /^(?:Thinking|Thought|思考)\b[:：-]?/iu;

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
  p({ children, className, node: _node, ...props }) {
    const paragraphClassName = [
      className,
      "markdown-paragraph leading-7 text-foreground",
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
      <ul {...props} className="my-2 list-disc space-y-1 pl-5 marker:text-primary">
        {children}
      </ul>
    );
  },
  ol({ children, node: _node, ...props }) {
    return (
      <ol {...props} className="my-2 list-decimal space-y-1 pl-5 marker:text-primary">
        {children}
      </ol>
    );
  },
  li({ children, node: _node, ...props }) {
    return (
      <li {...props} className="pl-1 leading-7 text-foreground [&>p]:inline">
        {children}
      </li>
    );
  },
  blockquote({ children, node: _node, ...props }) {
    return (
      <blockquote
        {...props}
        className="border-l-2 border-primary/50 pl-3 text-muted-foreground"
      >
        {children}
      </blockquote>
    );
  },
  code({ children, className, node: _node, ...props }) {
    return (
      <code
        {...props}
        className={[
          className,
          "rounded bg-surface-sunken px-1 py-0.5 font-mono text-[0.92em] text-foreground",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </code>
    );
  },
  table({ children, node: _node, ...props }) {
    return (
      <div className="markdown-table-scroll rounded-md border border-border-ghost">
        <table {...props} className="w-full border-collapse text-left text-sm">
          {children}
        </table>
      </div>
    );
  },
  pre({ children }) {
    const code = extractTextFromReactNode(children).replace(/\n$/, "");
    const language = findCodeLanguage(children);
    return (
      <MarkdownCodeBlock code={code} language={language}>
        {children}
      </MarkdownCodeBlock>
    );
  },
};

export function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="markdown-message space-y-3 text-sm leading-7 text-foreground">
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
      >
        {normalizeMarkdownMessageText(text)}
      </ReactMarkdown>
    </div>
  );
}

export { markdownComponents };

export function normalizeMarkdownMessageText(text: string) {
  return text
    .replace(ENGLISH_TO_CJK_PARAGRAPH_BOUNDARY, "$1\n\n")
    .replace(PHASE_LABEL_BOUNDARY, "$1\n\n$2");
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
  const [highlightedCode, setHighlightedCode] = useState<{
    html: string;
    language?: string;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    setHighlightedCode(null);

    if (!code.trim()) {
      return () => {
        mounted = false;
      };
    }

    void import("highlight.js/lib/common")
      .then((module) => {
        const hljs = module.default;
        const result =
          language && hljs.getLanguage(language)
            ? hljs.highlight(code, { language, ignoreIllegals: true })
            : hljs.highlightAuto(code);
        if (mounted) {
          setHighlightedCode({
            html: result.value,
            language: result.language ?? language,
          });
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
    <div className="markdown-code-block overflow-hidden rounded-lg border border-border-ghost bg-[#0d1117] text-sm shadow-sm">
      <div className="not-prose flex items-center justify-between markdown-code-toolbar border-b border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300">
        <span>{highlightedCode?.language ?? language ?? "text"}</span>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
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
        <pre className="overflow-x-auto p-3 text-xs leading-6">
          <code
            className={`hljs language-${highlightedCode.language ?? language ?? "text"}`}
            dangerouslySetInnerHTML={{ __html: highlightedCode.html }}
          />
        </pre>
      ) : (
        <pre className="overflow-x-auto p-3 text-xs leading-6">{children}</pre>
      )}
    </div>
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
