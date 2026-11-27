# Architecture

Suitemap separates **one canonical graph** from the **views** drawn from it. Every grouping (folder, tag, project, annotation, combinations like "fail + issue") is a *pivot chain* applied to the same data.

```
Inputs                          @suitemap/core                    Outputs
--list reporter  ─────┐   ┌───────────────────────┐   ┌──> Mindmap view
Run results (P4) ─────┼──>│ Canonical graph       │───┼──> Network view
suitemap.config.ts ───┘   │ Pivot + filter engine │   ├──> Exports (Mermaid, GraphML, CSV, PNG/SVG)
                          │ Rule engine (P5)      │   └──> suitemap lint (CI exit code, SARIF)
                          └───────────────────────┘
```

Extractors and the results reader only **write** to the graph; every view, export and lint rule only **reads** from it.

## Graph model

See `schema.md` for the exact types.

| Node type | Key attributes | Edges |
| --- | --- | --- |
| `Test` (definition) | id, title, file:line, describe path | `IN_FILE`, `IN_DESCRIBE` |
| `TestInstance` (test × project) | expectedStatus, timeout, retries, last result (Phase 4) | `INSTANCE_OF`, `RUNS_IN` |
| `Folder`, `File`, `Describe` | path, describe mode (default/parallel/serial) | `CONTAINS` |
| `Project` | name, use/browser, grep, testMatch | `DEPENDS_ON`, `TEARDOWN` |
| `Tag` | name (normalised, `@` kept) | `HAS_TAG` (direct or inherited) |
| `AnnotationType` / `AnnotationValue` | type, description, parsed key (e.g. `JIRA-123`) | `ANNOTATED_WITH` |

Why `TestInstance`: annotations often depend on the project (`test.fixme(browserName === 'webkit')`), so the same test can be `fixme` in one project and active in another.

## Packages

| Package | Responsibility |
| --- | --- |
| `@suitemap/core` | Schema, graph builder, pivot/filter engine, exporters. No Playwright dependency. |
| `@suitemap/playwright` | `--list` reporter, results reader, project/annotation normalisation. |
| `@suitemap/viewer` | Static single-file HTML app; offline, CI-artifact friendly. |
| `suitemap` (CLI) | `extract`, `view`, `export`; later `lint`, `diff`. |

## Viewer

- Mindmap: d3-hierarchy or markmap (folding, large trees, SVG/PNG export).
- Network: Cytoscape.js (compound nodes, fcose layout, PNG export).
- Fallback for very large suites (> ~20k instances): graphology + sigma.js (WebGL).
- Every node links to source via `vscode://file/<path>:<line>`.

## Filter language (Phase 3)

```
annotation:fail AND annotation.type:issue AND NOT tag:@flaky
```

Usable in the viewer, the CLI and saved views in `suitemap.config.ts`.
