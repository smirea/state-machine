import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  validateWorkspaceDeps,
  type PackageManifest,
  type WorkspacePackageInput,
} from "./workspace-deps.ts";

const repoRoot = join(import.meta.dir, "..");
const WORKSPACE_DIRS = ["apps", "packages"] as const;

function readManifest(filePath: string): PackageManifest {
  return JSON.parse(readFileSync(filePath, "utf8")) as PackageManifest;
}

function hasNestedInstalledPackages(nodeModulesDir: string): boolean {
  if (!existsSync(nodeModulesDir)) return false;
  // Tool caches like Vite's `.vite` live inside node_modules; only real package entries violate root hoisting.
  return readdirSync(nodeModulesDir).some((entry) => !entry.startsWith("."));
}

const rootManifest = readManifest(join(repoRoot, "package.json"));
const workspaces: WorkspacePackageInput[] = [];

for (const dir of WORKSPACE_DIRS) {
  const baseDir = join(repoRoot, dir);
  if (!existsSync(baseDir)) continue;
  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgDir = join(baseDir, entry.name);
    const manifestPath = join(pkgDir, "package.json");
    if (!existsSync(manifestPath)) continue;
    workspaces.push({
      path: relative(repoRoot, manifestPath),
      manifest: readManifest(manifestPath),
      hasNestedNodeModules: hasNestedInstalledPackages(join(pkgDir, "node_modules")),
    });
  }
}

const errors = validateWorkspaceDeps({ root: rootManifest, workspaces });
if (errors.length > 0) {
  for (const error of errors) {
    console.error(`ERROR: ${error}`);
  }
  process.exit(1);
}
