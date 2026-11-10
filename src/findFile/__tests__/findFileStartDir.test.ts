import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));
vi.mock('../findFilePanel', () => ({ FindFilePanel: {} }));
vi.mock('../../dired/diredPanel', () => ({ DiredPanel: {} }));

import { findFileStartDir } from '../findFileCommands';

describe('findFileStartDir (C-x C-f)', () => {
    it('starts in the focused dired directory', () => {
        expect(findFileStartDir('/d', { scheme: 'file', fsPath: '/e/f.org' }, '/w', '/h')).toBe('/d');
    });
    it('then the active file folder, workspace, home', () => {
        expect(findFileStartDir(undefined, { scheme: 'file', fsPath: '/e/f.org' }, '/w', '/h')).toBe('/e');
        expect(findFileStartDir(undefined, { scheme: 'untitled', fsPath: 'x' }, '/w', '/h')).toBe('/w');
        expect(findFileStartDir(undefined, undefined, undefined, '/h')).toBe('/h');
    });
});
