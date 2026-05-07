/**
 * Tests for the pure classify step that drives `scimax db sync`.
 */

import { describe, it, expect } from 'vitest';
import { classifyForSync } from '../commands/db';

describe('classifyForSync', () => {
    const noStat = (_: string) => null;

    it('classifies a discovered file not in DB as new', () => {
        const out = classifyForSync(
            [{ path: '/a.org', mtimeMs: 1000 }],
            [],
            noStat
        );
        expect(out).toEqual([{ path: '/a.org', action: 'new' }]);
    });

    it('classifies a discovered file with newer mtime than DB as updated', () => {
        const out = classifyForSync(
            [{ path: '/a.org', mtimeMs: 5000 }],
            [{ path: '/a.org', mtime: 1000 }],
            noStat
        );
        expect(out).toEqual([{ path: '/a.org', action: 'updated' }]);
    });

    it('treats sub-second mtime drift as unchanged', () => {
        const out = classifyForSync(
            [{ path: '/a.org', mtimeMs: 1000.4 }],
            [{ path: '/a.org', mtime: 1000.0 }],
            noStat
        );
        expect(out).toEqual([{ path: '/a.org', action: 'unchanged' }]);
    });

    it('classifies a DB-only file that no longer exists as removed', () => {
        const out = classifyForSync(
            [],
            [{ path: '/gone.org', mtime: 1000 }],
            (_: string) => null
        );
        expect(out).toEqual([{ path: '/gone.org', action: 'removed' }]);
    });

    it('classifies an out-of-scope DB file with stale mtime as out-of-scope-refresh', () => {
        const out = classifyForSync(
            [],
            [{ path: '/out.org', mtime: 1000 }],
            (p: string) => p === '/out.org' ? { mtimeMs: 9999 } : null
        );
        expect(out).toEqual([{ path: '/out.org', action: 'out-of-scope-refresh' }]);
    });

    it('classifies an out-of-scope DB file matching mtime as out-of-scope-skip', () => {
        const out = classifyForSync(
            [],
            [{ path: '/out.org', mtime: 1000 }],
            (p: string) => p === '/out.org' ? { mtimeMs: 1000 } : null
        );
        expect(out).toEqual([{ path: '/out.org', action: 'out-of-scope-skip' }]);
    });

    it('handles a mixed reconciliation in one pass', () => {
        const disk = [
            { path: '/a.org', mtimeMs: 1000 },          // new
            { path: '/b.org', mtimeMs: 2000 },          // updated
            { path: '/c.org', mtimeMs: 3000 }           // unchanged
        ];
        const db = [
            { path: '/b.org', mtime: 1000 },
            { path: '/c.org', mtime: 3000 },
            { path: '/d.org', mtime: 4000 },            // removed (stat returns null)
            { path: '/e.org', mtime: 5000 }             // out-of-scope-skip
        ];
        const stat = (p: string) => p === '/e.org' ? { mtimeMs: 5000 } : null;

        const out = classifyForSync(disk, db, stat);
        const byPath = Object.fromEntries(out.map(e => [e.path, e.action]));
        expect(byPath).toEqual({
            '/a.org': 'new',
            '/b.org': 'updated',
            '/c.org': 'unchanged',
            '/d.org': 'removed',
            '/e.org': 'out-of-scope-skip'
        });
    });
});
