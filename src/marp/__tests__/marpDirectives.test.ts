import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { directiveAt, directiveContext, findDirective, themeNames } from '../marpDirectives';
import * as vm from 'vm';
import { liveReloadScript, liveReloadVersionScript, marpLinkArgs, prepareSlideshowHtml } from '../marpExport';

const DECK = [
    '---',                  // 0
    'marp: true',           // 1
    'the',                  // 2
    'theme: ga',            // 3
    '---',                  // 4
    '',                     // 5
    '<!-- _cl -->',         // 6
    '<!--',                 // 7
    'paginate: h',          // 8
    '-->',                  // 9
    'Plain text: here',     // 10
    '<!-- scimax-hidden',   // 11
    'class: x',             // 12
    'scimax-hidden -->',    // 13
];

describe('directiveContext', () => {
    it('completes names in the front matter', () => {
        expect(directiveContext(DECK, 2, 3)).toEqual({ kind: 'name', region: 'frontMatter', prefix: 'the' });
    });

    it('completes values in the front matter', () => {
        expect(directiveContext(DECK, 3, 9)).toEqual({ kind: 'value', region: 'frontMatter', directive: 'theme', prefix: 'ga' });
    });

    it('completes names in a one-line comment', () => {
        expect(directiveContext(DECK, 6, 8)).toEqual({ kind: 'name', region: 'comment', prefix: '_cl' });
    });

    it('completes values in a multi-line comment', () => {
        expect(directiveContext(DECK, 8, 11)).toEqual({ kind: 'value', region: 'comment', directive: 'paginate', prefix: 'h' });
    });

    it('does nothing in ordinary text or hidden slides', () => {
        expect(directiveContext(DECK, 10, 13)).toBeUndefined();
        expect(directiveContext(DECK, 5, 0)).toBeUndefined();
        expect(directiveContext(DECK, 12, 6)).toBeUndefined();
    });

    it('does nothing after a comment is closed', () => {
        expect(directiveContext(['<!-- a --> theme: x'], 0, 19)).toBeUndefined();
    });
});

describe('findDirective', () => {
    it('finds directives with and without the underscore', () => {
        expect(findDirective('class')?.scope).toBe('local');
        expect(findDirective('_class')?.name).toBe('class');
        expect(findDirective('theme')?.scope).toBe('global');
    });

    it('rejects an underscore on global directives, and unknown names', () => {
        expect(findDirective('_theme')).toBeUndefined();
        expect(findDirective('nonsense')).toBeUndefined();
    });
});

describe('directiveAt', () => {
    it('finds the directive under the cursor for hover', () => {
        expect(directiveAt(DECK, 3, 2)).toEqual({ name: 'theme', start: 0, end: 5 });
        expect(directiveAt(['<!-- _class: lead -->'], 0, 7)).toEqual({ name: '_class', start: 5, end: 11 });
        expect(directiveAt(DECK, 10, 2)).toBeUndefined();
    });
});

describe('themeNames', () => {
    it('reads @theme names from theme CSS', () => {
        expect(themeNames('/* @theme my-theme */\n@import "default";')).toEqual(['my-theme']);
    });
});

describe('marpLinkArgs', () => {
    it('resolves the deck relative to the linking file', () => {
        expect(marpLinkArgs('talks/deck.md', '/notes/index.org', '/home/me')).toEqual({ file: path.resolve('/notes/talks/deck.md') });
    });

    it('reads a start slide and ~', () => {
        expect(marpLinkArgs('~/deck.md::3', '/notes/index.org', '/home/me')).toEqual({ file: path.join('/home/me', 'deck.md'), slide: 3 });
        expect(marpLinkArgs('/abs/deck.md', '/notes/index.org', '/home/me')).toEqual({ file: '/abs/deck.md' });
    });
});

describe('prepareSlideshowHtml', () => {
    it('adds a base URL after <head>', () => {
        const out = prepareSlideshowHtml('<html><head><title>x</title></head></html>', 'file:///talks/');
        expect(out).toBe('<html><head><base href="file:///talks/"><title>x</title></head></html>');
    });

    it('starts at a slide', () => {
        const out = prepareSlideshowHtml('<head lang="en"></head>', 'file:///t/', 3);
        expect(out).toContain('<head lang="en"><base href="file:///t/"><script>');
        expect(out).toContain("'#3'");
    });

    it('does not jump for slide 1', () => {
        expect(prepareSlideshowHtml('<head></head>', 'file:///t/', 1)).not.toContain('<script>');
    });
});

describe('live reload', () => {
    /** Run the reload script against a fake page; returns what it did. */
    function page(version: string) {
        const calls = { reloads: 0, hash: '', loaded: [] as string[] };
        let tick: () => void = () => undefined;
        const window: Record<string, unknown> = {};
        const sandbox = {
            window,
            location: { href: 'file:///shows/deck.html#2', reload: () => { calls.reloads++; } },
            history: { replaceState: (_s: unknown, _t: string, hash: string) => { calls.hash = hash; } },
            setInterval: (fn: () => void) => { tick = fn; },
            Date,
            document: {
                createElement: () => ({ remove: () => undefined }),
                head: { appendChild: (s: { src: string }) => { calls.loaded.push(s.src); } },
            },
        };
        const script = liveReloadScript({ url: 'file:///shows/deck.html.version.js', version })
            .replace(/^<script>/, '').replace(/<\/script>$/, '');
        vm.runInNewContext(`window = this.window; ${script.replace(/window\./g, 'this.window.')}`, sandbox);
        const version_ = (text: string) => vm.runInNewContext(text.replace(/window\./g, 'w.'), { w: window });
        return { calls, tick: () => tick(), versionScript: version_ };
    }

    it('polls the version script', () => {
        const p = page('v1');
        p.tick();
        expect(p.calls.loaded[0]).toMatch(/^file:\/\/\/shows\/deck\.html\.version\.js\?t=\d+$/);
    });

    it('reloads at the slide when the version changes', () => {
        const p = page('v1');
        p.versionScript(liveReloadVersionScript('v1', 4));
        expect(p.calls.reloads).toBe(0);
        p.versionScript(liveReloadVersionScript('v2', 4));
        expect(p.calls.reloads).toBe(1);
        expect(p.calls.hash).toBe('file:///shows/deck.html#4');
    });

    it('reloads without a slide', () => {
        const p = page('v1');
        p.versionScript(liveReloadVersionScript('v2'));
        expect(p.calls.reloads).toBe(1);
        expect(p.calls.hash).toBe('');
    });

    it('does nothing on a page without live reload', () => {
        expect(() => vm.runInNewContext(liveReloadVersionScript('v2', 3), { window: {} })).not.toThrow();
    });

    it('escapes the URL and version for the page', () => {
        const script = liveReloadScript({ url: 'file:///a/</script>.js', version: '"x' });
        expect(script.slice(0, -'</script>'.length)).not.toContain('</script>');
        expect(script).toContain('\\"x');
    });

    it('is added by prepareSlideshowHtml after the start slide', () => {
        const out = prepareSlideshowHtml('<head></head>', 'file:///t/', 3, { url: 'file:///o.js', version: 'v' });
        expect(out.indexOf("'#3'")).toBeLessThan(out.indexOf('__marpLiveReload'));
        expect(prepareSlideshowHtml('<head></head>', 'file:///t/')).not.toContain('__marpLiveReload');
    });
});
