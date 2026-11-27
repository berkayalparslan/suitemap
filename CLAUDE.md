# Suitemap

Suitemap turns a Playwright test suite into an interactive mindmap or network graph. It reads the suite **statically** (no test run) and lets testers regroup it through **lenses**: by folder, tag, project, or annotation (e.g. "marked `fail` → `issue` annotation → issue key"). Later phases add a results overlay and an annotation rule engine (`suitemap lint`) that can make annotations required in CI.

Open source (MIT). Distributed as npm packages with a static, single-file HTML viewer. No hosted service.

## Current status

Phase 1 (extraction and data model) in progress; Phase 0 is merged. See `docs/roadmap.md` for phases and exit criteria.

## Read these before changing code

- `docs/vision.md`: what Suitemap is and is not
- `docs/architecture.md`: graph model, packages, data flow
- `docs/schema.md`: canonical JSON schema (the contract between all packages)
- `docs/lenses.md`: lens definitions and how multi-membership is drawn
- `docs/playwright-adapter.md`: extraction via `--list`, Playwright version notes
- `docs/decisions/`: architecture decision records (ADRs); add one for any decision that changes a doc above

## Stack and layout (planned)

- TypeScript, pnpm workspaces, Node LTS
- `packages/core`: `@suitemap/core`, schema, graph builder, pivot/filter engine, exporters. **Must not depend on Playwright.**
- `packages/playwright`: `@suitemap/playwright`, the `--list` reporter and results reader
- `packages/viewer`: `@suitemap/viewer`, static single-file HTML app (Cytoscape.js for network, d3-hierarchy/markmap for mindmap)
- `packages/cli`: `suitemap` CLI (`extract`, `view`, `export`; later `lint`, `diff`)
- `fixtures/playwright-basic`: fixture repo that exercises every supported Playwright feature

## Commands

Node >= 20.19, pnpm 10 (`corepack enable`).

```sh
pnpm install            # install workspace deps
pnpm build              # tsc build of every package (pnpm -r build)
pnpm typecheck          # tsc --noEmit per package
pnpm lint               # eslint
pnpm format:check       # prettier (code only; docs are hand-formatted)
pnpm test               # vitest run (all packages)
pnpm exec vitest run packages/core/src/build.test.ts   # one file
```

The extractor's fixture snapshot test spawns Playwright with the built reporter, so run `pnpm build` before `pnpm test`. To try another Playwright version locally: `pnpm --filter @suitemap/playwright add -D @playwright/test@1.42.1` (revert `package.json` and the lockfile afterwards).

CI (`.github/workflows/ci.yml`) runs format check, lint, typecheck, build and test. A second `extractor` job repeats build, typecheck and the extractor tests on Playwright 1.42.1 and 1.65.1. `suitemap extract` is added with the CLI package; its usage goes here then.

## Conventions

- Minimum supported Playwright version: **1.42** (first version with `tag`/`annotation` details and `TestCase.tags`).
- The schema is versioned (`schemaVersion`). Breaking changes need an ADR and a version bump.
- Every extractor change gets a snapshot test against `fixtures/`, run across a Playwright version matrix in CI.
- Annotation types starting with `_` are hidden by default (same as Playwright's HTML reporter).
- Keep `core` framework-agnostic: Playwright-specific logic lives only in `packages/playwright`.

## Privacy rule

This is a public repository. Private notes may be loaded from `CLAUDE.local.md`. **Never copy content from private notes into tracked files, commit messages, PR descriptions, or issues.**
