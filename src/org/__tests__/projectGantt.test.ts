import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseOrg } from '../../parser/orgParserUnified';
import { org } from '../../parser/orgModify';
import { extractProjectTasks, isTaskBlocked, parseProgress, scheduleProjectTasks, type ProjectTask } from '../../parser/projectTasks';
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

    it('puts tasks with a deadline first, then the rest, each by start', () => {
        const text = `* TODO Early, no deadline
SCHEDULED: <2026-07-01 Wed>
* TODO Late due
SCHEDULED: <2026-07-08 Wed> DEADLINE: <2026-07-10 Fri>
* TODO Undated
* TODO Soon due
DEADLINE: <2026-07-03 Fri>
`;
        const titles = (groupBy?: 'assignee') => buildGanttModel(tasksOf(text), { groupBy }, TODAY).rows
            .filter(r => r.kind === 'task').map(r => r.title);
        const expected = ['Soon due', 'Late due', 'Early, no deadline', 'Undated'];
        expect(titles()).toEqual(expected);
        expect(titles('assignee')).toEqual(expected);
    });

    it('leaves out the tasks of hidden files, still listing every file', () => {
        const tasks = [...tasksOf(MAIN, '/p/main.org'), ...tasksOf('* TODO Other\n', '/p/sub/other.org')];
        const model = buildGanttModel(tasks, { root: '/p', hiddenFiles: ['sub/other.org'] }, TODAY);
        expect(model.files).toEqual(['main.org', 'sub/other.org']);
        expect(model.rows.map(r => r.kind === 'task' && r.file)).not.toContain('sub/other.org');
        expect(model.shownTasks).toBe(3);
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

const AIMS = `* Aim 1
** TODO Synthesis
SCHEDULED: <2026-06-22 Mon>
*** DONE Make catalyst A
:PROPERTIES:
:EFFORT: 2d
:END:
*** TODO Make catalyst B
:PROPERTIES:
:EFFORT: 2d
:PROGRESS: 50
:END:
*** TODO Characterize
:PROPERTIES:
:EFFORT: 4d
:END:
*** CANCELLED Old route
:PROPERTIES:
:EFFORT: 10d
:END:
* Aim 2
** TODO Model
SCHEDULED: <2026-07-06 Mon>
`;

const rowsOf = (model: ReturnType<typeof buildGanttModel>) => model.rows as any[];
const find = (model: ReturnType<typeof buildGanttModel>, title: string) =>
    rowsOf(model).find(r => (r.title ?? r.label) === title);

describe('parseProgress', () => {
    it('reads 0-100 with or without %, and ignores anything else', () => {
        expect(parseProgress('50')).toBe(50);
        expect(parseProgress(' 12.5% ')).toBe(12.5);
        expect(parseProgress('0')).toBe(0);
        expect(parseProgress('100%')).toBe(100);
        expect(parseProgress('150')).toBeUndefined();
        expect(parseProgress('half')).toBeUndefined();
        expect(parseProgress(undefined)).toBeUndefined();
    });
});

describe('progress', () => {
    it('is off by default, leaving rows as they were', () => {
        const model = buildGanttModel(tasksOf(AIMS), { groupBy: 'outline' }, TODAY);
        expect(model.progress).toBe(false);
        expect(rowsOf(model).every(r => !r.progress && !r.behind && !r.summary)).toBe(true);
        expect(find(model, 'Aim 1').start).toBeUndefined();
    });

    it('lays out an outline: headings above their tasks, by depth', () => {
        const model = buildGanttModel(tasksOf(AIMS), { groupBy: 'outline' }, TODAY);
        expect(rowsOf(model).map(r => [r.title ?? r.label, r.depth])).toEqual([
            ['Aim 1', 1], ['Synthesis', 2], ['Make catalyst B', 3], ['Characterize', 3],
            ['Aim 2', 1], ['Model', 2],
        ]);
        expect(find(model, 'Aim 1').line).toBe(1);
    });

    it('weights by effort, counts done tasks hidden from view, and drops CANCELLED', () => {
        const model = buildGanttModel(tasksOf(AIMS), { groupBy: 'outline', showProgress: true }, TODAY);
        expect(model.progressMethod).toBe('effort');
        // A (2d) done + B (2d) half done, of 8d; the cancelled 10d is left out.
        const synthesis = find(model, 'Synthesis');
        expect(synthesis.summary).toBe(true);
        expect(synthesis.progress).toMatchObject({ percent: 37.5, method: 'effort', tasks: 3, done: 1, unestimated: 0 });
        expect(find(model, 'Aim 1').progress.percent).toBe(37.5);
        // Summary bar spans its subtasks, not the cancelled one.
        expect(synthesis.start).toBe('2026-06-22');
        expect(synthesis.end).toBe('2026-06-26');
        expect(find(model, 'Aim 1').end).toBe('2026-06-26');
    });

    it('counts tasks when asked, or when most tasks have no effort', () => {
        const counted = buildGanttModel(tasksOf(AIMS), { groupBy: 'outline', showProgress: true, progressWeighting: 'count' }, TODAY);
        expect(find(counted, 'Synthesis').progress.percent).toBe(50);

        const sparse = `* TODO Parent
** DONE a
** TODO b
** TODO c
:PROPERTIES:
:EFFORT: 3d
:END:
`;
        const auto = buildGanttModel(tasksOf(sparse), { showProgress: true }, TODAY);
        expect(auto.progressMethod).toBe('count');
        expect(find(auto, 'Parent').progress.percent).toBeCloseTo(100 / 3);

        const effort = buildGanttModel(tasksOf(sparse), { showProgress: true, progressWeighting: 'effort', defaultEffortMinutes: 8 * 60 }, TODAY);
        // a and b weigh the default 1d each: 1d done of 5d.
        expect(find(effort, 'Parent').progress).toMatchObject({ percent: 20, unestimated: 2 });
    });

    it("gives a leaf its own :PROGRESS:, ignored on parents and overridden by DONE", () => {
        const text = `* TODO Parent
:PROPERTIES:
:PROGRESS: 90
:END:
** TODO Child
:PROPERTIES:
:PROGRESS: 20
:END:
* DONE Finished
:PROPERTIES:
:PROGRESS: 10
:END:
* TODO Plain
`;
        const model = buildGanttModel(tasksOf(text), { showProgress: true, showDone: true }, TODAY);
        expect(find(model, 'Parent').progress.percent).toBe(20);
        expect(find(model, 'Child').progress).toMatchObject({ percent: 20, method: 'own' });
        expect(find(model, 'Finished').progress).toBeUndefined();
        expect(find(model, 'Plain').progress).toBeUndefined();
    });

    it('flags a row behind when it trails the elapsed share by more than the tolerance', () => {
        const at = (pct: number) => `* TODO Work
SCHEDULED: <2026-06-29 Mon>
:PROPERTIES:
:EFFORT: 4d
:PROGRESS: ${pct}
:END:
`;
        // 2 of 4 days gone on 2026-07-01: expected 50%.
        const behind = find(buildGanttModel(tasksOf(at(30)), { showProgress: true }, TODAY), 'Work');
        expect(behind.progress.expected).toBe(50);
        expect(behind.behind).toBe(true);
        expect(find(buildGanttModel(tasksOf(at(45)), { showProgress: true }, TODAY), 'Work').behind).toBe(false);
        expect(find(buildGanttModel(tasksOf(at(45)), { showProgress: true, behindTolerance: 0 }, TODAY), 'Work').behind).toBe(true);
        // A span that has ended with work left is behind; one not started is not.
        const model = buildGanttModel(tasksOf(AIMS), { groupBy: 'outline', showProgress: true }, TODAY);
        expect(find(model, 'Synthesis').behind).toBe(true);
        expect(model.behindCount).toBe(3); // Aim 1, Synthesis, Make catalyst B
        expect(find(model, 'Model').behind).toBe(false);
    });

    it('rolls up group headers over the group, counting done tasks that are hidden', () => {
        const text = `* TODO a
:PROPERTIES:
:ASSIGNEE: jrk
:END:
* DONE b
:PROPERTIES:
:ASSIGNEE: jrk
:END:
* TODO c
:PROPERTIES:
:ASSIGNEE: ana
:END:
`;
        const model = buildGanttModel(tasksOf(text), { groupBy: 'assignee', showProgress: true }, TODAY);
        expect(find(model, 'jrk').progress.percent).toBe(50);
        expect(find(model, 'ana').progress.percent).toBe(0);
        expect(find(model, 'jrk').start).toBeDefined();
        // The assignee filter narrows rollups too.
        const mine = buildGanttModel(tasksOf(AIMS + text), { groupBy: 'none', showProgress: true, assignee: 'jrk' }, TODAY);
        expect(rowsOf(mine).map(r => r.title)).toEqual(['a']);
    });

    it('collapses to a depth, folds rows, and shows only behind rows with context', () => {
        const opts = { groupBy: 'outline' as const, showProgress: true };
        const top = buildGanttModel(tasksOf(AIMS), { ...opts, maxDepth: 1 }, TODAY);
        expect(rowsOf(top).map(r => r.label)).toEqual(['Aim 1', 'Aim 2']);
        expect(find(top, 'Aim 1')).toMatchObject({ collapsed: true, collapsible: false });

        const folded = buildGanttModel(tasksOf(AIMS), { ...opts, collapsed: ['/p/main.org:2'] }, TODAY);
        expect(rowsOf(folded).map(r => r.title ?? r.label)).toEqual(['Aim 1', 'Synthesis', 'Aim 2', 'Model']);
        expect(find(folded, 'Synthesis')).toMatchObject({ collapsed: true, collapsible: true });
        expect(find(folded, 'Aim 1')).toMatchObject({ collapsed: false, collapsible: true });

        const late = buildGanttModel(tasksOf(AIMS), { ...opts, behindOnly: true, progressWeighting: 'count' }, TODAY);
        expect(rowsOf(late).map(r => r.title ?? r.label)).toEqual(['Aim 1', 'Synthesis', 'Make catalyst B']);
    });

    it('adds a file row per file to an outline of several files', () => {
        const model = buildGanttModel([...tasksOf(AIMS, '/p/a.org'), ...tasksOf(MAIN, '/p/b.org')],
            { groupBy: 'outline', showProgress: true, root: '/p' }, TODAY);
        const files = rowsOf(model).filter(r => r.depth === 0);
        expect(files.map(r => r.label)).toEqual(['a.org', 'b.org']);
        // Aim 1's 3d done of 8d, plus Aim 2's unestimated Model at the default 1d.
        expect(files[0].progress).toMatchObject({ tasks: 4, unestimated: 1 });
        expect(files[0].progress.percent).toBeCloseTo(100 / 3);
    });

    it('exports progress: % done and Status columns, hatched cells, and the PDF hatch', async () => {
        const model = buildGanttModel(tasksOf(AIMS), { groupBy: 'outline', showProgress: true }, TODAY);
        const zip = await JSZip.loadAsync(await ganttToXlsx(model, 'Aims'));
        const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
        const styles = await zip.file('xl/styles.xml')!.async('string');
        expect(sheet).toContain('% done');
        expect(sheet).toContain('>behind<');
        expect(sheet).toContain('<v>0.38</v>');      // Synthesis, 37.5% rounded
        expect(sheet).toContain('   Make catalyst B'); // outline indent
        expect(sheet).toMatch(/ s="17"/);              // a hatched summary day
        expect(styles).toContain('patternType="darkUp"');
        expect(styles.match(/<xf /g)!.length - 1).toBe(Number(styles.match(/<cellXfs count="(\d+)"/)![1]));
        expect(styles.match(/<fill>/g)!.length).toBe(Number(styles.match(/<fills count="(\d+)"/)![1]));

        const pdf = ganttToPdf(model, 'Aims').toString('latin1');
        expect(pdf).toContain('(38%)');
        expect(pdf).toContain('re W n');               // the hatch's clip
        expect(pdf).toContain('(behind schedule)');
    });

    it('leaves the exports as they were with progress off', async () => {
        const model = buildGanttModel(tasksOf(AIMS), { groupBy: 'outline' }, TODAY);
        const sheet = await (await JSZip.loadAsync(await ganttToXlsx(model))).file('xl/worksheets/sheet1.xml')!.async('string');
        expect(sheet).not.toContain('% done');
        expect(ganttToPdf(model).toString('latin1')).not.toContain('re W n');
    });
});
