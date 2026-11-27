import { describe, expect, test } from "bun:test";
import { validateWorkspaceDeps } from "./workspace-deps.ts";

describe("validateWorkspaceDeps", () => {
  test("allows workspace packages that only link internal workspace packages via workspace:*", () => {
    const errors = validateWorkspaceDeps({
      root: {
        name: "state-machine",
        dependencies: { xstate: "^5.19.0" },
        devDependencies: { nx: "^24.1.0" },
      },
      workspaces: [
        {
          path: "packages/visualizer/package.json",
          manifest: {
            name: "@state-machine/visualizer",
            peerDependencies: { xstate: "^5.19.0" },
          },
        },
        {
          path: "apps/client/package.json",
          manifest: {
            name: "@state-machine/client",
            dependencies: { "@state-machine/visualizer": "workspace:*" },
          },
        },
      ],
    });

    expect(errors).toEqual([]);
  });

  test("rejects external dependencies declared inside an app or package manifest", () => {
    const errors = validateWorkspaceDeps({
      root: {
        name: "state-machine",
        dependencies: { xstate: "^5.19.0" },
      },
      workspaces: [
        {
          path: "packages/visualizer/package.json",
          manifest: {
            name: "@state-machine/visualizer",
            dependencies: { xstate: "^5.19.0" },
          },
        },
      ],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("root package.json");
  });

  test("rejects internal workspace links that do not use workspace:*", () => {
    const errors = validateWorkspaceDeps({
      root: { name: "state-machine" },
      workspaces: [
        {
          path: "packages/visualizer/package.json",
          manifest: { name: "@state-machine/visualizer" },
        },
        {
          path: "apps/client/package.json",
          manifest: {
            name: "@state-machine/client",
            dependencies: { "@state-machine/visualizer": "^0.1.0" },
          },
        },
      ],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("workspace:*");
  });

  test("rejects peerDependencies whose version differs from the root package.json", () => {
    const errors = validateWorkspaceDeps({
      root: {
        name: "state-machine",
        dependencies: { xstate: "^5.19.0" },
      },
      workspaces: [
        {
          path: "packages/visualizer/package.json",
          manifest: {
            name: "@state-machine/visualizer",
            peerDependencies: { xstate: "^5.0.0" },
          },
        },
      ],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("does not match the root package.json version");
  });

  test("rejects nested node_modules directories inside workspace packages", () => {
    const errors = validateWorkspaceDeps({
      root: { name: "state-machine" },
      workspaces: [
        {
          path: "apps/client/package.json",
          manifest: { name: "@state-machine/client" },
          hasNestedNodeModules: true,
        },
      ],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("nested node_modules");
  });

  test("rejects duplicate workspace package names", () => {
    const errors = validateWorkspaceDeps({
      root: { name: "state-machine" },
      workspaces: [
        {
          path: "packages/a/package.json",
          manifest: { name: "@state-machine/dup" },
        },
        {
          path: "apps/b/package.json",
          manifest: { name: "@state-machine/dup" },
        },
      ],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("duplicate workspace package name");
  });
});
