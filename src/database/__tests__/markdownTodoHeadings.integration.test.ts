/**
 * Markdown heading TODO/planning indexing: `# TODO Title` (org keywords,
 * honoring #+TODO:), legacy `## [TODO] Title`, and org-style SCHEDULED: /
 * DEADLINE: lines under the heading, so markdown headings reach the agenda.
 * Front matter and HTML comments are not headings.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore } from '../scimaxDbCore';

const SETUP_TIMEOUT_MS = 60_000;
describe('markdown TODO headings (integration)', () => {
    let dir: string;
    let file: string;
    let db: ScimaxDbCore;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-mdtodo-'));
        file = path.join(dir, 'tasks.markdown');
        fs.writeFileSync(file, [
            '---',
            '# not a heading: front matter',
            '---',
            '<!-- #+TODO: TODO REVIEW | SHIPPED -->',
            '# TODO Canonical task',
            'SCHEDULED: <2020-01-02 Thu>',
            '## REVIEW Custom keyword',
            'DEADLINE: <2020-01-03 Fri>',
            '## SHIPPED Finished one',
            '## [TODO] Legacy task',
            '<!--',
            '# not a heading: comment',
            '-->',
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
            ['Canonical task', 'TODO', 'todo', '2020-01-02 Thu', null],
            ['Custom keyword', 'REVIEW', 'todo', null, '2020-01-03 Fri'],
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
