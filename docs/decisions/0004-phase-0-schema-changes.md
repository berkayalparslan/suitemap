# 0004: Schema changes after the Phase 0 spike

- Status: proposed
- Date: 2026-11-27

## Context

The spike (`spike/`, `fixtures/playwright-basic`) dumped the suite tree on Playwright 1.42.1 and 1.65.1. Findings are in `docs/playwright-adapter.md`.

## Decision

Adopt the changes listed under "Phase 0 findings: proposed changes" in `docs/schema.md` for schema v1. The extractor reads a few internal fields (`_staticAnnotations`, `_tags`, `_only`, `_parallelMode`) because the public Reporter API does not expose describe-level data; they are feature-detected and covered by the version-matrix snapshot tests.

## Consequences

- Extractor owns dedupe of inherited annotations/tags and origin reconstruction.
- A Playwright release that renames internal fields breaks describe attribution; the matrix tests catch this.
