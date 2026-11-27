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

### Phase 1 findings (extractor, `packages/playwright`)

Found while building the public-fields extractor; the version matrix in CI (1.42.1 and 1.65.1) runs one fixture snapshot on both.

- **`FullConfig.rootDir` is the `testDir`, not the config directory** (the fixture's `rootDir` is `tests/`). Paths relative to it lose the `tests/` prefix and two projects with different `testDir`s could collide, so the extractor makes every path relative to the **config file's directory** and reports that directory as `source.rootDir`. The Phase 0 dumps in `spike/output/` are relative to Playwright's `rootDir`.
- **`TestCase.type` and `Suite.entries()` do not exist on 1.42.** Tell tests from suites by the `suites` array. Without `entries()` the order of mixed tests and describes is lost (suites first, then tests); the extractor restores it by sorting on source position, so the snapshot is identical on both versions.
- **`FullProject` is not exported from `@playwright/test/reporter` on 1.42**; derive the type from `Suite['project']`.
- **A throwing reporter does not fail `playwright test --list`.** Playwright prints `Error in reporter ...` on **stdout** and still lists the tests, so the runner must treat "no output file" as failure and surface both streams.
- **File suites may have no `location`.** Fall back to the first test's file.
- **`serial` annotation filter:** newer versions add a synthetic `{ type: 'serial' }` (no description) to every test under a serial describe or a serial file (`test.describe.configure({ mode: 'serial' })` at file level). It is dropped only where `_parallelMode` proves an enclosing suite is serial, so a user-declared `serial` annotation survives (as `declaration`, or `describe` when it sits on a describe). If `_parallelMode` or `_staticAnnotations` cannot be read, the old shape-based filter applies (drop every description-less `serial`).
- **`location.column` is version-dependent** (e.g. 9 on 1.42 vs 1 on latest for the same call). It is kept in the document but must not be compared across versions; the snapshot test zeroes it.
- **`use.baseURL`** is serialised only when it is an http(s) URL, without userinfo, query and fragment.
- **Remaining public-only limit:** conditionals (`_modifiers`, `_hooks`, `TestCase.fn`), still `[]` until the conditionals PR.

### Internal fields (`packages/playwright/src/internals.ts`)

Read through four feature-detecting accessors, the only code that touches underscore fields. Each checks existence and shape and returns `undefined` plus a report on mismatch; it never throws. The extractor turns a report into one `internal-field-unavailable` warning per field (`where` is the field name) and falls back to what the public API can prove.

| Field | Gives | Fallback when unavailable |
| --- | --- | --- |
| `Suite._parallelMode` (`none`/`parallel`/`serial`) | `Describe.mode` (`none` -> `default`); proves which suites are serial | mode `default`; description-less `serial` annotations filtered by shape |
| `Suite._tags` | describe-level tags; tag origin `describe` for `{ tag }` details | no describe tags; those tags get origin `details` |
| `Suite._staticAnnotations` | describe's own annotations; inherited vs own split | no describe annotations; every annotation is `declaration` |
| `TestCase._only` | `Instance.only` | `only` omitted (not `false`) |

- **Annotation split.** `test.annotations` is built outermost-first: per enclosing suite, its `_staticAnnotations` (preceded, on newer versions only, by the synthetic `serial` marker for a serial suite), then the test's own. The extractor consumes that prefix positionally from the enclosing file and describe suites, tags it `describe`, and keeps the rest as `declaration`. If the prefix does not match (a Playwright change), it does not guess: all annotations are `declaration` and an `annotation-inheritance-mismatch` warning is emitted. Inherited annotations stay on each instance (so the annotation lens does not have to walk the tree) with origin `describe`; the describe node holds its own list once.
- **Tag origin**, in order: an `@token` in the test's own title (`title`); an enclosing describe's `_tags` or an `@token` in an enclosing describe title (`describe`); a tag in the file suite's `_tags` (`project`); anything else (`details`). On newer versions (1.65.1 verified) the loader copies the config-level `tag` option into every file suite's `_tags` (1.42.1 has no config `tag`), so those tags are config-level, not describe-level; the file suite's own title is a path and is not scanned for `@tokens`. The fixture config sets no `tag`, so the snapshot does not exercise this; a unit test does. A tag that is both in the test title and a describe is `title`.
- **File suites** are read like describes (a file-level `configure({ mode: 'serial' })` changes the annotations of every test in the file) but are not describe nodes, so a file-level mode, tag or annotation is used for origin and serial detection and is not itself represented in the document.
- **Synthetic `serial` marker.** Whether the marker exists is a property of the version (1.42.1: never; 1.65.1: one per serial suite, file suites included), so the extractor applies one interpretation to all enclosing suites of a test and learns it from the first test where only one fits (`ctx.syntheticSerial`). Known ambiguity: before the version is learned, a serial test whose *own* annotations include a description-less `serial` fits both interpretations and is read as having markers. The fixture and the snapshot do not hit this.
- `test.only` on a describe (`describe.only`) is `Suite._only`, not read; `Instance.only` is the test's own flag.

### Other findings

- `test.only` does not filter `--list`; all tests are listed. The focused test is flagged via internal `_only` (also on both versions).
- Duplicate titles in one file are a load error on both versions (`spike/output/duplicate-title-*.txt`), so `file + titlePath` is a unique test id within a project. `TestCase.id` is `<prefix>-<suffix>`: the 20-character prefix is shared by the same test in every project, the suffix differs per project and per `repeatEachIndex`, so the whole id is unique per instance (122 tests, 122 unique ids on both versions) and equal across versions. It is an opaque hash; the instance id still includes the project name and `repeatEachIndex` explicitly.
- `repeatEach: 2` yields two `TestCase`s inside the same project node, distinguished by `repeatEachIndex` and a different `id`. Instances need `repeatEachIndex` in their id (matches the draft).
- Loop-generated tests and describes appear as ordinary tests; no marker that they were generated. Location points at the same line for all of them, so `file:line` is not unique and cannot be an id.
- A `{type: 'issue', description}` annotation round-trips with the exact description (URL or key). Hidden `_` types are reported like any other.
- Describe `mode` is only available via internal `_parallelMode` (observed: `none`, `default`, `parallel`, `serial`); `none` (unset) and an explicit `configure({ mode: 'default' })` are both reported as `default`.
