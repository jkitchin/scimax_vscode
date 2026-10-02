/**
 * Markdown indexing must not record `# comment` lines inside fenced code blocks as headings.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore } from '../scimaxDbCore';

// Creating and indexing a database can pass vitest's 10 s hook limit on a slow CI runner (Windows)
const SETUP_TIMEOUT_MS = 60_000;

describe('markdown headings in code fences (integration)', () => {
    let dir: string;
    let file: string;
    let db: ScimaxDbCore;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-mdfence-'));
        file = path.join(dir, 'notes.md');
        fs.writeFileSync(file, [
            '# Real Heading',
            '',
            '```python',
            '# not a heading',
            'x = 1',
            '```',
            '',
            '## Real Sub',
            '',
            '~~~sh',
            '# also not a heading',
            '~~~',
        ].join('\n'));
        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.indexFile(file);
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await db.close?.();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    });

    it('indexes only the headings outside code fences', async () => {
        const headings = await db.getHeadingsInFile(file);
        expect(headings.map(h => [h.level, h.title, h.line_number])).toEqual([
            [1, 'Real Heading', 1],
            [2, 'Real Sub', 8],
        ]);
    });
});
