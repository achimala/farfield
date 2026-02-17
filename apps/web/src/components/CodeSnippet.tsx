import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "@/hooks/useTheme";

interface CodeSnippetProps {
  code: string;
  language: string;
  wrapLongLines?: boolean;
  className?: string;
}

export function CodeSnippet({ code, language, wrapLongLines = true, className }: CodeSnippetProps) {
  const { theme } = useTheme();

  return (
    <div className={className}>
      <SyntaxHighlighter
        language={language}
        style={theme === "dark" ? oneDark : oneLight}
        customStyle={{
          margin: 0,
          padding: "0.75rem",
          borderRadius: "0.5rem",
          fontSize: "0.75rem",
          lineHeight: "1.4"
        }}
        wrapLongLines={wrapLongLines}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
