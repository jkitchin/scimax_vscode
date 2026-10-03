import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseOrg } from '../../parser/orgParserUnified';
import { org } from '../../parser/orgModify';
import { extractProjectTasks, isTaskBlocked, scheduleProjectTasks, type ProjectTask } from '../../parser/projectTasks';
import { buildGanttModel, columnName, ganttToPdf, ganttToXlsx, type GanttTaskInput } from '../projectGantt';

const TODAY = new Date(2026, 6, 1); // Wed 2026-07-01

const MAIN = `* Project
** TODO Run analysis
SCHEDULED: <2026-07-01 Wed>
:PROPERTIES:
:ID: analysis
:EFFORT: 2d
:ASSIGNEE: jrk
:END:
** TODO Make figures
:PROPERTIES:
:ID: figs
:EFFORT: 1d
:DEPENDS: id:analysis
:ASSIGNEE: ana
:END:
** TODO [#A] Submit
DEADLINE: <2026-07-20 Mon>
** DONE Kickoff
`;

function tasksOf(text: string, file = '/p/main.org'): GanttTaskInput[] {
    const doc = parseOrg(text, {});
    const tasks = extractProjectTasks(doc, org.getAllHeadlines(doc), { file });
    const byId = new Map<string, ProjectTask>();
    for (const t of tasks) if (t.id) byId.set(t.id, t);
    return tasks.map(t => ({ ...t, file, blocked: !t.isDone && isTaskBlocked(t, byId) }));
}

const day = (s: string) => s;

describe('scheduleProjectTasks', () => {
    it('starts a dependent task when its dependency ends, and lays out efforts in days', () => {
        const tasks = tasksOf(MAIN);
        const spans = scheduleProjectTasks(tasks, TODAY);
        const get = (title: string) => spans.get(tasks.find(t => t.title === title)!.ganttId)!;
        expect(get('Run analysis').start).toEqual(new Date(2026, 6, 1));
        expect(get('Run analysis').end).toEqual(new Date(2026, 6, 3));
        expect(get('Make figures').start).toEqual(new Date(2026, 6, 3));
        expect(get('Make figures').end).toEqual(new Date(2026, 6, 4));
        expect(get('Submit').milestone).toBe(true);
        expect(get('Submit').start).toEqual(new Date(2026, 6, 20));
    });

    it('survives a dependency cycle', () => {
        const tasks = tasksOf(`* TODO A
:PROPERTIES:
:ID: a
:DEPENDS: id:b
:END:
* TODO B
:PROPERTIES:
:ID: b
:DEPENDS: id:a
:END:
`);
        expect(scheduleProjectTasks(tasks, TODAY).size).toBe(2);
    });
});

