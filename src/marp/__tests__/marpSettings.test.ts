import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
    trusted: true,
    openDocs: [] as Array<{ uri: { toString(): string }; getText(): string }>,
    /** User settings by full key, e.g. 'markdown.marp.html'. */
    settings: {} as Record<string, unknown>,
}));

vi.mock('vscode', () => ({
    workspace: {
        get isTrusted() { return state.trusted; },
        get textDocuments() { return state.openDocs; },
        getConfiguration: (section: string) => ({
            inspect: (key: string) => (`${section}.${key}` in state.settings ? { globalValue: state.settings[`${section}.${key}`] } : undefined),
            get: (key: string, fallback: unknown) => (`${section}.${key}` in state.settings ? state.settings[`${section}.${key}`] : fallback),
        }),
        getWorkspaceFolder: () => undefined,
    },
}));

import { marpHtmlEnabled } from '../marpSettings';

const uri = (name: string) => ({ scheme: 'file', fsPath: `/nonexistent-scimax-test/${name}`, toString: () => `file:///nonexistent-scimax-test/${name}` });
const doc = (name: string, text: string) => ({ uri: uri(name), getText: () => text });
const PRESENTER = '---\nmarp: true\npresenter: true\n---\n\n<iframe src="w.html"></iframe>\n';
const PLAIN = '---\nmarp: true\n---\n\n# Plain\n';

describe('marpHtmlEnabled', () => {
    beforeEach(() => {
        state.trusted = true;
        state.openDocs = [];
        state.settings = {};
    });

    it('allows HTML in a presenter deck, as its slideshow does', () => {
        expect(marpHtmlEnabled(doc('a.md', PRESENTER) as never)).toBe(true);
        expect(marpHtmlEnabled(doc('b.md', PRESENTER.replace('true\n---', 'offline\n---')) as never)).toBe(true);
        expect(marpHtmlEnabled(doc('c.md', PLAIN) as never)).toBe(false);
    });

    it('finds the text of the open document when given only a URI (the Markdown preview)', () => {
        state.openDocs = [doc('a.md', PRESENTER)];
        expect(marpHtmlEnabled({ uri: uri('a.md') } as never)).toBe(true);
        expect(marpHtmlEnabled({ uri: uri('other.md') } as never)).toBe(false);
    });

    it('does not allow HTML for a presenter deck in an untrusted workspace', () => {
        state.trusted = false;
        expect(marpHtmlEnabled(doc('a.md', PRESENTER) as never)).toBe(false);
    });

    it('falls back to Marp for VS Code\'s html setting, or its deprecated enableHtml', () => {
        const plain = doc('c.md', PLAIN) as never;
        state.settings = { 'markdown.marp.html': 'all' };
        expect(marpHtmlEnabled(plain)).toBe(true);
        state.settings = { 'markdown.marp.html': 'off', 'markdown.marp.enableHtml': true };
        expect(marpHtmlEnabled(plain)).toBe(false);
        state.settings = { 'markdown.marp.enableHtml': true };
        expect(marpHtmlEnabled(plain)).toBe(true);
        state.settings = { 'markdown.marp.html': 'all', 'scimax.marp.enableHtml': false };
        expect(marpHtmlEnabled(plain)).toBe(false);
    });
});
