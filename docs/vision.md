# Vision

## Problem

Large Playwright suites are hard to see as a whole. Testers want to answer questions like:

- Which `@smoke` tests are `fixme` in WebKit?
- Which tests are marked `fail`, and which issue does each one point to?
- Which folders have no tagged tests at all?

Existing tools either show **run results** as trees or tables (Allure, Monocart, TestDino, Testomat.io) or draw graphs for **other purposes** (dependencies between tests, AI similarity clusters). None treats tags, projects and annotations as first-class nodes you can regroup freely.

## What Suitemap is

- A **static** map of a Playwright suite: built from `playwright test --list`, no tests are executed.
- One canonical graph, viewed through **lenses** (folder, tag, project, annotation, or custom chains such as `Project → Tag`).
- Two renderers: **mindmap** (tree, "what is under this group?") and **network** ("how do groups overlap?").
- Later: a results overlay (actual vs expected status) and an **annotation rule engine** (`suitemap lint`) that can require annotations in CI.

## Users

QA engineers and developers who maintain Playwright suites, individually or in small teams.

## Non-goals

- Not a test reporter or a test management system.
- Not a hosted service; everything runs locally or in CI and produces static files.
- Not a general-purpose graph editor.

## Principles

- Local, free, open source (MIT).
- Works on any repo where `playwright test --list` works.
- Framework-agnostic core; Playwright is the first adapter, others (Cypress, Vitest, pytest) may follow.
