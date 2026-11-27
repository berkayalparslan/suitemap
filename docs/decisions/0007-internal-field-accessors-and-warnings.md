# 0007: Internal fields are read through feature-detecting accessors; warnings are per field

- Status: accepted
- Date: 2026-11-27

## Context

ADR 0004 accepted reading a few Playwright internals (`Suite._parallelMode`, `_tags`, `_staticAnnotations`, `TestCase._only`) because the public Reporter API has no describe-level data. The first extractor (PR #4) left those schema fields empty and used two blanket warnings (`describe-internals-unavailable`, `tag-origin-approximate`).

## Decision

- All underscore-field access lives in `packages/playwright/src/internals.ts`. Each accessor checks existence and shape, returns `undefined` on mismatch (never throws) and reports the field. A test fails if another source file reads an underscore property.
- The extractor emits one `internal-field-unavailable` warning per field, with `where` set to the field name, only when that field is absent or malformed. The two blanket codes are removed. A new `annotation-inheritance-mismatch` warning covers the case where `test.annotations` does not start with the enclosing describes' own annotations in the expected order.
- Fallbacks never guess: mode `default`, no describe tags or annotations, tag origin `details`, annotation origin `declaration`, `only` omitted.
- Inherited describe annotations stay on each instance with `origin: 'describe'`; the describe node carries its own list once.

## Consequences

- No schema change and no `schemaVersion` bump: the fields already existed. `RawExtraction` is unchanged. Warning codes are the only contract change; nothing consumes the removed codes yet.
- On a supported Playwright version the fixture extracts with `warnings: []`, so any internals drift appears as a warning diff in the matrix snapshot.
- `_modifiers`, `_hooks` and `TestCase.fn` are read as source text by accessors in the same module (conditionals PR, ADR 0008); each is warned about once like the others.
