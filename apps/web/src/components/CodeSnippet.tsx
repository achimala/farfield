import { memo, type CSSProperties } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "@/hooks/useTheme";

interface CodeSnippetProps {
  code: string;
  language: string;
  wrapLongLines?: boolean;
  className?: string;
  inline?: boolean;
}

type SyntaxThemeStyle = Record<string, CSSProperties>;

function buildInlineThemeStyle(base: SyntaxThemeStyle): SyntaxThemeStyle {
  return {
    ...base,
    'code[class*="language-"]': {
      ...(base['code[class*="language-"]'] ?? {}),
      background: "transparent",
    },
    'pre[class*="language-"]': {
      ...(base['pre[class*="language-"]'] ?? {}),
      background: "transparent",
    },
  };
}

function CodeSnippetComponent({
  code,
  language,
  wrapLongLines = true,
  className,
  inline = false,
}: CodeSnippetProps) {
  const { theme } = useTheme();
  const baseStyle = theme === "dark" ? oneDark : oneLight;
  const syntaxStyle = inline ? buildInlineThemeStyle(baseStyle) : baseStyle;
  const WrapperTag = inline ? "span" : "div";

  return (
    <WrapperTag className={className}>
      <SyntaxHighlighter
        language={language}
        style={syntaxStyle}
        PreTag={inline ? "span" : "pre"}
        CodeTag={inline ? "span" : "code"}
        customStyle={
          inline
            ? {
                margin: 0,
                padding: 0,
                borderRadius: 0,
                background: "transparent",
                display: "inline",
                fontSize: "inherit",
                lineHeight: "inherit",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflowWrap: "anywhere",
              }
            : {
                margin: 0,
                padding: "0.75rem",
                borderRadius: "0.5rem",
                fontSize: "0.75rem",
                lineHeight: "1.4",
              }
        }
        wrapLongLines={wrapLongLines}
      >
        {code}
      </SyntaxHighlighter>
    </WrapperTag>
  );
}

export const CodeSnippet = memo(CodeSnippetComponent);
