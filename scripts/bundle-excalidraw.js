#!/usr/bin/env node
/**
 * Bundle the Excalidraw editor webview (webview-src/excalidraw) into
 * media/excalidraw/: editor.js, editor.css and the fonts Excalidraw loads.
 * The CJK font (Xiaolai, ~12 MB) is left out; CJK text falls back to a
 * system font.
 */
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'media', 'excalidraw');
const fontSrc = path.join(root, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod', 'fonts');
const SKIP_FONTS = new Set(['Xiaolai']);

async function main() {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    await esbuild.build({
        entryPoints: [path.join(root, 'webview-src', 'excalidraw', 'main.tsx')],
        bundle: true,
        minify: true,
        // ESM with splitting: Mermaid, the locales and other rarely used parts
        // become chunks loaded on demand instead of one 8 MB script.
        format: 'esm',
        splitting: true,
        chunkNames: 'chunks/[name]-[hash]',
        platform: 'browser',
        target: ['chrome114'],
        outdir: outDir,
        entryNames: 'editor',
        define: { 'process.env.NODE_ENV': '"production"', 'process.env.IS_PREACT': '"false"' },
        conditions: ['production'],
        loader: { '.woff2': 'file', '.png': 'dataurl', '.svg': 'dataurl' },
        logLevel: 'warning',
        legalComments: 'none',
    });

    const fontOut = path.join(outDir, 'fonts');
    fs.rmSync(fontOut, { recursive: true, force: true });
    for (const family of fs.readdirSync(fontSrc)) {
        if (SKIP_FONTS.has(family)) continue;
        fs.cpSync(path.join(fontSrc, family), path.join(fontOut, family), { recursive: true });
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
