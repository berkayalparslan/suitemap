# 0004: Schema changes after the Phase 0 spike

- Status: accepted
- Date: 2026-11-27

## Context

The spike (`spike/`, `fixtures/playwright-basic`) dumped the suite tree on Playwright 1.42.1 and 1.65.1. Findings are in `docs/playwright-adapter.md`.

## Decision

Adopt the changes listed under "Phase 0 decisions" in `docs/schema.md` for schema v1. The extractor reads a few internal fields (`_staticAnnotations`, `_tags`, `_only`, `_parallelMode`) because the public Reporter API does not expose describe-level data; the Phase 1 extractor must feature-detect them and cover them with the version-matrix snapshot tests. Both are done (`packages/playwright/src/internals.ts`, ADR 0007); the spike reporter read them without fallback.

## Conditional and runtime annotations

`--list` does not show conditional or runtime annotations as annotations, but part of the information is reachable:

- Describe-level and file-level callback modifiers: readable from internal `Suite._modifiers` (type, reason, location, condition source). Verified on 1.42.1 and 1.65.1.
- Hooks: `Suite._hooks` gives type, location and source, so conditionals inside hooks can be scanned.
- Test bodies: `TestCase.fn` holds each body's (transformed) source, verified on both versions. Conditionals and runtime `annotations.push` are found by parsing that string in `packages/playwright`. No source files are read, no ts-morph.
- Unresolvable by any static means: helper calls, computed types, early returns, runtime values (`confidence: opaque`/`inferred`).

Decision: model all of them as a first-class `Conditional` entity (see `docs/schema.md`), filterable by test, project, tag, folder, referenced identifiers, form and type. Each entry carries `source` (reporter or scan) and `confidence` (static, inferred, opaque) so the viewer is explicit about what it knows. Phase 4 results fill `observed`. If a file cannot be parsed, extraction warns and reports that file's conditionals as unknown; it does not fail.

Details (parser, matching rules, confidence table, unknown type, ids): ADR 0008.

Accepted: the function-source scan ships with the Phase 1 extractor and adds a small JS parser dependency to `packages/playwright` only. It relies on `fn`, `_modifiers` and `_hooks`, all internal.

## Consequences

- Extractor owns dedupe of inherited annotations/tags and origin reconstruction.
- A Playwright release that renames internal fields breaks describe attribution. It no longer breaks extraction: each accessor returns `undefined` and the document carries an `internal-field-unavailable` warning for that field (ADR 0007). The version matrix catches it because the fixture snapshot has `warnings: []`; a renamed or reshaped field shows up as a warning diff.
- Silent semantic changes (a field keeps its shape but changes meaning) are not detected by shape checks. The annotation split verifies the inherited prefix positionally and warns on mismatch; the other fields rely on the snapshot.
