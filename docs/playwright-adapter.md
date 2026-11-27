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

Evidence: `spike/output/pw-1.42.json` (1.42.1), `pw-latest.json` (1.65.1), `*-repeat.json` (same with `repeatEach: 2`), `diff.txt`. Reproduce with `spike/run.sh` (usage in the script header; `pw-latest` dumps were made with 1.65.1; `duplicate-title-*.txt` holds the load-error output). Fixture: `fixtures/playwright-basic`.

- [x] **Does `--list` run `globalSetup`?** No, on both versions (marker file never written). Repos that need services in `globalSetup` can still be listed. The config file itself is loaded and executed, so top-level code in it runs. Not yet checked: `webServer`, `globalTeardown`, and project-level setup code with side effects.
- [~] **Which env vars does config loading need?** Only what the config reads at load time. A config reading an unset env var for `baseURL` loads fine (value `undefined`); a config that throws on a missing var will make extraction fail. This cannot be answered from the fixture; it needs the 2 real open-source suites in Phase 1. Extraction should report config load errors verbatim and allow `--env-file`.
- [x] **`onBegin` on 1.42 vs latest.** Same tree shape on both: root → project → file → describe → test. Differences (see `diff.txt`):
  - `Suite.type` does not exist on 1.42; infer from depth (root/project/file/describe). Present from a later version.
  - `TestAnnotation.location` is absent on 1.42 and present on latest.
  - Project order differs (1.42: `teardown` before `setup`; latest: declaration order). Do not depend on order.
  - Declared `serial` mode adds a synthetic `{type: 'serial'}` annotation to each test on latest only; 1.42 has none. Drop it when building annotations and use describe mode instead.
  - Test `location.column` differs between versions (e.g. 9 vs 1 for a top-level `setup(...)` call). Do not use column in ids.
  - Identical on both: `TestCase.id` (stable hash, same value across versions), `titlePath`, `tags` (including order), `expectedStatus`, `timeout`, `retries`, `repeatEachIndex`.
- [x] **Do conditional `skip`/`fixme` appear in `--list`?** No. `test.skip(cond, reason)`, `test.fail(cond)`, `test.fixme(cond)`, `test.slow(cond)` inside a test body or callback are invisible (no annotation, `expectedStatus: passed`), including a describe-level `test.fixme(({browserName}) => ..., reason)`. They only run when the test runs. Static view must say so; Phase 4 fills it in. Unconditional declarations (`test.skip(title, fn)`, `test.fixme(title, fn)`, `test.describe.skip/fixme`) are visible with `expectedStatus: skipped` and a `skip`/`fixme` annotation; `test.fail(title, fn)` gets a `fail` annotation but `expectedStatus` stays `passed` on both versions. An unconditional `test.skip()` / `test.slow()` called in a test body is also invisible.
  - Runtime `test.info().annotations.push(...)` is invisible, as expected.
  - Gotcha: `test.slow(title, fn)` is not a declaration form; a call with those args acts as a describe-level `slow()`.
- [x] **Describe-level annotations: on the describe or copied to tests?** Both. Each test's `annotations` contains everything inherited from enclosing describes (outermost first, then its own); the describe node also exposes its own via internal `_staticAnnotations` (not public API, present on both). Tags behave the same: `test.tags` includes inherited describe tags (`@rbac`, `@nested`, then own) with no origin; the describe's own tags are on internal `_tags`. Origin (`title`/`details`/`describe`) therefore has to be reconstructed: title tags by parsing `@tokens` from the title, describe tags from describe titles/`_tags`, remaining ones are `details`. Using internal fields is a risk to record in an ADR before Phase 1.

### Other findings

- `test.only` does not filter `--list`; all tests are listed. The focused test is flagged via internal `_only` (also on both versions).
- Duplicate titles in one file are a load error on both versions, so `file + titlePath` is a unique id within a project. `TestCase.id` is not unique across projects (it is identical for the same test in every project); the instance id must include the project name.
- `repeatEach: 2` yields two `TestCase`s inside the same project node, distinguished by `repeatEachIndex` and a different `id`. Instances need `repeatEachIndex` in their id (matches the draft).
- Loop-generated tests and describes appear as ordinary tests; no marker that they were generated. Location points at the same line for all of them, so `file:line` is not unique and cannot be an id.
- A `{type: 'issue', description}` annotation round-trips with the exact description (URL or key). Hidden `_` types are reported like any other.
- Describe `mode` is only available via internal `_parallelMode` (observed: `none`, `parallel`, `serial`); `none` means unset.
