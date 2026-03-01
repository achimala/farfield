const EXTENSION_LANGUAGE_MAP: Readonly<Record<string, string>> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  kt: "kotlin",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  svg: "xml",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash"
};

export function languageFromPath(path: string): string {
  const fileName = path.split("/").pop()?.toLowerCase() ?? "";

  if (fileName === "dockerfile") {
    return "docker";
  }
  if (fileName === "makefile") {
    return "makefile";
  }

  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex === -1 || lastDotIndex === fileName.length - 1) {
    return "text";
  }

  const extension = fileName.slice(lastDotIndex + 1);
  return EXTENSION_LANGUAGE_MAP[extension] ?? "text";
}