describe('buildGanttModel', () => {
    it('hides done tasks by default and flags blocked ones', () => {
        const model = buildGanttModel(tasksOf(MAIN), {}, TODAY);
        const rows = model.rows.filter(r => r.kind === 'task') as any[];
        expect(rows.map(r => r.title)).not.toContain('Kickoff');
        expect(rows.find(r => r.title === 'Make figures').status).toBe('blocked');
        expect(rows.find(r => r.title === 'Run analysis').status).toBe('active');
        expect(rows.find(r => r.title === 'Make figures').dependsOn).toHaveLength(1);
        expect(model.today).toBe(day('2026-07-01'));
        expect(model.assignees).toEqual(['ana', 'jrk']);
    });

    it('calls a task in progress only once its own SCHEDULED date has come', () => {
        const model = buildGanttModel(tasksOf(`* TODO Unscheduled\n* TODO Later\nSCHEDULED: <2026-07-10 Fri>\n`), {}, TODAY);
        const status = Object.fromEntries(model.rows.map((r: any) => [r.title, r.status]));
        expect(status).toEqual({ Unscheduled: 'planned', Later: 'planned' });
    });

    it('filters by assignee, including unassigned', () => {
        const ana = buildGanttModel(tasksOf(MAIN), { assignee: 'ana' }, TODAY);
        expect(ana.rows.map((r: any) => r.title)).toEqual(['Make figures']);
        const none = buildGanttModel(tasksOf(MAIN), { assignee: '' }, TODAY);
        expect(none.rows.map((r: any) => r.title)).toEqual(['Submit']);
    });

    it('groups rows under headers, Unassigned last', () => {
        const model = buildGanttModel(tasksOf(MAIN), { groupBy: 'assignee' }, TODAY);
        const groups = model.rows.filter(r => r.kind === 'group').map((r: any) => r.label);
        expect(groups).toEqual(['ana', 'jrk', 'Unassigned']);
    });

    const TAGGED = `#+FILETAGS: :grant:
* Writing :paper:
** TODO Draft :urgent:@ana:
** TODO Revise
* TODO Order parts :lab:
`;

    it('gives tasks their own, inherited and file tags, without @assignee tags', () => {
        const tags = Object.fromEntries(tasksOf(TAGGED).map(t => [t.title, [...t.tags].sort()]));
        expect(tags).toEqual({
            Draft: ['grant', 'paper', 'urgent'],
            Revise: ['grant', 'paper'],
            'Order parts': ['grant', 'lab'],
        });
        expect(buildGanttModel(tasksOf(TAGGED), {}, TODAY).tags).toEqual(['grant', 'lab', 'paper', 'urgent']);
    });

    it('filters to tasks with any of the chosen tags', () => {
        const titles = (tags?: string[]) =>
            buildGanttModel(tasksOf(TAGGED), { tags }, TODAY).rows.map((r: any) => r.title);
        expect(titles(['urgent'])).toEqual(['Draft']);
        expect(titles(['paper'])).toEqual(['Draft', 'Revise']);
        expect(titles(['urgent', 'lab'])).toEqual(['Draft', 'Order parts']);
        expect(titles([])).toHaveLength(3);
        expect(titles(undefined)).toHaveLength(3);
        // The model still lists every tag, so the menu can offer them all.
        expect(buildGanttModel(tasksOf(TAGGED), { tags: ['lab'] }, TODAY).tags).toHaveLength(4);
    });

    it('marks bars that end on their deadline, so their end can be dragged', () => {
        const text = `* TODO Write
SCHEDULED: <2026-07-01 Wed> DEADLINE: <2026-07-03 Fri>
* TODO Sized
SCHEDULED: <2026-07-01 Wed> DEADLINE: <2026-07-10 Fri>
:PROPERTIES:
:EFFORT: 1d
:END:
* TODO Due
DEADLINE: <2026-07-09 Thu>
`;
        const rows = buildGanttModel(tasksOf(text), {}, TODAY).rows;
        const ends = Object.fromEntries(rows.map(r => r.kind === 'task' ? [r.title, r.endsAtDeadline] : []));
        expect(ends).toEqual({ Write: true, Sized: false, Due: false });
    });

    it('drops arrows to tasks that are filtered out', () => {
        const model = buildGanttModel(tasksOf(MAIN), { assignee: 'ana' }, TODAY);
        expect((model.rows[0] as any).dependsOn).toEqual([]);
    });
});

describe('exports', () => {
    it('columnName counts like a spreadsheet', () => {
        expect(columnName(0)).toBe('A');
        expect(columnName(25)).toBe('Z');
        expect(columnName(26)).toBe('AA');
        expect(columnName(701)).toBe('ZZ');
        expect(columnName(702)).toBe('AAA');
    });

    it('writes an xlsx with the tasks and coloured timeline cells', async () => {
        const model = buildGanttModel(tasksOf(MAIN), {}, TODAY);
        const buf = await ganttToXlsx(model, 'Demo & <Test>');
        const zip = await JSZip.loadAsync(buf);
        expect(Object.keys(zip.files)).toEqual(expect.arrayContaining([
            '[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml',
        ]));
        const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
        expect(sheet).toContain('Make figures');
        expect(sheet).toContain('Demo &amp; &lt;Test&gt;');
        expect(sheet).toMatch(/ s="5"/); // a blocked-coloured day cell
        expect(sheet).toContain('◆');     // the milestone
    });

    it('writes a PDF whose cross-reference table points at its objects', () => {
        const model = buildGanttModel(tasksOf(MAIN), {}, TODAY);
        const pdf = ganttToPdf(model, 'Demo (é) 🔒');
        const text = pdf.toString('latin1');
        expect(text.startsWith('%PDF-1.4')).toBe(true);
        expect(text).toContain('(Demo \\(\\351\\) ?)');
        const xrefAt = Number(text.match(/startxref\n(\d+)/)![1]);
        expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
        const offsets = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
        offsets.forEach((o, i) => expect(text.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
    });
});
