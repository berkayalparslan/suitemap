# 0001: Static extraction via `playwright test --list` and a custom reporter

- Status: accepted
- Date: 2026-11-26

## Context

Suitemap needs the suite's structure, tags, projects and annotations. Options: parse source files (AST), run the tests, or ask Playwright to list them.

## Decision

Use a custom reporter with `--list`. `onBegin` receives the fully resolved suite tree without executing tests.

## Consequences

- Follows Playwright's real config resolution (loops, parameterised tests, project filters).
- Requires the config to load; repos needing secrets or services may need env stubs (AST fallback later).
- Conditional/runtime annotations may be missing until the Phase 4 results overlay.
