# state-machine

Nx + Bun TypeScript monorepo for programmatic XState v5 state management tooling.

## Packages & Apps

- [`packages/visualizer`](packages/visualizer) (`@state-machine/visualizer`) — Programmatic, configurable XState v5 visual editor, live simulator, ELKjs hierarchical auto-layout, IndexedDB browser storage, and file/code import & export (`createVisualizerController`, `<StateMachineVisualizer />`, `mountVisualizer`).
- [`apps/client`](apps/client) (`@state-machine/client`) — Local Vite client app hosting `@state-machine/visualizer` with programmatic code-machine loading and live external XState actor attachment demos.

All third-party dependencies are installed once in the root `package.json` (`linker = "hoisted"` in `bunfig.toml`) so every app and package shares a single version. Workspace packages only link to sibling packages via `"workspace:*"`, enforced by `bun run check:deps`.

## Commands

```sh
bun install          # installs root dependencies, links workspaces, and sets up git hooks
bun run dev          # launches apps/client via Nx (http://localhost:5173)
bun run build        # builds @state-machine/visualizer and @state-machine/client via Nx
bun run lint         # lints and autofixes with oxlint
bun run typecheck    # typechecks the whole repo with bun check
bun run check:deps   # verifies the single-version root dependency policy
bun run test         # runs unit tests with bun test
bun run graph        # opens the Nx project dependency graph
```

`AGENTS.md` and `.github/CI.md` describe the conventions and CI checks.
