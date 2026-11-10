/**
 * Tests for `scimax marp build`: which decks get the presenter tools.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deckWantsPresenter, findWorkspaceSettings, marpCliSettings } from '../commands/marp';

const deck = (frontMatter: string) => `---\nmarp: true\n${frontMatter}---\n\n# Slide\n`;

describe('deckWantsPresenter', () => {
    it('adds presenter tools when the deck does not say', () => {
        expect(deckWantsPresenter(deck(''), false)).toBe(true);
        expect(deckWantsPresenter('# No front matter\n', false)).toBe(true);
    });

    it('follows presenter: in the front matter', () => {
        expect(deckWantsPresenter(deck('presenter: true\n'), false)).toBe(true);
        expect(deckWantsPresenter(deck('presenter: offline\n'), false)).toBe(true);
        expect(deckWantsPresenter(deck('presenter: false\n'), false)).toBe(false);
        expect(deckWantsPresenter(deck('presenter: no\n'), false)).toBe(false);
    });

    it('leaves them out with --plain', () => {
        expect(deckWantsPresenter(deck('presenter: true\n'), true)).toBe(false);
    });
});

describe('marpCliSettings', () => {
    it('uses defaults with no settings', () => {
        expect(marpCliSettings('/deck', {})).toEqual({ themes: [], browserPath: undefined, presentWindow: 'tab', appBrowser: '' });
    });

    it('reads the user settings, resolving themes against the deck folder', () => {
        const s = marpCliSettings('/deck', {
            'scimax.marp.themes': ['theme/a.css', '/abs/b.css', 'https://x.org/c.css'],
            'scimax.marp.browserPath': ' /bin/chrome ',
            'scimax.marp.presentWindow': 'app',
            'scimax.marp.appBrowser': 'Microsoft Edge',
        });
        expect(s.themes).toEqual([path.join('/deck', 'theme/a.css'), '/abs/b.css']);
        expect(s.browserPath).toBe('/bin/chrome');
        expect(s.presentWindow).toBe('app');
        expect(s.appBrowser).toBe('Microsoft Edge');
    });

    it('lets workspace settings win and resolves themes against the workspace', () => {
        const s = marpCliSettings('/ws/talks', { 'scimax.marp.presentWindow': 'app', 'markdown.marp.themes': ['u.css'] },
            { root: '/ws', settings: { 'scimax.marp.presentWindow': 'tab' } });
        expect(s.presentWindow).toBe('tab');
        expect(s.themes).toEqual([path.join('/ws', 'u.css')]);
    });
});

describe('findWorkspaceSettings', () => {
    it('finds the nearest .vscode/settings.json above the deck, with comments', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-marp-ws-'));
        try {
            fs.mkdirSync(path.join(root, '.vscode'));
            fs.writeFileSync(path.join(root, '.vscode', 'settings.json'), '{\n  // mine\n  "scimax.marp.presentWindow": "app",\n}\n');
            const deckDir = path.join(root, 'talks', 'one');
            fs.mkdirSync(deckDir, { recursive: true });
            const found = findWorkspaceSettings(deckDir);
            expect(found?.root).toBe(root);
            expect(found?.settings['scimax.marp.presentWindow']).toBe('app');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
