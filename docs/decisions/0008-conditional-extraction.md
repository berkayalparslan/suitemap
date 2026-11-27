# 0008: Conditional extraction from function source

- Status: accepted
- Date: 2026-11-27

## Context

ADR 0004 decided that conditional and runtime annotations become a first-class `Conditional` entity, found by parsing the function sources Playwright holds. This ADR records how, and the two small contract changes that came with it.

## Decision

**Sources** (all read as text through `packages/playwright/src/internals.ts`, never called): `Suite._modifiers` (describe- and file-level `skip/fixme/fail/slow`; type, reason and location come from Playwright, only the callback's condition is parsed), `Suite._hooks` (`beforeAll/afterAll/beforeEach/afterEach`) and `TestCase.fn` (test bodies).

**Parser:** `acorn`, added to `packages/playwright` only (zero dependencies, about 570 kB unpacked). `@babel/parser` is more than twice the size, Playwright's bundled Babel cannot be imported, `ts-morph` was ruled out in ADR 0004. The sources are already plain JavaScript (Babel strips types), so no TypeScript parser is needed. A 20-line walker replaces `acorn-walk`.

**Matching is by shape.** A call is a conditional when it is a member call named `skip`, `fixme`, `fail` or `slow` whose receiver is the test object (`test`, or what Babel's module interop makes of an imported one: `_x.test`, `_x.default`; the `_` prefix keeps `pattern.test` out, and a namespace import is not recognised) or a TestInfo handle (the second parameter of the test or hook function, or `test.info()`); or `<handle>.annotations.push(...)`. A call to any other function that is passed the test object (`skipOnCI(test)`) is an opaque finding. `helper(testInfo)` is not flagged: passing `testInfo` to helpers is far too common to be a signal. Not detected (the schema already says "N found by scan"): a helper that imports `test` itself, and `const t = test`.

**Confidence.**

| Level | When |
| --- | --- |
| `static` | a literal, or no condition (unconditional `skip()`/`slow()`), or only fixtures (destructured callback parameters) and `testInfo.project.*`; and no earlier `return`/`throw` in the function |
| `inferred` | the condition depends on `process.env.*`, other `testInfo` fields (`retry`, ...), or any other free identifier: values outside the code |
| `opaque` | helper calls, calls in the condition that are not methods of a fixture or testInfo, `await`, nested functions, computed annotation types, an earlier `return`/`throw`, a call inside a loop, `switch` or `try`, an unparseable function |

A call inside a callback handed to anything but `.step(...)` is `opaque` (it may never run). A lone string argument, `test.skip('x')`, is a truthy condition with no reason, as in Playwright. A call inside `if`, a ternary or `&&` carries the enclosing condition (negated for `else`), joined with `&&`, and takes the worst confidence of the two.

**Excerpts and refs.** `condition` is the source slice with whitespace collapsed, trimmed and limited to 200 characters (`…` marks the cut), also after guards are joined. `refs` hold fixture names (`browserName`), `process.env.X`, `project.name` for `<testInfo>.project.name`, other testInfo fields without the parameter name, and other identifiers as written. No code is evaluated and no environment value is read.

**`appliesToProjects`** is resolved only for an unguarded `project.name ===`/`!==` string literal comparison, against the projects that exist; everything else is `'unknown'` (including `browserName`: the default browser is not visible).

**Unknown type.** A computed type (`annotations.push({ type: kind })`, or a helper call) has `type: 'unknown'`, a reserved value. A user annotation literally named `unknown` would be conflated with it; that is accepted, to keep `type` a required string in schema v1 (no version bump).

**Unparseable function.** One `conditional-parse-failed` warning (`where`: `file:line`), and one `opaque` conditional with no condition, in place of the conditionals that function may contain: type `unknown` for a hook or body, the reporter's type for a modifier.

**Location.** For body conditionals the location is the owning test's (`test(...)` call); for hooks, the hook's; for modifiers, the modifier call's. The function source is Babel-transformed and source maps are not read, so line numbers inside a body are not available. Several conditionals in one body therefore share a location and are told apart by the `#n` suffix of the id, in source order.

**`Conditional.id` has no column** (`<file>:<line>:<type>:<form>`, `#n` on collision). The column of a `test(...)` call differs between Playwright 1.42 and 1.65 (docs/playwright-adapter.md), which would make ids differ between versions. Ids are opaque, nothing consumes them yet.

**De-duplication.** A file is listed once per project, so the same conditional is found once per project; findings that are identical (including `appliesToProjects`) are recorded once.

## Consequences

- `RawExtraction` and the document schema are unchanged in shape. New warning code: `conditional-parse-failed`. `internal-field-unavailable` now also covers `_modifiers`, `_hooks` and `fn`.
- The fixture snapshot is identical on Playwright 1.42.1 and 1.65.1 once `column` of conditionals is normalised, as for tests.
- Condition excerpts come from Babel's output, so their exact text can in principle vary between Playwright versions; the fixture shows no difference. If one appears, normalise it here rather than in the snapshot.
- Phase 4 results can fill `observed` for the hard cases that stay `opaque`.

## Known limits (accepted)

- **Early exits are source-ordered.** Any `return`/`throw` before the call in the same function makes it `opaque`, even in a branch that cannot precede it (`if (x) { return } else { test.skip(c) }`). Precision is traded for never overstating `static`.
- **`appliesToProjects` ignores `testMatch`/`testIgnore`.** A `project.name` comparison resolves against all project names, not only those that run the file.
- **Each file is scanned once per project** and identical findings are then merged; a cache keyed by source would avoid the repeated parses if this shows up in large suites.
