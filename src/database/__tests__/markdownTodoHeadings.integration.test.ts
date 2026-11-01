/**
 * Markdown heading TODO/planning indexing: `# TODO Title` (org keywords,
 * honoring #+TODO:), legacy `## [TODO] Title`, and `@scheduled(...)` /
 * `@due(...)` / `@deadline(...)` metadata stored like org planning so markdown
 * headings reach the agenda.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore, parseMarkdownHeadingText } from '../scimaxDbCore';

const SETUP_TIMEOUT_MS = 60_000;
const STATES = new Set(['TODO', 'NEXT', 'DONE', 'CANCELLED']);

describe('parseMarkdownHeadingText', () => {
    it('strips an org TODO keyword into todoState', () => {
        expect(parseMarkdownHeadingText('TODO Write paper', STATES)).toMatchObject({ title: 'Write paper', todoState: 'TODO' });
        expect(parseMarkdownHeadingText('DONE Write paper', STATES)).toMatchObject({ title: 'Write paper', todoState: 'DONE' });
    });

    it('does not treat an unknown first word as a keyword', () => {
        expect(parseMarkdownHeadingText('TODOS for today', STATES)).toMatchObject({ title: 'TODOS for today', todoState: null });
    });

    it('keeps reading legacy [TODO]', () => {
        expect(parseMarkdownHeadingText('[TODO] Old style', STATES)).toMatchObject({ title: 'Old style', todoState: 'TODO' });
    });

    it('extracts planning metadata, priority and tags', () => {
        const h = parseMarkdownHeadingText('TODO Task @scheduled(2026-01-05) @due(2026-01-09) @priority(a) #work #urgent', STATES);
        expect(h).toMatchObject({
            title: 'Task', todoState: 'TODO', scheduled: '2026-01-05', deadline: '2026-01-09',
            priority: 'A', tags: ['work', 'urgent']
        });
    });

    it('reads @deadline as an alias for @due and @closed', () => {
        const h = parseMarkdownHeadingText('DONE Task @deadline(2026-03-01) @closed(2026-02-28)', STATES);
        expect(h).toMatchObject({ title: 'Task', deadline: '2026-03-01', closed: '2026-02-28' });
    });

    it('ignores invalid dates', () => {
        expect(parseMarkdownHeadingText('TODO X @due(2026-02-30)', STATES).deadline).toBeNull();
    });
});

describe('markdown TODO headings (integration)', () => {
    let dir: string;
    let file: string;
    let db: ScimaxDbCore;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-mdtodo-'));
        file = path.join(dir, 'tasks.markdown');
        fs.writeFileSync(file, [
            '#+TODO: TODO REVIEW | SHIPPED',
            '# TODO Canonical task @scheduled(2020-01-02)',
            '## REVIEW Custom keyword @due(2020-01-03)',
            '## SHIPPED Finished one',
            '## [TODO] Legacy task',
            '# Plain heading',
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

    it('indexes .markdown headings with todo state, type and planning', async () => {
        const headings = await db.getHeadingsInFile(file);
        expect(headings.map(h => [h.title, h.todo_state, h.todo_type, h.scheduled, h.deadline])).toEqual([
            ['Canonical task', 'TODO', 'todo', '2020-01-02', null],
            ['Custom keyword', 'REVIEW', 'todo', null, '2020-01-03'],
            ['Finished one', 'SHIPPED', 'done', null, null],
            ['Legacy task', 'TODO', 'todo', null, null],
            ['Plain heading', null, null, null, null],
        ]);
    });

    it('puts scheduled/due markdown headings on the agenda', async () => {
        const items = await db.getAgenda({ before: '+1w' });
        const summary = items.map(i => [i.type, i.heading.title, i.overdue]).sort();
        expect(summary).toEqual([
            ['deadline', 'Custom keyword', true],
            ['scheduled', 'Canonical task', true],
        ]);
    });
});
