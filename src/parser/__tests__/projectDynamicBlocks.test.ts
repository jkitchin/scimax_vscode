/**
 * Tests for the project-table and gantt dynamic blocks (project management).
 */
import { describe, it, expect, vi } from 'vitest';

// orgDynamicBlocks imports vscode for its editor-integration helpers, but the
// generators under test are pure. Mock vscode so the import resolves.
vi.mock('vscode', () => ({
    window: {}, workspace: {}, commands: {}, languages: {},
    Range: class {}, Position: class {}, Selection: class {},
}));

import { parseOrg } from '../orgParserUnified';
import { executeDynamicBlock, findDynamicBlockAtCursor } from '../orgDynamicBlocks';
import { slugify, effortToDays, getRowAssignees } from '../projectTasks';

describe('projectTasks helpers', () => {
    it('slugify makes handle-safe slugs', () => {
        expect(slugify('John Kitchin')).toBe('john-kitchin');
        expect(slugify('  Ana  B.  ')).toBe('ana-b');
    });
    it('effortToDays rounds up to whole 8h working days', () => {
        expect(effortToDays(2 * 8 * 60)).toBe(2);   // 2d
        expect(effortToDays(4 * 60)).toBe(1);        // 4h -> 1d
        expect(effortToDays(0)).toBeUndefined();
        expect(effortToDays(undefined)).toBeUndefined();
    });
});

const DOC = `* Project X
:PROPERTIES:
:ID: proj-x
:ASSIGNEE: jrk
:END:
** TODO Run analysis
SCHEDULED: <2026-07-01 Wed>
:PROPERTIES:
:ID: analysis
:EFFORT: 2d
:END:
** NEXT Make figures :@ana:
:PROPERTIES:
:ID: figures
:EFFORT: 4h
:DEPENDS: id:analysis
:END:
** TODO [#A] Write paper
DEADLINE: <2026-07-20 Mon>
:PROPERTIES:
:ID: paper
:EFFORT: 1d
:DEPENDS: id:analysis id:figures
:END:
`;

describe('project-table dynamic block', () => {
    it('renders a table of tasks with the requested columns', () => {
        const doc = parseOrg(DOC);
        const res = executeDynamicBlock('project-table',
            ':columns task,todo,assignee,effort,blocked', doc, 'x.org');
        expect(res.success).toBe(true);
        expect(res.content).toContain('| Task');
        expect(res.content).toContain('Run analysis');
        expect(res.content).toContain('Write paper');
    });

    it('marks a task blocked when a same-file dependency is not done', () => {
        const doc = parseOrg(DOC);
        const res = executeDynamicBlock('project-table', ':columns task,blocked', doc, 'x.org');
        // "Write paper" depends on analysis (TODO) -> blocked.
        const paperRow = res.content.split('\n').find(l => l.includes('Write paper'));
        expect(paperRow).toContain('🔒');
    });

    it('picks up @tags and inherited :ASSIGNEE: as assignees', () => {
        const doc = parseOrg(DOC);
        const res = executeDynamicBlock('project-table', ':columns task,assignee', doc, 'x.org');
        expect(res.content).toContain('ana');  // @ana tag on figures
        expect(res.content).toContain('jrk');  // inherited from Project X
    });
});

const ORDERED_DOC = `* Experimental work                         :@wei:
:PROPERTIES:
:ID: expt
:ORDERED: t
:END:
** TODO Synthesize sample
:PROPERTIES:
:ID: synth
:EFFORT: 2d
:END:
** TODO Run measurement
:PROPERTIES:
:ID: measure
:EFFORT: 4h
:END:
`;

