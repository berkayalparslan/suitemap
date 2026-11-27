# Playwright adapter

## Extraction strategy

1. **Primary:** a custom reporter run with `npx playwright test --list --reporter=@suitemap/playwright/extract`. `onBegin(config, suite)` receives the full tree (root → project → file → describe → test) with tags, annotations, `expectedStatus` and locations, and no test is executed. This uses Playwright's own config resolution, so loops and parameterised tests are handled.
2. **Fallback:** parse `npx playwright test --list --reporter=json`.
3. **Results overlay (Phase 4):** read JSON or blob reports (including merged shards) to add actual status, duration, retries, and conditional/runtime annotations.
4. **Later, optional:** AST parsing (ts-morph) for repos whose config cannot load without secrets or services.

## Minimum version: 1.42

Playwright 1.42 introduced the `tag` and `annotation` options on `test()` / `test.describe()` and `TestCase.tags` in the Reporter API. Before that, tags existed only as `@tokens` in titles and declared annotations (e.g. issue links) did not exist. A degraded mode for older versions (title tags + built-ins) is possible later if users ask.

## Built-in annotations

| Annotation | Meaning | In the model |
| --- | --- | --- |
| `test.skip()` | Not run in some configuration | `expectedStatus: skipped` + `skip` |
| `test.fail()` | Must fail; error if it passes | `expectedStatus: failed` + `fail` |
| `test.fixme()` | Known failing; not run | `expectedStatus: skipped` + `fixme` |
| `test.slow()` | Triples the timeout | `slow` |
| `test.only()` | Focused | `only: true`; lint warning later |

Forms: unconditional (declaration), conditional (`test.skip(cond, reason)`), callback over fixtures at describe level, inside hooks, and runtime `test.info().annotations.push()`.

**Static limit:** conditional and runtime annotations may be invisible to `--list`. The viewer labels the map as a "static view"; the Phase 4 overlay fills the gaps.

## Tags

- `{ tag: ['@smoke'] }` in details, or `@tokens` in the title.
- Inherited from `test.describe`.
- Store each tag with its origin (`title`, `details`, `describe`).

## Projects

Each project repeats the suite with its own `use`, `testMatch`/`testIgnore`, `grep` and `dependencies` (setup/teardown). Describe modes (`default`, `parallel`, `serial`) come from `test.describe.configure` and are node attributes, not lenses.

## Phase 0 checks

- [ ] Does `--list` run `globalSetup`? (affects repos needing services)
- [ ] Which env vars does config loading need in real repos?
- [ ] What does `onBegin` contain on 1.42 vs latest? Diff the dumps.
- [ ] Do conditional `skip`/`fixme` with static conditions appear in `--list`?
- [ ] Are describe-level annotations reported on the describe or copied to each test?
