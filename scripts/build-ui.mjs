import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const outdir = path.join(root, "public");

await build({
  entryPoints: [path.join(root, "ui", "src", "main.jsx")],
  bundle: true,
  format: "esm",
  sourcemap: false,
  minify: true,
  define: {
    "process.env.NODE_ENV": "\"production\""
  },
  target: ["es2020"],
  outfile: path.join(outdir, "app.bundle.js"),
  logLevel: "info"
});
