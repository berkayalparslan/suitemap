# Lenses

A **lens** is a named way of grouping the suite. Internally it is a *pivot chain* (an ordered list of dimensions). Each lens can be drawn as a **mindmap** or a **network**.

Built-in lenses:

| Lens | Pivot chain |
| --- | --- |
| Folder | Folder → File → Describe → Test |
| Tag | Tag → Test |
| Project | Project → Folder → Test |
| Annotation | Annotation type → Annotation value → Test |

Custom lenses are defined in `suitemap.config.ts`, e.g. `Project → Tag`, or `Annotation:fail → Annotation:issue → issueKey`.

## Tests that belong to several groups

A test can have several tags, run in several projects and carry several annotations. One rule covers every lens:

> **A dimension inside the lens splits the test; a dimension outside it shows as badges on the test.**

| Lens | Test with tags `@smoke`, `@auth` and projects `chromium`, `webkit` | Counts |
| --- | --- | --- |
| Folder | One leaf; tag chips and project badges, each badge coloured by that project's expected status. | Unique tests |
| Tag (mindmap) | Linked copies under `@smoke` **and** `@auth`, marked "×2"; hovering one highlights the other. Untagged tests go to "(untagged)". | Per-branch counts; root shows unique tests |
| Project (mindmap) | One copy per project, each with that project's own expected status. | Instances per project; unique tests at root |
| Tag (network) | **One** node with an edge to each tag; overlaps become visible. | Unique tests |
| Tag combination (toggle) | Grouped by exact tag set ("@smoke + @auth"); only combinations that exist. | Unique tests |

## Preset lenses (Phase 3)

- Known failures: `fail` and `fixme`, grouped by issue
- Skipped by project
- Untagged tests
- Slow tests
- Focused tests (`.only`)
