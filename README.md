# state-machine

Nx + Bun TypeScript monorepo for state management packages and apps.

## Layout

- `apps/` — applications consuming workspace packages
- `packages/` — state management libraries and tooling

All third-party dependencies are installed once in the root `package.json` (`linker = "hoisted"` in `bunfig.toml`) so every app and package shares a single version. Workspace packages only link to sibling packages via `"workspace:*"`.

## Commands

```sh
bun install          # installs root dependencies, links workspaces, and sets up git hooks
bun run dev          # runs dev targets across the workspace via Nx
bun run build        # builds all apps and packages via Nx
bun run lint         # lints and autofixes with oxlint
bun run typecheck    # typechecks the whole repo with bun check
bun run check:deps   # verifies the single-version root dependency policy
bun run test         # runs unit tests with bun test
bun run graph        # opens the Nx project dependency graph
```

`AGENTS.md` and `.github/CI.md` describe the conventions and CI checks.
