/**
 * searchHeadingsByTerms backs the C-c d h heading picker: every whitespace
 * term must match (title, TODO state, tags, or file path), searched in SQL
 * over the whole index rather than a preloaded slice. getAllPropertyNames
 * likewise reads property-name completions from the whole index.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore } from '../scimaxDbCore';

// Creating and indexing a database can pass vitest's 10 s hook limit on a slow CI runner (Windows)
const SETUP_TIMEOUT_MS = 60_000;

describe('searchHeadingsByTerms (integration)', () => {
    let dir: string;
    let db: ScimaxDbCore;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-headterms-'));
        const a = path.join(dir, 'alpha.org');
        const z = path.join(dir, 'zeta-proposal.org');
        fs.writeFileSync(a, [
            '* Catalysis background     :science:',
            '* TODO Write budget',
            '* 100% done_item',
        ].join('\n'));
        fs.writeFileSync(z, [
            '* Catalysis aims',
            ':PROPERTIES:',
            ':EFFORT: 2d',
            ':ID: aims-1',
            ':END:',
            '* Budget justification',
            ':PROPERTIES:',
            ':Effort: 1d',
            ':END:',
        ].join('\n'));
        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.indexFile(a);
        await db.indexFile(z);
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await db.close?.();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    });

    const titles = async (q: string) => (await db.searchHeadingsByTerms(q)).map(h => h.title).sort();

    it('requires every term, case-insensitively', async () => {
        expect(await titles('catalysis')).toEqual(['Catalysis aims', 'Catalysis background']);
        expect(await titles('CATAL backg')).toEqual(['Catalysis background']);
    });

    it('matches TODO state, tags, and file path', async () => {
        expect(await titles('todo budget')).toEqual(['Write budget']);
        expect(await titles('science')).toEqual(['Catalysis background']);
        expect(await titles('proposal catal')).toEqual(['Catalysis aims']);
    });

    it('treats LIKE wildcards literally', async () => {
        expect(await titles('100%')).toEqual(['100% done_item']);
        expect(await titles('e_i')).toEqual(['100% done_item']);
        expect(await titles('%')).toEqual(['100% done_item']);
    });

    it('returns headings for an empty query, honoring the limit', async () => {
        expect((await db.searchHeadingsByTerms('')).length).toBe(5);
        expect((await db.searchHeadingsByTerms('', { limit: 2 })).length).toBe(2);
    });

    it('lists distinct property names across the index', async () => {
        const names = await db.getAllPropertyNames();
        expect(names).toEqual(expect.arrayContaining(['EFFORT', 'ID', 'Effort']));
        expect(new Set(names).size).toBe(names.length);
    });
});
