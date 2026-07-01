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
import { executeDynamicBlock } from '../orgDynamicBlocks';
import { slugify, effortToDays } from '../projectTasks';

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

describe('gantt dynamic block', () => {
    it('emits a mermaid gantt with dependencies and effort durations', () => {
        const doc = parseOrg(DOC);
        const res = executeDynamicBlock('gantt', ':title Project X :sections none', doc, 'x.org');
        expect(res.success).toBe(true);
        expect(res.content).toContain('#+begin_src mermaid');
        expect(res.content).toContain('gantt');
        expect(res.content).toContain('dateFormat');
        // analysis has an explicit scheduled start and 2d effort
        expect(res.content).toMatch(/Run analysis :.*2026-07-01, 2d/);
        // figures depends on analysis -> "after analysis"
        expect(res.content).toMatch(/Make figures :.*after analysis/);
        // paper is [#A] -> crit, depends on analysis and figures
        expect(res.content).toMatch(/Write paper :.*crit.*after analysis figures/);
    });

    it('groups into sections by assignee', () => {
        const doc = parseOrg(DOC);
        const res = executeDynamicBlock('gantt', ':sections assignee', doc, 'x.org');
        expect(res.content).toContain('section');
    });
});
