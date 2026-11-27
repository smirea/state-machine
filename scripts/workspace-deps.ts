export interface PackageManifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface WorkspacePackageInput {
  path: string;
  manifest: PackageManifest;
  hasNestedNodeModules?: boolean;
}

export interface WorkspaceDepsValidationInput {
  root: PackageManifest;
  workspaces: WorkspacePackageInput[];
}

const RESTRICTED_DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
] as const;

export function validateWorkspaceDeps(input: WorkspaceDepsValidationInput): string[] {
  const errors: string[] = [];
  const rootDeps = new Map<string, string>();

  for (const field of ["dependencies", "devDependencies"] as const) {
    const record = input.root[field];
    if (!record) continue;
    for (const [pkg, version] of Object.entries(record)) {
      const existing = rootDeps.get(pkg);
      if (existing !== undefined && existing !== version) {
        errors.push(
          `Root package.json declares "${pkg}" with conflicting versions (${existing} vs ${version}).`,
        );
      }
      rootDeps.set(pkg, version);
    }
  }

  const workspaceNames = new Map<string, string>();
  for (const ws of input.workspaces) {
    const name = ws.manifest.name?.trim();
    if (!name) {
      errors.push(`${ws.path}: missing required "name" field.`);
      continue;
    }
    const previous = workspaceNames.get(name);
    if (previous) {
      errors.push(`${ws.path}: duplicate workspace package name "${name}" (already declared in ${previous}).`);
    } else {
      workspaceNames.set(name, ws.path);
    }
  }

  for (const ws of input.workspaces) {
    if (ws.hasNestedNodeModules) {
      errors.push(
        `${ws.path}: nested node_modules directory found. Install all dependencies at the repository root with "bun install".`,
      );
    }

    for (const field of RESTRICTED_DEP_FIELDS) {
      const record = ws.manifest[field];
      if (!record) continue;
      for (const [pkg, version] of Object.entries(record)) {
        if (workspaceNames.has(pkg)) {
          if (version !== "workspace:*") {
            errors.push(
              `${ws.path}: ${field}."${pkg}" must use "workspace:*" instead of "${version}".`,
            );
          }
          continue;
        }
        errors.push(
          `${ws.path}: external package "${pkg}" (${version}) in ${field} is not allowed. Install it in the root package.json so all apps and packages share one version.`,
        );
      }
    }

    const peers = ws.manifest.peerDependencies;
    if (!peers) continue;
    for (const [pkg, version] of Object.entries(peers)) {
      if (workspaceNames.has(pkg)) {
        if (version !== "workspace:*") {
          errors.push(
            `${ws.path}: peerDependencies."${pkg}" must use "workspace:*" instead of "${version}".`,
          );
        }
        continue;
      }
      const rootVersion = rootDeps.get(pkg);
      if (rootVersion === undefined) {
        errors.push(
          `${ws.path}: peerDependencies."${pkg}" (${version}) must also be installed in the root package.json.`,
        );
      } else if (rootVersion !== version) {
        errors.push(
          `${ws.path}: peerDependencies."${pkg}" (${version}) does not match the root package.json version (${rootVersion}).`,
        );
      }
    }
  }

  return errors;
}
