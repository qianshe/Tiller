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
    <div className="markdown-message">
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
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
    <div className="markdown-code-block">
      <div className="markdown-code-toolbar">
        <span>{highlightedCode?.language ?? language ?? "text"}</span>
        <button
          type="button"
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
        <pre>
          <code
            className={`hljs language-${highlightedCode.language ?? language ?? "text"}`}
            dangerouslySetInnerHTML={{ __html: highlightedCode.html }}
          />
        </pre>
      ) : (
        <pre>{children}</pre>
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
