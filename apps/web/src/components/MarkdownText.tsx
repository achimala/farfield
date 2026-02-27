import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeSnippet } from "./CodeSnippet";

interface MarkdownTextProps {
  text: string;
}

function detectLanguage(className: string | undefined): string {
  if (!className) return "text";
  const prefix = "language-";
  if (!className.startsWith(prefix)) return "text";
  const name = className.slice(prefix.length).trim();
  return name.length > 0 ? name : "text";
}

const components: Components = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const code = String(children ?? "");
    const isBlock =
      code.includes("\n") || (className?.startsWith("language-") ?? false);

    if (!isBlock) {
      return (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">
          {code}
        </code>
      );
    }

    return (
      <CodeSnippet
        code={code.replace(/\n$/, "")}
        language={detectLanguage(className)}
      />
    );
  },
};

function MarkdownTextComponent({ text }: MarkdownTextProps) {
  return (
    <div className="markdown-content text-sm leading-relaxed text-foreground break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownText = memo(MarkdownTextComponent);
