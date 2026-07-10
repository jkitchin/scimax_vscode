/**
 * Tests for resolveDatetreeTarget (issue #47 audit, item D4).
 *
 * Beyond honoring the datetreeFormat granularity, this also fixes a latent
 * bug: the previous implementation computed the missing year/month/day
 * headings but discarded them (CaptureLocation had nowhere to carry them), so
 * capturing into a file that lacked the date headings produced an orphaned
 * entry. The scaffold now travels in CaptureLocation.prefix; these tests
 * assert both the returned location and the composed document.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: vi.fn(() => ({ get: vi.fn((_k: string, d?: any) => d) })),
    },
}));

import { resolveDatetreeTarget } from '../captureProvider';
import type { CaptureLocation } from '../../parser/orgCapture';

const DATE = new Date(2024, 3, 15); // Mon 2024-04-15, ISO week 16

let dir: string;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-datetree-'));
});
afterEach(() => {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // best-effort
    }
});

function writeFixture(content: string): string {
    const p = path.join(dir, 'journal.org');
    fs.writeFileSync(p, content);
    return p;
}

/** Mirror of insertCapture: place prefix+level-adjusted entry at location.line. */
function compose(content: string, location: CaptureLocation, entry: string): string {
    const lines = content.split('\n');
    let adjusted = entry;
    if (location.level && location.level > 1) {
        adjusted = entry.replace(/^(\*+)/gm, (m) => '*'.repeat(m.length + location.level! - 1));
    }
    if (!adjusted.endsWith('\n')) adjusted += '\n';
    lines.splice(location.line, 0, (location.prefix ?? '') + adjusted);
    return lines.join('\n');
}

describe('resolveDatetreeTarget (day format)', () => {
    it('scaffolds the full year/month/day tree in an empty file', () => {
        const file = writeFixture('');
        const loc = resolveDatetreeTarget(file, DATE, 'day');
        expect(loc.level).toBe(4);
        expect(loc.prefix).toBe('* 2024\n** 2024-04 April\n*** 2024-04-15 Monday\n');

        const doc = compose('', loc, '* Captured note');
        expect(doc).toContain('* 2024');
        expect(doc).toContain('** 2024-04 April');
        expect(doc).toContain('*** 2024-04-15 Monday');
        expect(doc).toContain('**** Captured note');
    });

    it('scaffolds only the missing month/day when the year exists', () => {
        const file = writeFixture('* 2024\n');
        const loc = resolveDatetreeTarget(file, DATE, 'day');
        expect(loc.prefix).toBe('** 2024-04 April\n*** 2024-04-15 Monday\n');
        expect(loc.level).toBe(4);
    });

    it('scaffolds only the day when year+month exist', () => {
        const file = writeFixture('* 2024\n** 2024-04 April\n');
        const loc = resolveDatetreeTarget(file, DATE, 'day');
        expect(loc.prefix).toBe('*** 2024-04-15 Monday\n');
    });

    it('adds no scaffold when the full path already exists', () => {
        const file = writeFixture('* 2024\n** 2024-04 April\n*** 2024-04-15 Monday\n');
        const loc = resolveDatetreeTarget(file, DATE, 'day');
        expect(loc.prefix).toBe('');
        // Entry is appended within the existing day section.
        const doc = compose(fs.readFileSync(file, 'utf-8'), loc, '* Second note');
        expect(doc).toContain('*** 2024-04-15 Monday');
        expect(doc).toContain('**** Second note');
        // Only one day heading — not duplicated.
        expect(doc.match(/2024-04-15 Monday/g)?.length).toBe(1);
    });

    it('does not confuse a different month/day under the same year', () => {
        const file = writeFixture('* 2024\n** 2024-03 March\n*** 2024-03-01 Friday\n');
        const loc = resolveDatetreeTarget(file, DATE, 'day');
        // Year matches, but April month is missing -> scaffold month+day.
        expect(loc.prefix).toBe('** 2024-04 April\n*** 2024-04-15 Monday\n');
    });
});

describe('resolveDatetreeTarget (month format)', () => {
    it('scaffolds a 2-level year/month tree, entry at level 3', () => {
        const file = writeFixture('');
        const loc = resolveDatetreeTarget(file, DATE, 'month');
        expect(loc.level).toBe(3);
        expect(loc.prefix).toBe('* 2024\n** 2024-04 April\n');
    });

    it('adds no scaffold when year/month already exist', () => {
        const file = writeFixture('* 2024\n** 2024-04 April\n');
        const loc = resolveDatetreeTarget(file, DATE, 'month');
        expect(loc.prefix).toBe('');
        expect(loc.level).toBe(3);
    });
});

describe('resolveDatetreeTarget (week format)', () => {
    it('scaffolds a 2-level ISO year/week tree, entry at level 3', () => {
        const file = writeFixture('');
        const loc = resolveDatetreeTarget(file, DATE, 'week');
        expect(loc.level).toBe(3);
        expect(loc.prefix).toBe('* 2024\n** 2024-W16\n');
    });
});
