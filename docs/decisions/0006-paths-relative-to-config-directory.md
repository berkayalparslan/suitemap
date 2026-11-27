# 0006: Document paths are relative to the config file's directory

- Status: accepted
- Date: 2026-11-27

## Context

Phase 1 extractor work found that Playwright's `FullConfig.rootDir` is the resolved `testDir`, not the config directory (`docs/playwright-adapter.md`, Phase 1 findings). The draft schema said paths are "relative to rootDir" without saying which. Using Playwright's value would drop the `tests/` prefix from every file id, and two projects with different `testDir`s could produce the same relative path for different files. The Phase 0 dumps in `spike/output/` use Playwright's `rootDir` and are not comparable.

## Decision

- `source.rootDir` is the directory of the config file; `source.configFile` and every `Folder`/`File`/`Location` path are relative to it, with forward slashes.
- If Playwright reports no config file, the extractor falls back to Playwright's `rootDir` and adds a `no-config-file` warning.
- No schema field changes; `schemaVersion` stays 1 (the schema was frozen only in this PR series and nothing had consumed paths yet).

## Consequences

- File and folder ids include the `testDir` segment (`tests/auth/login.spec.ts`), which keeps folder lenses faithful to the repository layout.
- `docs/schema.md` and `RawExtraction.rootDir` document this meaning.
