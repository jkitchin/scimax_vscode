/**
 * getAllTags lists heading :tags: (not #hashtags) with usage counts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore } from '../scimaxDbCore';

describe('getAllTags (integration)', () => {
    let dir: string;
    let db: ScimaxDbCore;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-tags-'));
        const a = path.join(dir, 'a.org');
        const b = path.join(dir, 'b.org');
        fs.writeFileSync(a, [
            '* Monday sync          :groupmeeting:',
            '** Notes               :ml:',
            '* Tuesday              :groupmeetings:Work:',
            'Some text with a #hashtag in it.',
        ].join('\n'));
        fs.writeFileSync(b, [
            '* Another sync         :groupmeeting:',
            '* Untagged',
        ].join('\n'));
        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.indexFile(a);
        await db.indexFile(b);
    });

    afterAll(async () => {
        await db.close?.();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    });

    it('returns heading tags with counts, sorted case-insensitively', async () => {
        const tags = await db.getAllTags();
        expect(tags).toEqual([
            { tag: 'groupmeeting', count: 2 },
            { tag: 'groupmeetings', count: 1 },
            { tag: 'ml', count: 1 },
            { tag: 'Work', count: 1 },
        ]);
    });

    it('does not count inherited tags or hashtags', async () => {
        const tags = (await db.getAllTags()).map(t => t.tag);
        expect(tags).not.toContain('hashtag');
    });

    it('finds headings for a listed tag, including ones that inherit it', async () => {
        const hits = await db.searchHeadings('', { tag: 'groupmeeting' });
        expect(hits.map(h => h.title).sort()).toEqual(['Another sync', 'Monday sync', 'Notes']);
    });
});
