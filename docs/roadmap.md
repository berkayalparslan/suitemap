# Roadmap

Estimates assume one developer full time. Each phase ends with something shippable. Phases 0–3 are the MVP (about 8–10 weeks).

## Phase 0: Discovery and spike (1 week)

- Fixture repo covering: nested folders, describe-level tags/annotations, all five built-ins (conditional and unconditional), `issue` annotations, `_`-prefixed types, 3+ projects with setup/teardown dependencies, serial and parallel describes, tests generated in loops.
- Verify `--list` behaviour on 1.42 → latest (see `playwright-adapter.md` checklist).
- Repo layout, licence (MIT), npm name reserved.
- **Exit:** spike reporter dumps the full tree for the fixture repo.

## Phase 1: Extraction and data model (2–3 weeks)

- `@suitemap/core` schema v1 + graph builder; `@suitemap/playwright` `--list` reporter.
- CLI: `suitemap extract --config playwright.config.ts --out suitemap.json`.
- Tags (both syntaxes, inheritance), declared annotations, `expectedStatus`, projects with dependencies, describe modes, hidden `_` types.
- Conditionals: `Conditional` entity (see `schema.md`, ADR 0004) from `Suite._modifiers` and from parsing `TestCase.fn` / hook source with a small JS parser; `confidence` per entry; unparseable code warns, does not fail.
- Snapshot tests against fixtures across a Playwright version matrix.
- Version matrix covers the internal fields the extractor reads (`fn`, `_modifiers`, `_hooks`, `_staticAnnotations`, `_tags`, `_only`, `_parallelMode`).
- Pick the 2 open-source suites early; they also answer which env vars config loading needs.
- **Exit:** JSON for the fixture repo and 2 real open-source suites matches a hand-checked expectation, including the conditionals found.

## Phase 2: Viewer MVP (3 weeks)

- Single-file HTML viewer, Mindmap and Network tabs, lens picker, counts per branch, colours by expected status.
- Search, collapse/expand, details panel, open-in-editor link; `suitemap view`.
- Conditionals shown on tests and filterable by test, project, tag and folder, with their `confidence` (dashed for `inferred`/`opaque`).
- **Exit:** a 2,000-test suite renders in under 2 s; "which @smoke tests are fixme in WebKit?" in under 3 clicks.

## Phase 3: Grouping power and exports (2 weeks)

- Filter language (including `conditional.refs`, `conditional.form`, `conditional.type`, `conditional.confidence`), composite groups, issue-key parsing (GitHub, Jira, Linear patterns).
- Preset and saved lenses in `suitemap.config.ts`; exports: Mermaid, markmap, GraphML, CSV, PNG/SVG.
- Publish v0.1 with docs and a demo on GitHub Pages.
- **Gate:** v0.1 on npm, 3 external testers have tried it.

## Phase 4: Run-results overlay (2 weeks)

- Read JSON, blob and merged shard reports: actual status, duration, retries, flakiness, runtime annotations; fills `Conditional.observed` (which instances a conditional actually fired for).
- Expected vs actual ("marked fail but passed", "fixme for 6 months").
- **Exit:** overlay works on sharded CI output.

## Phase 5: Custom annotations and enforcement (3 weeks)

- Declarative schema in `suitemap.config.ts`: allowed types, description patterns, allowed values, required vs optional, scope (folder/project/tag), severity.
- Example rules: every `fail`/`fixme` needs an `issue`; `fixme` needs an `owner`; tags from an allow-list; no `.only` on main.
- `suitemap lint` with exit codes, GitHub annotations, SARIF; typed helpers like `annotate.issue('JIRA-123')`.
- **Exit:** lint blocks a bad PR in the fixture repo's CI.

## Phase 6: CI and team integrations (2–3 weeks)

- GitHub Action and GitLab template; PR comment with a graph diff.
- Flag tests still marked `fail` whose linked issue is closed; CODEOWNERS-based ownership lens.

## Phase 7: More frameworks and extras (ongoing)

- Adapters: Cypress, Vitest/Jest, WebdriverIO, CodeceptJS, pytest markers.
- Ideas to validate: VS Code extension, fixture/page-object usage graph, tag-coverage gaps, AI-suggested tags, MCP server.
