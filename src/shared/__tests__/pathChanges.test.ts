import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import { indexUpdatesFor, notifyPathsChanged, onPathsChanged } from '../pathChanges';

// new locations come back resolved (D:\\n\\... on Windows)
const r = (...ps: string[]) => ps.map(p => path.resolve(p));

const indexed = ['/n/a.org', '/n/sub/b.org', '/n/sub/deep/c.md', '/n/subway.org', '/x/y.org'];

describe('indexUpdatesFor', () => {
    it('drops deleted files and everything under a deleted folder', () => {
        expect(indexUpdatesFor(indexed, { moved: [], deleted: ['/n/sub', '/x/y.org'] })).toEqual({
            remove: ['/n/sub/b.org', '/n/sub/deep/c.md', '/x/y.org'], index: [],
        });
    });

    it('moves a renamed folder\'s files to their new paths', () => {
        expect(indexUpdatesFor(indexed, { moved: [{ from: '/n/sub', to: '/n/archive/sub' }], deleted: [] })).toEqual({
            remove: ['/n/sub/b.org', '/n/sub/deep/c.md'],
            index: r('/n/archive/sub/b.org', '/n/archive/sub/deep/c.md'),
        });
    });

    it('indexes a moved file that was not indexed only when wanted', () => {
        const changes = { moved: [{ from: '/n/notes.txt', to: '/n/notes.org' }], deleted: [] };
        expect(indexUpdatesFor(indexed, changes).index).toEqual([]);
        expect(indexUpdatesFor(indexed, changes, p => p.endsWith('.org')).index).toEqual(r('/n/notes.org'));
        // a renamed indexed file is re-indexed under its new name
        expect(indexUpdatesFor(indexed, { moved: [{ from: '/n/a.org', to: '/n/A.org' }], deleted: [] }))
            .toEqual({ remove: ['/n/a.org'], index: r('/n/A.org') });
    });
});

describe('notifyPathsChanged', () => {
    it('tells listeners, skips empty changes, and survives a failing listener', () => {
        const seen = vi.fn();
        const bad = onPathsChanged(() => { throw new Error('x'); });
        const sub = onPathsChanged(seen);
        notifyPathsChanged({});
        notifyPathsChanged({ deleted: ['/a'] });
        sub.dispose(); bad.dispose();
        notifyPathsChanged({ deleted: ['/b'] });
        expect(seen).toHaveBeenCalledTimes(1);
        expect(seen).toHaveBeenCalledWith({ moved: [], deleted: ['/a'] });
    });
});
