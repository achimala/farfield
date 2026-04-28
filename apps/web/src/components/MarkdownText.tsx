import { memo } from "react";
import { GitBranch } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeSnippet } from "./CodeSnippet";

interface MarkdownTextProps {
  text: string;
}

interface GitDirectiveSummary {
  staged: boolean;
  committed: boolean;
  pushed: boolean;
  branch: string | null;
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

const GIT_DIRECTIVE_PATTERN = /::git-(stage|commit|push)\{[^}]*\}/g;

function readGitDirectiveSummary(text: string): GitDirectiveSummary | null {
  const matches = text.match(GIT_DIRECTIVE_PATTERN);
  if (!matches) return null;

  const directiveText = matches.join(" ");
  const branchMatch = directiveText.match(/branch="([^"]+)"/);

  return {
    staged: directiveText.includes("::git-stage"),
    committed: directiveText.includes("::git-commit"),
    pushed: directiveText.includes("::git-push"),
    branch: branchMatch?.[1] ?? null,
  };
}

function removeGitDirectives(text: string): string {
  return text
    .replace(GIT_DIRECTIVE_PATTERN, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function GitDirectiveStrip({ summary }: { summary: GitDirectiveSummary }) {
  const labels = [
    summary.staged ? "staged" : "",
    summary.committed ? "committed" : "",
    summary.pushed ? "pushed" : "",
  ].filter((label) => label.length > 0);

  return (
    <div className="mt-2 flex max-w-full items-center gap-1.5 text-[11px] text-muted-foreground/75">
      <GitBranch size={12} className="shrink-0 text-muted-foreground/55" />
      <span>Git</span>
      <span className="text-muted-foreground/45">{labels.join(" / ")}</span>
      {summary.branch && (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground/80">
          {summary.branch}
        </code>
      )}
    </div>
  );
}

function MarkdownTextComponent({ text }: MarkdownTextProps) {
  const gitSummary = readGitDirectiveSummary(text);
  const displayText = gitSummary ? removeGitDirectives(text) : text;

  return (
    <div className="markdown-content text-sm leading-relaxed text-foreground break-words">
      {displayText && (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {displayText}
        </ReactMarkdown>
      )}
      {gitSummary && <GitDirectiveStrip summary={gitSummary} />}
    </div>
  );
}

export const MarkdownText = memo(MarkdownTextComponent);
