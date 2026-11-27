# 0005: Schema v1 additions: warnings and instance fields

- Status: accepted
- Date: 2026-11-27

## Context

Phase 1 implements schema v1 in `@suitemap/core` (validators derived from `docs/schema.md`). Two requirements from the Phase 0 findings had no place in the draft:

- The extractor must never crash on missing internal fields or unparseable function source; it warns instead. A warning that only goes to stderr is lost once the JSON is read by the viewer or `lint`.
- `TestInstance.id` is composed of test id, project id and `repeatEachIndex`, but the index was not a field, so consumers would have to parse the id.

## Decision

Changes to the draft schema, all in `docs/schema.md`:

1. `SuitemapDocument.warnings: Warning[]` with `Warning = { code: string; message: string; where?: string }`. Always present (empty array when none).
2. `TestInstance.repeatEachIndex: number`, always present.
3. `TestInstance.playwrightId?: string`: Playwright's `TestCase.id`, an optional cross-check (not an identity; see ADR 0004).
4. `schemaVersion` is frozen at `1` with these changes.

Document shape stays additive-friendly: consumers must ignore unknown fields; breaking changes bump `schemaVersion` and need an ADR.

## Consequences

- Viewer and lint can surface "N conditionals could not be analysed" from data, not from logs.
- The builder (`buildDocument`) also emits warnings (`duplicate-instance`, `describe-mode-differs`, `conditional-unknown-*`).
- Adapters hand `@suitemap/core` a framework-neutral `RawExtraction`; tag origin, inherited-annotation dedupe and describe-mode mapping stay in the adapter, id construction, folder/file derivation, cross-project merging and counts live in core.
