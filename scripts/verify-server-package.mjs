import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const serverDir = path.join(repoRoot, "apps", "server");
const packageJsonPath = path.join(serverDir, "package.json");

const PackageJsonSchema = z.object({
  version: z.string().min(1),
});

const packageJson = PackageJsonSchema.parse(
  JSON.parse(readFileSync(packageJsonPath, "utf8")),
);
const packDir = mkdtempSync(path.join(tmpdir(), "farfield-server-pack-"));

try {
  execFileSync("npm", ["pack", "--pack-destination", packDir], {
    cwd: serverDir,
    stdio: "inherit",
  });
  execFileSync(
    "bunx",
    [
      "--package",
      path.join(packDir, `farfield-server-${packageJson.version}.tgz`),
      "farfield-server",
      "--help",
    ],
    {
      cwd: packDir,
      stdio: "inherit",
    },
  );
} finally {
  rmSync(packDir, { recursive: true, force: true });
}
