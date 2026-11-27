#!/usr/bin/env bash
# Usage: spike/run.sh <label> <playwright version> [config] [suffix]
#   label    output name and work dir, e.g. pw-1.42 or pw-latest
#   version  npm version/tag of @playwright/test, e.g. 1.42.1 or latest
#   config   fixture config file (default playwright.config.ts)
#   suffix   appended to the output name, e.g. "repeat" -> output/pw-1.42-repeat.json
# Without a suffix it also records the duplicate-title load error and writes output/diff.txt
# once both pw-1.42.json and pw-latest.json exist.
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

if [ -z "${4:-}" ]; then
  cp "$here/../fixtures/playwright-basic/playwright.negative.config.ts" "$work/"
  npx playwright test --config playwright.negative.config.ts --list > "$here/output/duplicate-title-$label.txt" 2>&1 && { echo "expected duplicate-title error, got success"; exit 1; } || echo "$label: duplicate-title error recorded"
  if [ -f "$here/output/pw-1.42.json" ] && [ -f "$here/output/pw-latest.json" ]; then
    diff -u "$here/output/pw-1.42.json" "$here/output/pw-latest.json" > "$here/output/diff.txt" || true
  fi
fi
