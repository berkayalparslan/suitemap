# 0002: Open source npm packages with a static HTML viewer

- Status: accepted
- Date: 2026-11-26

## Decision

Suitemap is MIT-licensed and ships as npm packages. The viewer is a self-contained HTML file (like Playwright's HTML report). No hosted service, no paid tier.

## Consequences

- Works offline and as a CI artifact; no accounts or data leaving the user's machine.
- History and team features (Phase 6) must work from files in CI, not a server.
