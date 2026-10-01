#!/usr/bin/env bash
# Rebuild vendor/marked.js (the marked Markdown parser as one minified IIFE, global `marked`),
# used by presenter.js to render sticky notes. npm runs in a temporary folder.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
npm init -y >/dev/null
npm install --silent marked esbuild
echo 'export { marked } from "marked";' > entry.js
npx esbuild entry.js --bundle --minify --format=iife --global-name=__markedLib --footer:js='var marked=__markedLib.marked;' --outfile="$here/marked.js"
v=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("node_modules/marked/package.json")).version)')
{ echo "/* marked $v, MIT license, https://marked.js.org. Built by build-marked.sh. */"; cat "$here/marked.js"; } > "$here/marked.js.tmp" && mv "$here/marked.js.tmp" "$here/marked.js"
ls -la "$here/marked.js"
