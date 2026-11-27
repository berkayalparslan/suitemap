#!/usr/bin/env bash
# Usage: spike/run.sh <label> <playwright version> [config]
# Copies the fixture to spike/.work/<label>, installs that Playwright version, runs --list with the spike reporter.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
label="$1"; version="$2"; config="${3:-playwright.config.ts}"
work="$here/.work/$label"
rm -rf "$work"; mkdir -p "$work" "$here/output"
cp -R "$here/../fixtures/playwright-basic/." "$work/"
cp "$here/list-reporter.ts" "$work/list-reporter.ts"
cd "$work"
npm install --no-audit --no-fund --silent --no-save "@playwright/test@$version"
out="$here/output/${label}${4:+-$4}.json"
SPIKE_OUT="$out" npx playwright test --config "$config" --list --reporter=./list-reporter.ts > "$work/list.stdout" 2> "$work/list.stderr" || { cat "$work/list.stderr"; exit 1; }
echo "$label: wrote $out; globalSetup marker: $([ -f global-setup-ran.marker ] && echo YES || echo no)"
