# Suitemap

**Mindmaps of your Playwright test suite.**

Suitemap reads your Playwright suite without running it and draws it as an interactive mindmap or network graph. Regroup the same tests by folder, tag, project or annotation in one click, and see at a glance what is skipped, marked `fixme`, or expected to fail, and which issue each one points to.

> **Status: early development (Phase 0).** Nothing is published on npm yet. The design is in [`docs/`](docs/); feedback and ideas are welcome in [issues](https://github.com/berkayalparslan/suitemap/issues).

## Why

Large Playwright suites are hard to see as a whole. Reports show what happened in a run; Suitemap shows what your suite *contains*:

- Which `@smoke` tests are `fixme` in WebKit?
- Which tests are marked `fail`, grouped by linked issue?
- Which folders have no tagged tests?
- How do your tags overlap?

## How it works

1. **Extract:** Suitemap runs `playwright test --list` with its own reporter. No tests execute; Playwright resolves your config, projects, tags and annotations as usual.
2. **Build one graph:** tests, folders, files, describes, projects, tags and annotations become connected nodes.
3. **Look through a lens:** pick how to group the graph and draw it as a mindmap (tree) or a network.

| Lens | Groups tests by |
| --- | --- |
| Folder | Folder → file → describe |
| Tag | Tag (tests with several tags appear under each, linked) |
| Project | Playwright project, with each project's own expected status |
| Annotation | Annotation type → value, e.g. `fail` → `issue` → `JIRA-123` |
| Custom | Any chain, e.g. `Project → Tag` |

The output is a single static HTML file: it works offline and as a CI artifact, with no account or server.

## Planned usage

> Not available yet: this is the intended CLI for the first release.

```bash
npx suitemap extract --config playwright.config.ts --out suitemap.json
npx suitemap view suitemap.json
```

## Roadmap

| Phase | Focus |
| --- | --- |
| 0 | Discovery spike: fixture repo, validate `--list` extraction |
| 1 | Extraction and data model, `suitemap extract` |
| 2 | Viewer: mindmap and network, lens picker |
| 3 | Filters, saved lenses, exports (Mermaid, GraphML, CSV, PNG/SVG) → **v0.1** |
| 4 | Run-results overlay (actual vs expected status) |
| 5 | Custom annotation rules and `suitemap lint` for CI |
| 6 | GitHub Action, PR graph diffs |
| 7 | More frameworks (Cypress, Vitest, pytest, …) |

Details and exit criteria: [`docs/roadmap.md`](docs/roadmap.md).

## Requirements

- Node.js LTS
- Playwright **1.42 or newer**

## Documentation

- [Vision](docs/vision.md)
- [Architecture](docs/architecture.md)
- [Schema](docs/schema.md)
- [Lenses](docs/lenses.md)
- [Playwright adapter](docs/playwright-adapter.md)
- [Decision records](docs/decisions/)

## Contributing

The project is at the design stage. The most useful contribution right now is an issue describing how you organise your Playwright suite (tags, projects, custom annotations) and which questions you would want a map to answer.

## License

[MIT](LICENSE) © Berkay Alparslan
