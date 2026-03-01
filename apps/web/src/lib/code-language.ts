const EXTENSION_LANGUAGE_MAP: Readonly<Record<string, string>> = {
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  h: "c",
  hpp: "cpp",
  htm: "markup",
  html: "markup",
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
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svg: "markup",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  xml: "markup",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

export function languageFromPath(path: string): string {
  const trimmedPath = path.trim();
  if (trimmedPath.length === 0) {
    return "text";
  }

  const fileName = trimmedPath.split("/").pop()?.toLowerCase() ?? "";
  if (fileName === "dockerfile") {
    return "docker";
  }

  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex < 0 || extensionIndex === fileName.length - 1) {
    return "text";
  }

  const extension = fileName.slice(extensionIndex + 1);
  return EXTENSION_LANGUAGE_MAP[extension] ?? "text";
}
