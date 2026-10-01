#!/usr/bin/env bash
# Rebuild vendor/codemirror.js (CodeMirror 6 + Python mode, one minified IIFE, global `CM`).
# The npm install happens in a temporary folder, so no node_modules ends up here.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp "$here/cm-entry.js" "$tmp/"
cd "$tmp"
npm init -y >/dev/null
npm install --silent codemirror @codemirror/lang-python @codemirror/view @codemirror/commands @codemirror/state @codemirror/language @codemirror/autocomplete esbuild
npx esbuild cm-entry.js --bundle --minify --format=iife --global-name=CM --outfile="$here/codemirror.js"
v=$(node -e 'const r=p=>JSON.parse(require("fs").readFileSync("node_modules/"+p+"/package.json")).version; console.log(r("codemirror")+" / lang-python "+r("@codemirror/lang-python"))')
sed -i.bak "1s|^|/* CodeMirror 6 (codemirror $v), MIT license, https://codemirror.net. Built by build-codemirror.sh. */\n|" "$here/codemirror.js" && rm -f "$here/codemirror.js.bak"
ls -la "$here/codemirror.js"
