# Playwright adapter

## Extraction strategy

1. **Primary:** a custom reporter run with `npx playwright test --list --reporter=@suitemap/playwright/extract`. `onBegin(config, suite)` receives the full tree (root → project → file → describe → test) with tags, annotations, `expectedStatus` and locations, and no test is executed. This uses Playwright's own config resolution, so loops and parameterised tests are handled.
2. **Fallback:** parse `npx playwright test --list --reporter=json`.
3. **Results overlay (Phase 4):** read JSON or blob reports (including merged shards) to add actual status, duration, retries, and conditional/runtime annotations.
4. **Function-source scan (Phase 1, in `packages/playwright`):** parse the function source Playwright already holds (`TestCase.fn`, `Suite._hooks[].fn`, `Suite._modifiers[].fn`) with a small JS parser for conditional and runtime annotations. No source files are read and no ts-morph is needed. Findings become `Conditional` entities (see ADR 0004). Parsing source files directly (AST-only extraction) for repos whose config cannot load without secrets or services stays optional and later.

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

**Static limit:** conditional and runtime annotations are not annotations in `--list` (see Phase 0 checks). Describe/file-level callbacks come from `_modifiers`, bodies and hooks from parsing `fn` source, with a confidence level; the viewer labels the map as a "static view" and the Phase 4 overlay confirms what fired.

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
- [x] **Do conditional `skip`/`fixme` appear in `--list`?** Partly; it depends on where the call is. Same on 1.42.1 and 1.65.1.
  - **Visible via internal `Suite._modifiers`:** describe-level and file-level callback forms, e.g. `test.fixme(({ browserName }) => browserName === 'firefox', 'reason')` and `test.skip(({ browserName }) => ..., 'reason')` at file level. Each entry has `type`, `description`, `location` and the callback (`fn.toString()`, Babel-transformed source containing the condition). They are **not** reflected in `test.annotations` or `expectedStatus` (all `passed`/no annotation).
  - **Partly visible via internal `Suite._hooks`:** `beforeEach`/`afterEach` etc. appear with `type`, `location` and transformed function source, so a scan can be anchored on the hook and read the `test.skip(...)` inside it. Condition evaluation is not available.
  - **Visible via internal `TestCase.fn`:** the body of every test (Babel-transformed source, e.g. `_test.test.fixme(process.env.FEATURE_X === '1', ...)`), identical on 1.42.1 and 1.65.1. `fn` is not in the public types. The conditional itself is not an annotation until the test runs; the extractor has to parse the string.
  - **Not resolvable even with `fn`:** helper calls (`skipOnCI(_test.test)`, the call is visible but its effect is not), computed types (`type: kind`), early returns, and conditions that depend on runtime values. These get `confidence: opaque` or `inferred`.
  - **Not exposed as annotations:** conditional calls inside a test body (`test.skip(cond, reason)`, `test.fail`, `test.fixme`, `test.slow`), unconditional `test.skip()`/`test.slow()` in a body, helper calls, and runtime `test.info().annotations.push(...)`. These are plain code inside the test function and only execute when the test runs. The function-source scan above finds them; see ADR 0004.
  - **Visible as normal annotations:** unconditional declarations (`test.skip(title, fn)`, `test.fixme(title, fn)`, `test.describe.skip/fixme`) with `expectedStatus: skipped` and a `skip`/`fixme` annotation; `test.fail(title, fn)` has a `fail` annotation but `expectedStatus` stays `passed`.
  - Gotcha: `test.slow(title, fn)` is not a declaration form; a call with those args acts as a describe-level `slow()`.
  - Hard cases for the scan are in `fixtures/playwright-basic/tests/misc/conditionals.spec.ts` (helper call, env var, computed annotation type, early return, project-name condition, hook form, file-level callback).
- [x] **Describe-level annotations: on the describe or copied to tests?** Both. Each test's `annotations` contains everything inherited from enclosing describes (outermost first, then its own); the describe node also exposes its own via internal `_staticAnnotations` (not public API, present on both). Tags behave the same: `test.tags` includes inherited describe tags (`@rbac`, `@nested`, then own) with no origin; the describe's own tags are on internal `_tags`. Origin (`title`/`details`/`describe`) therefore has to be reconstructed: title tags by parsing `@tokens` from the title, describe tags from describe titles/`_tags`, remaining ones are `details`. Using internal fields is a risk, recorded in ADR 0004.

### Other findings

- `test.only` does not filter `--list`; all tests are listed. The focused test is flagged via internal `_only` (also on both versions).
- Duplicate titles in one file are a load error on both versions (`spike/output/duplicate-title-*.txt`), so `file + titlePath` is a unique test id within a project. `TestCase.id` is `<prefix>-<suffix>`: the 20-character prefix is shared by the same test in every project, the suffix differs per project and per `repeatEachIndex`, so the whole id is unique per instance (122 tests, 122 unique ids on both versions) and equal across versions. It is an opaque hash; the instance id still includes the project name and `repeatEachIndex` explicitly.
- `repeatEach: 2` yields two `TestCase`s inside the same project node, distinguished by `repeatEachIndex` and a different `id`. Instances need `repeatEachIndex` in their id (matches the draft).
- Loop-generated tests and describes appear as ordinary tests; no marker that they were generated. Location points at the same line for all of them, so `file:line` is not unique and cannot be an id.
- A `{type: 'issue', description}` annotation round-trips with the exact description (URL or key). Hidden `_` types are reported like any other.
- Describe `mode` is only available via internal `_parallelMode` (observed: `none`, `parallel`, `serial`); `none` means unset.
