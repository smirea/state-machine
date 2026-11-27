# Stack

- Runtime & Package Manager: Bun (hoisted workspaces)
- Monorepo Orchestration: Nx (`nx.json`)
- Language: TypeScript
- Linting: Oxlint
- Git Hooks: Lefthook

# Monorepo layout & dependencies

- Applications live in `apps/*`; shared and publishable packages live in `packages/*`.
- **Single-version root dependency policy:** install all third-party dependencies in the root `package.json` only (`bun add <pkg>` / `bun add -D <pkg>` from the repo root). `bunfig.toml` uses `linker = "hoisted"` so every app and package shares one root `node_modules`.
- Workspace manifests under `apps/*` and `packages/*` may only declare internal workspace links using `"workspace:*"` (and optional `peerDependencies` matching the exact version in the root `package.json`). `bun run check:deps` enforces this in pre-commit and CI.

# Checks and tests

- `bun run lint`, `bun run typecheck`, `bun run check:deps`, and `bun run test` each finish in seconds. The pre-commit hook runs them in parallel: lint fixes on staged files, then typecheck, workspace dependency policy check, and the whole test suite. CI runs them again with `build` (`nx run-many -t build`), one parallel job each. `.github/CI.md` has the details.
- Read the `tests` skill before adding, changing, or fixing a test. Tests are `*.test.ts` files beside the code they cover and run in-process under `bun test`, with no browser, server, or network. Logic worth testing lives in a plain module that imports no framework, so a test can call it directly.
- A new check is a package script first. Add it to the hook only if it finishes in seconds, and to CI as its own entry in the `task` matrix.