describe('inherited @tag assignees and ORDERED chaining', () => {
    it('inherits a subtree @tag as the assignee of its children', () => {
        const doc = parseOrg(ORDERED_DOC);
        const res = executeDynamicBlock('project-table', ':columns task,assignee', doc, 'x.org');
        const rows = res.content.split('\n').filter(l => l.includes('Synthesize') || l.includes('measurement') || l.includes('Run measurement'));
        expect(res.content).toContain('wei');
        // Both subtasks should show wei.
        expect(res.content.match(/wei/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('marks a later ORDERED sibling blocked until the earlier one is done', () => {
        const doc = parseOrg(ORDERED_DOC);
        const res = executeDynamicBlock('project-table', ':columns task,blocked', doc, 'x.org');
        const measureRow = res.content.split('\n').find(l => l.includes('Run measurement'));
        expect(measureRow).toContain('🔒');
    });

});

describe('removed gantt block', () => {
    it('is no longer a dynamic block type', () => {
        const res = executeDynamicBlock('gantt', '', parseOrg(DOC), 'x.org');
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Unknown dynamic block type/);
    });
});

describe('project scope across files', () => {
    const MAIN = `* TODO [#A] Write paper
:PROPERTIES:
:ID: paper
:DEPENDS: id:figs
:END:
`;
    const OTHER = `* Figures
:PROPERTIES:
:ASSIGNEE: ana
:END:
** TODO Make figures
:PROPERTIES:
:ID: figs
:EFFORT: 1d
:END:
`;
    const others = [{ filePath: '/p/sub/figs.org', doc: parseOrg(OTHER, {}) }];

    it('lists tasks from every project file, with a file column', () => {
        const r = executeDynamicBlock('project-table', ':scope project', parseOrg(MAIN, {}), '/p/main.org', others);
        expect(r.success).toBe(true);
        expect(r.content).toContain('File');
        expect(r.content).toContain('sub/figs.org');
        expect(r.content).toContain('Make figures');
        expect(r.content).toContain('ana');
    });

    it('resolves a dependency on a task in another file as blocking', () => {
        const r = executeDynamicBlock('project-table', ':scope project :columns task,blocked', parseOrg(MAIN, {}), '/p/main.org', others);
        const paperRow = r.content.split('\n').find(l => l.includes('Write paper'))!;
        expect(paperRow).toContain('🔒');
    });

    it('stays single-file without :scope project', () => {
        const r = executeDynamicBlock('project-table', '', parseOrg(MAIN, {}), '/p/main.org', others);
        expect(r.content).not.toContain('Make figures');
    });
});

describe('getRowAssignees (indexed headings)', () => {
    const row = (line: number, level: number, props: Record<string, string> = {}, tags: string[] = []) =>
        ({ line_number: line, level, properties: JSON.stringify(props), tags: JSON.stringify(tags) });

    it('uses the heading\'s own :ASSIGNEE: and @tags', () => {
        expect(getRowAssignees(row(5, 2, { ASSIGNEE: 'jrk ana' }, ['@wei']), [])).toEqual(['jrk', 'ana', 'wei']);
    });

    it('inherits from the nearest ancestor that declares one', () => {
        const rows = [row(1, 1, { ASSIGNEE: 'jrk' }), row(3, 2, {}, ['@ana']), row(5, 3), row(8, 2)];
        expect(getRowAssignees(rows[2], rows)).toEqual(['ana']);
        expect(getRowAssignees(rows[3], rows)).toEqual(['jrk']);
    });

    it('ignores earlier siblings', () => {
        const rows = [row(1, 1), row(2, 2, { ASSIGNEE: 'ana' }), row(4, 2)];
        expect(getRowAssignees(rows[2], rows)).toEqual([]);
    });
});

describe('findDynamicBlockAtCursor', () => {
    const lines = ['* Tasks', '#+BEGIN: project-table :columns task,todo', '| Task |', '#+END:', 'after'];
    const document = { lineCount: lines.length, lineAt: (i: number) => ({ text: lines[i] }) };

    it('reads a hyphenated block name whole, so C-c C-c runs project-table', () => {
        const block = findDynamicBlockAtCursor(document as never, { line: 2 } as never);
        expect(block).toEqual({ startLine: 1, endLine: 3, name: 'project-table', args: ':columns task,todo' });
        expect(executeDynamicBlock(block!.name, block!.args, parseOrg(DOC)).error).toBeUndefined();
    });

    it('finds nothing outside a block', () => {
        expect(findDynamicBlockAtCursor(document as never, { line: 4 } as never)).toBeNull();
    });
});
