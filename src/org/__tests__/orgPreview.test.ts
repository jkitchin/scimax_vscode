/**
 * Tests for the org preview helpers: splitting exported pages, rewriting
 * local resources for the webview, building the page shell, and the
 * exporter's source-line markers used for scroll sync.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
    buildPreviewPage,
    resolveLocalResource,
    rewriteResourceUrls,
    splitExportedHtml,
} from '../orgPreviewHtml';
import { parseOrgFast } from '../../parser/orgExportParser';
import { addSourceLineMarker, exportToHtml } from '../../parser/orgExportHtml';

const BASE = path.resolve('/docs/notes');
const toUri = (p: string) => `webview://${p}`;

describe('splitExportedHtml', () => {
    it('extracts title, styles and body, dropping head scripts', () => {
        const html = `<!DOCTYPE html><html><head>
<title>My Doc</title>
<style>.a { color: red; }</style>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/x.css" />
<script>alert(1)</script>
</head>
<body>
<main class="org-content"><p>Hi</p></main>
</body></html>`;
        const parts = splitExportedHtml(html);
        expect(parts.title).toBe('My Doc');
        expect(parts.styles).toContain('.a { color: red; }');
        expect(parts.styles).toContain('x.css');
        expect(parts.styles).not.toContain('alert');
        expect(parts.body).toContain('<p>Hi</p>');
        expect(parts.body).not.toContain('<title>');
    });

    it('treats a body-only fragment as the body', () => {
        expect(splitExportedHtml('<p>x</p>').body).toBe('<p>x</p>');
    });
});

describe('resolveLocalResource', () => {
    it('resolves relative paths against the document folder', () => {
        expect(resolveLocalResource('./fig.png', BASE)).toBe(path.join(BASE, 'fig.png'));
        expect(resolveLocalResource('.ob-jupyter/a.png', BASE)).toBe(path.join(BASE, '.ob-jupyter', 'a.png'));
    });

    it('keeps absolute paths', () => {
        expect(resolveLocalResource('/tmp/a.png', BASE)).toBe(path.resolve('/tmp/a.png'));
    });

    it('handles org file: links and file:// URLs', () => {
        expect(resolveLocalResource('file:img/a.png', BASE)).toBe(path.join(BASE, 'img', 'a.png'));
        expect(resolveLocalResource('file:///tmp/a.png', BASE)).toBe(path.resolve('/tmp/a.png'));
    });

    it('ignores remote, data and anchor URLs', () => {
        expect(resolveLocalResource('https://x.org/a.png', BASE)).toBeUndefined();
        expect(resolveLocalResource('data:image/png;base64,AAAA', BASE)).toBeUndefined();
        expect(resolveLocalResource('//cdn.example.com/a.png', BASE)).toBeUndefined();
        expect(resolveLocalResource('#top', BASE)).toBeUndefined();
    });
});

describe('rewriteResourceUrls', () => {
    it('rewrites local image sources and leaves remote ones alone', () => {
        const html = '<p><img src="./fig.png" alt="" /> <img src="https://x.org/a.png" alt="" /></p>';
        const out = rewriteResourceUrls(html, BASE, toUri);
        expect(out).toContain(`src="webview://${path.join(BASE, 'fig.png')}"`);
        expect(out).toContain('src="https://x.org/a.png"');
    });

    it('unescapes HTML entities in the source path', () => {
        const out = rewriteResourceUrls('<img src="a&amp;b.png" />', BASE, toUri);
        expect(out).toContain(`webview://${path.join(BASE, 'a&b.png')}`.replace('&', '&amp;'));
    });

    it('does not touch links', () => {
        const html = '<a href="./other.org">x</a>';
        expect(rewriteResourceUrls(html, BASE, toUri)).toBe(html);
    });
});

describe('buildPreviewPage', () => {
    it('allows only nonce scripts and embeds the state', () => {
        const page = buildPreviewPage({
            cspSource: 'vscode-resource:',
            nonce: 'abc123',
            parts: { title: 'T', styles: '<style>.x{}</style>', body: '<p>body</p>' },
            styleUri: 'style.css',
            scriptUri: 'script.js',
            state: { uri: 'file:///a.org', line: 7, scrollPreviewWithEditor: true, scrollEditorWithPreview: false },
        });
        expect(page).toMatch(/script-src 'nonce-abc123'/);
        expect(page).not.toMatch(/script-src[^;]*'unsafe-inline'/);
        expect(page).toContain('<p>body</p>');
        expect(page).toContain('<style>.x{}</style>');
        expect(page).toContain('&quot;line&quot;:7');
        expect(page).toContain('<script nonce="abc123" src="script.js">');
    });
});

describe('source line markers', () => {
    const org = [
        '#+TITLE: Test',          // 1
        '',                       // 2
        'Intro paragraph.',       // 3
        '',                       // 4
        '* Heading one',          // 5
        'Some text.',             // 6
        '',                       // 7
        '#+BEGIN_SRC python',     // 8
        'print(1)',               // 9
        '#+END_SRC',              // 10
        '',                       // 11
        '** Sub',                 // 12
        '- item',                 // 13
    ].join('\n');

    it('emits data-line attributes when enabled', () => {
        const html = exportToHtml(parseOrgFast(org), { sourceLineMarkers: true });
        expect(html).toContain('<p data-line="3">Intro paragraph.</p>');
        expect(html).toMatch(/<div id="[^"]+" class="org-section org-level-1" data-line="5">/);
        expect(html).toContain('<p data-line="6">Some text.</p>');
        expect(html).toContain('<div data-line="8" class="org-src-container">');
        expect(html).toMatch(/class="org-section org-level-2" data-line="12"/);
        expect(html).toContain('<ul data-line="13">');
    });

    it('emits no markers by default', () => {
        const html = exportToHtml(parseOrgFast(org), {});
        expect(html).not.toContain('data-line');
    });

    it('addSourceLineMarker prepends a marker when output does not start with a tag', () => {
        expect(addSourceLineMarker('plain', 4)).toBe('<span class="org-line-marker" data-line="4"></span>plain');
        expect(addSourceLineMarker('', 4)).toBe('');
        expect(addSourceLineMarker('<hr/>', 2)).toBe('<hr data-line="2"/>');
    });
});
