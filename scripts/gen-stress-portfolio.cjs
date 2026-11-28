#!/usr/bin/env node
/**
 * Generate a synthetic team portfolio of org projects, for stress-testing the
 * project-management tools: a team of people working across several
 * projects, with dependencies inside and across projects, efforts, schedules,
 * clocked time, shared instruments and rooms, and time away.
 *
 *   node scripts/gen-stress-portfolio.cjs [outDir] [--start YYYY-MM-DD] [--seed N] [--scale K]
 *
 * outDir defaults to examples/project-portfolio. Dates are laid out around
 * --start (default today), so regenerate to bring the dates back to now.
 * --scale multiplies the number of tasks per phase (1 gives about 400 tasks).
 *
 * The output is deterministic for a given seed, start and scale.
 *
 * Properties the tools do not read yet are included on purpose, as the data
 * the resource features will need: :CAPACITY: and :KIND: on people and
 * resources, "Away" subheadings, and :USES: on tasks that need an instrument
 * or room.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ---- Arguments --------------------------------------------------------------

const argv = process.argv.slice(2);
function flag(name, fallback) {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = argv[i + 1];
    argv.splice(i, 2);
    return v;
}
const startArg = flag('start', undefined);
const seed = Number(flag('seed', '42'));
const scale = Number(flag('scale', '1'));
const outDir = path.resolve(argv[0] ?? path.join(__dirname, '..', 'examples', 'project-portfolio'));

const START = startArg ? new Date(`${startArg}T00:00:00`) : (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
})();

// ---- Seeded randomness (mulberry32) -------------------------------------------

let state = seed >>> 0;
function rand() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = xs => xs[Math.floor(rand() * xs.length)];
const chance = p => rand() < p;
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
/** Pick from [value, weight] pairs. */
function weighted(pairs) {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [v, w] of pairs) {
        if ((r -= w) <= 0) return v;
    }
    return pairs[pairs.length - 1][0];
}

// ---- Dates ----------------------------------------------------------------------

const DAY = 86400000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
/** Move a weekend date to the next Monday. */
function weekday(d) {
    const dow = d.getDay();
    return dow === 6 ? addDays(d, 2) : dow === 0 ? addDays(d, 1) : d;
}
/** Add n working days. */
function addWorkdays(d, n) {
    let out = weekday(d);
    let left = Math.ceil(n);
    while (left > 0) {
        out = addDays(out, 1);
        if (out.getDay() !== 0 && out.getDay() !== 6) left--;
    }
    return out;
}
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const active = d => `<${ymd(d)} ${DOW[d.getDay()]}>`;
const inactive = d => `[${ymd(d)} ${DOW[d.getDay()]}]`;
const inactiveTime = (d, h, m) => `[${ymd(d)} ${DOW[d.getDay()]} ${pad(h)}:${pad(m)}]`;

// ---- The team and the shared resources ------------------------------------------

const PEOPLE = [
    // nick, name, role, capacity (research hours a week), share of assignments
    { nick: 'kim', name: 'Dana Kim', role: 'PI', capacity: '10h/week', weight: 3 },
    { nick: 'osei', name: 'Kwame Osei', role: 'Postdoc', capacity: '40h/week', weight: 9 },
    { nick: 'ruiz', name: 'Lucia Ruiz', role: 'Staff Scientist', capacity: '32h/week', weight: 7 },
    { nick: 'chen', name: 'Wei Chen', role: 'PhD student', capacity: '30h/week', weight: 6 },
    { nick: 'novak', name: 'Petra Novak', role: 'PhD student', capacity: '30h/week', weight: 5 },
    { nick: 'adeyemi', name: 'Tobi Adeyemi', role: 'PhD student', capacity: '30h/week', weight: 4 },
    { nick: 'larsen', name: 'Erik Larsen', role: 'MS student', capacity: '20h/week', weight: 3 },
    { nick: 'patel', name: 'Asha Patel', role: 'Undergraduate', capacity: '10h/week', weight: 2 },
];
const assigneeWeights = PEOPLE.map(p => [p.nick, p.weight]);

const RESOURCES = [
    { id: 'res-xrd', name: 'XRD diffractometer', kind: 'instrument', capacity: '1', where: 'Doherty B210' },
    { id: 'res-sem', name: 'SEM', kind: 'instrument', capacity: '1', where: 'Hamerschlag 1112' },
    { id: 'res-glovebox', name: 'Glovebox', kind: 'instrument', capacity: '2', where: 'Doherty B204' },
    { id: 'res-cluster', name: 'GPU cluster allocation', kind: 'compute', capacity: '2000 GPUh/month', where: '' },
    { id: 'res-room-b', name: 'Conference room B', kind: 'room', capacity: '1', where: 'Doherty 3rd floor' },
];

// ---- Project templates ------------------------------------------------------------

const VERBS = ['Draft', 'Run', 'Analyze', 'Review', 'Prepare', 'Test', 'Calibrate', 'Collect', 'Model', 'Summarize', 'Validate', 'Plan'];
const PHASES = [
    { name: 'Planning', tag: 'planning', nouns: ['scope document', 'risk register', 'sample matrix', 'budget plan', 'kickoff agenda', 'data plan'] },
    { name: 'Synthesis', tag: 'lab', uses: ['res-glovebox'], nouns: ['precursor batch', 'catalyst series', 'thin films', 'doped samples', 'control samples', 'annealing run'] },
    { name: 'Characterization', tag: 'lab', uses: ['res-xrd', 'res-sem'], nouns: ['XRD patterns', 'SEM images', 'surface area data', 'phase purity check', 'particle size data', 'stability test'] },
    { name: 'Computation', tag: 'computation', uses: ['res-cluster'], nouns: ['DFT relaxations', 'ML potential', 'reaction network', 'free energy profile', 'surrogate model', 'sensitivity study'] },
    { name: 'Analysis', tag: 'analysis', nouns: ['kinetics fits', 'error budget', 'comparison plots', 'statistical tests', 'trend summary', 'outlier review'] },
    { name: 'Writing', tag: 'writing', uses: ['res-room-b'], nouns: ['methods section', 'results figures', 'introduction', 'SI document', 'cover letter', 'response to reviewers'] },
];
const PROJECTS = [
    { key: 'h2', title: 'Hydrogen Evolution Catalysts', lead: 'osei', phases: [0, 1, 2, 4, 5], offset: -60, files: 1 },
    { key: 'co2', title: 'CO2 Reduction Screening', lead: 'ruiz', phases: [0, 1, 2, 3, 4, 5], offset: -30, files: 2 },
    { key: 'mlpot', title: 'Machine-Learned Potentials', lead: 'chen', phases: [0, 3, 4, 5], offset: -45, files: 1 },
    { key: 'grant', title: 'NSF Renewal Proposal', lead: 'kim', phases: [0, 4, 5], offset: 0, files: 1 },
    { key: 'battery', title: 'Solid-State Battery Interfaces', lead: 'novak', phases: [0, 1, 2, 3, 4, 5], offset: 15, files: 2 },
    { key: 'course', title: 'Course Development: Data Science for Chemists', lead: 'kim', phases: [0, 5], offset: -10, files: 1 },
];

// ---- Build the tasks ------------------------------------------------------------------

const EFFORTS = [['2h', 3], ['4h', 5], ['1d', 6], ['2d', 5], ['3d', 3], ['5d', 2], ['0:30', 1], ['90m', 1]];
const effortDays = e => {
    let m;
    if ((m = e.match(/^(\d+)d$/))) return Number(m[1]);
    if ((m = e.match(/^(\d+)h$/))) return Number(m[1]) / 8;
    if ((m = e.match(/^(\d+)m$/))) return Number(m[1]) / 480;
    if ((m = e.match(/^(\d+):(\d+)$/))) return (Number(m[1]) * 60 + Number(m[2])) / 480;
    return 1;
};

/** All tasks, by project key; each task knows its phase and file. */
const projects = PROJECTS.map(p => ({ ...p, phaseList: [], tasks: [] }));
let milestoneCount = 0;

for (const proj of projects) {
    let cursor = addDays(START, proj.offset);
    let n = 0;
    let previousPhaseTasks = [];
    proj.phases.forEach((phaseIndex, pi) => {
        const tmpl = PHASES[phaseIndex];
        const phase = {
            id: `${proj.key}-ph${pi + 1}`, name: tmpl.name, tag: tmpl.tag,
            ordered: chance(0.25),
            file: proj.files > 1 && pi >= Math.ceil(proj.phases.length / 2) ? 1 : 0,
            tasks: [],
        };
        proj.phaseList.push(phase);
        const count = Math.round(int(8, 14) * scale);
        for (let i = 0; i < count; i++) {
            n++;
            const effort = weighted(EFFORTS);
            const assignees = [weighted(assigneeWeights)];
            if (chance(0.12)) {
                const second = weighted(assigneeWeights);
                if (second !== assignees[0]) assignees.push(second);
            }
            const deps = [];
            // Within the phase: depend on an earlier task in it (unless ORDERED does that).
            if (!phase.ordered && phase.tasks.length && chance(0.45)) deps.push(pick(phase.tasks).id);
            // On the previous phase: most first tasks wait on something there.
            if (previousPhaseTasks.length && (i < 3 || chance(0.15))) deps.push(pick(previousPhaseTasks).id);
            const task = {
                id: `${proj.key}-${n}`,
                title: `${pick(VERBS)} ${pick(tmpl.nouns)}${chance(0.3) ? ` ${int(2, 9)}` : ''}`,
                effort,
                assignees: assignees.map(a => (proj.key === 'grant' && a === 'patel' ? 'kim' : a)),
                deps: [...new Set(deps)],
                uses: tmpl.uses && chance(0.6) ? pick(tmpl.uses) : undefined,
                priority: chance(0.15) ? pick(['A', 'B', 'C']) : undefined,
                children: [],
                phase,
            };
            // A few tasks are split into subtasks.
            if (chance(0.12)) {
                const k = int(2, 4);
                for (let c = 1; c <= k; c++) {
                    task.children.push({
                        id: `${task.id}-${c}`,
                        title: `${task.title}: part ${c}`,
                        effort: weighted(EFFORTS.slice(0, 4)),
                        assignees: chance(0.7) ? [] : [weighted(assigneeWeights)],
                        deps: [], children: [], phase,
                    });
                }
                task.ordered = chance(0.5);
            }
            phase.tasks.push(task);
            proj.tasks.push(task);
        }
        // Lay the phase out in time: tasks start when their dependencies end.
        const ends = new Map();
        const phaseStart = cursor;
        let phaseEnd = phaseStart;
        let previous;
        for (const t of phase.tasks) {
            let s = phaseStart;
            const waits = [...t.deps];
            if (phase.ordered && previous) waits.push(previous.id);
            for (const d of waits) {
                const e = ends.get(d) ?? proj.ends?.get(d);
                if (e && e > s) s = e;
            }
            s = addWorkdays(s, chance(0.3) ? int(0, 3) : 0);
            const days = t.children.length ? t.children.reduce((a, c) => a + effortDays(c.effort), 0) : effortDays(t.effort);
            const e = addWorkdays(s, Math.max(1, days));
            t.start = s;
            t.end = e;
            ends.set(t.id, e);
            if (e > phaseEnd) phaseEnd = e;
            previous = t;
        }
        proj.ends = new Map([...(proj.ends ?? []), ...ends]);
        // A milestone closes each phase.
        milestoneCount++;
        phase.milestone = {
            id: `${proj.key}-ms${pi + 1}`, title: `${tmpl.name} complete`,
            deadline: addWorkdays(phaseEnd, 2), deps: phase.tasks.slice(-3).map(t => t.id),
        };
        previousPhaseTasks = phase.tasks;
        cursor = addWorkdays(phaseEnd, int(1, 5));
    });
}

// Cross-project dependencies: later work in one project waits on another's.
const CROSS = [
    ['mlpot', 'Computation', 'co2', 'Computation'],
    ['h2', 'Characterization', 'battery', 'Characterization'],
    ['grant', 'Writing', 'h2', 'Analysis'],
    ['grant', 'Writing', 'mlpot', 'Analysis'],
    ['grant', 'Writing', 'co2', 'Analysis'],
    ['co2', 'Analysis', 'mlpot', 'Writing'],
    ['course', 'Writing', 'mlpot', 'Computation'],
    ['battery', 'Planning', 'h2', 'Synthesis'],
];
const byKey = Object.fromEntries(projects.map(p => [p.key, p]));
const phaseNamed = (p, name) => byKey[p].phaseList.find(ph => ph.name === name);
const crossEdges = [];
for (const [fromP, fromPhase, toP, toPhase] of CROSS) {
    const from = phaseNamed(fromP, fromPhase);
    const to = phaseNamed(toP, toPhase);
    if (!from || !to) continue;
    const waiter = from.tasks[0];
    const target = pick(to.tasks);
    waiter.deps.push(target.id);
    crossEdges.push(`${waiter.id} → ${target.id}`);
}

// Deliberate trouble, documented in the README: a dependency cycle, a
// dependency on an id that does not exist, and a duplicated :ID:.
const cycleA = byKey.battery.phaseList[1].tasks[1];
const cycleB = byKey.battery.phaseList[1].tasks[3];
cycleA.deps.push(cycleB.id);
cycleB.deps.push(cycleA.id);
byKey.co2.phaseList[2].tasks[2].deps.push('co2-does-not-exist');
const duplicate = byKey.h2.phaseList[3].tasks[4];
duplicate.duplicateOf = byKey.h2.phaseList[3].tasks[0].id;

// ---- States from dates: the past is done, now is in progress -----------------------------

function stateFor(t) {
    if (t.end < START) return chance(0.88) ? 'DONE' : chance(0.5) ? 'CANCELLED' : 'TODO';
    if (t.start <= START) return chance(0.6) ? 'NEXT' : chance(0.5) ? 'WAIT' : 'TODO';
    return 'TODO';
}

// ---- Writing org ---------------------------------------------------------------------------

function clockLines(t, indent) {
    const lines = [];
    // Clocked time is 60-150% of the effort, in sessions of at most 6 hours,
    // on working days between the task's start and its end (or today).
    const total = Math.max(0.5, effortDays(t.effort) * 8 * (0.6 + rand() * 0.9));
    const sessions = Math.max(int(1, 3), Math.ceil(total / 6));
    const per = total / sessions;
    const last = t.end < START ? t.end : START;
    let day = t.start;
    for (let s = 0; s < sessions && day < last; s++) {
        const h = int(8, 13);
        const minutes = Math.round(per * 60);
        const end = new Date(day.getTime() + (h * 60 + minutes) * 60000);
        const endH = end.getHours();
        const endM = end.getMinutes();
        const sameDay = ymd(end) === ymd(day);
        const dur = `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
        lines.push(`${indent}CLOCK: ${inactiveTime(day, h, 0)}--${sameDay ? inactiveTime(day, endH, endM) : inactiveTime(end, endH, endM)} => ${dur.padStart(5)}`);
        day = addWorkdays(day, 1);
    }
    return lines;
}

function taskLines(t, level, proj) {
    const stars = '*'.repeat(level);
    const indent = ' '.repeat(level + 1);
    const state = t.state ?? (t.state = stateFor(t));
    const tags = [];
    if (t.atTag) tags.push(`@${t.atTag}`);
    const title = `${stars} ${state} ${t.priority ? `[#${t.priority}] ` : ''}${t.title}`;
    const out = [tags.length ? `${title.padEnd(70)} :${tags.join(':')}:` : title];
    const planning = [];
    if (state === 'DONE' || state === 'CANCELLED') planning.push(`CLOSED: ${inactive(t.end)}`);
    else if (chance(0.55)) planning.push(`SCHEDULED: ${active(t.start)}`);
    if (t.deadline || (state !== 'DONE' && chance(0.2))) planning.push(`DEADLINE: ${active(t.deadline ?? addWorkdays(t.end, int(0, 4)))}`);
    if (planning.length) out.push(indent + planning.join(' '));
    out.push(`${indent}:PROPERTIES:`);
    out.push(`${indent}:ID: ${t.duplicateOf ?? t.id}`);
    if (t.effort) out.push(`${indent}:EFFORT: ${t.effort}`);
    if (t.assignees?.length) out.push(`${indent}:ASSIGNEE: ${t.assignees.join(' ')}`);
    if (t.deps?.length) out.push(`${indent}:DEPENDS: ${t.deps.map(d => `id:${d}`).join(' ')}`);
    if (t.ordered) out.push(`${indent}:ORDERED: t`);
    if (t.uses) out.push(`${indent}:USES: id:${t.uses} ${pick(['2h', '4h', '1d'])}`);
    out.push(`${indent}:END:`);
    if (state === 'DONE' && chance(0.7)) {
        out.push(`${indent}:LOGBOOK:`, ...clockLines(t, indent), `${indent}:END:`);
    } else if ((state === 'NEXT' || state === 'WAIT') && chance(0.6)) {
        out.push(`${indent}:LOGBOOK:`, ...clockLines(t, indent), `${indent}:END:`);
    }
    if (chance(0.15)) out.push(`${indent}- ${inactive(t.start)} ${pick(['Waiting on the shared instrument.', 'Check with the group before starting.', 'See the notes from group meeting.', 'Reused the protocol from last year.'])}`);
    for (const c of t.children) {
        c.start = t.start;
        c.end = t.end;
        c.state = state === 'DONE' ? 'DONE' : state === 'CANCELLED' ? 'CANCELLED' : stateFor(c);
        out.push(...taskLines(c, level + 1, proj));
    }
    return out;
}

function projectFile(proj, fileIndex) {
    const lines = [];
    const part = fileIndex === 0 ? '' : ' (part 2)';
    lines.push(`#+TITLE: ${proj.title}${part}`);
    lines.push('#+TODO: TODO NEXT WAIT | DONE CANCELLED');
    lines.push(`#+FILETAGS: :${proj.key}:`);
    lines.push('');
    lines.push('# Generated by scripts/gen-stress-portfolio.cjs. Regenerate rather than edit.');
    lines.push('');
    lines.push(`* ${proj.title}${part}`);
    lines.push('  :PROPERTIES:');
    lines.push(`  :ID: proj-${proj.key}${fileIndex ? '-2' : ''}`);
    lines.push(`  :ASSIGNEE: ${proj.lead}`);
    lines.push('  :END:');
    for (const phase of proj.phaseList.filter(ph => ph.file === fileIndex)) {
        lines.push('');
        lines.push(`${`** ${phase.name}`.padEnd(70)} :${phase.tag}:`);
        if (phase.ordered) lines.push('   :PROPERTIES:', `   :ID: ${phase.id}`, '   :ORDERED: t', '   :END:');
        for (const t of phase.tasks) {
            if (chance(0.06)) t.atTag = weighted(assigneeWeights);
            lines.push(...taskLines(t, 3, proj));
        }
        const ms = phase.milestone;
        const msDone = ms.deadline < START && chance(0.9);
        lines.push(`${`*** ${msDone ? 'DONE' : 'TODO'} ${ms.title}`.padEnd(70)} :milestone:`);
        lines.push(`    ${msDone ? `CLOSED: ${inactive(ms.deadline)} ` : ''}DEADLINE: ${active(ms.deadline)}`);
        lines.push('    :PROPERTIES:', `    :ID: ${ms.id}`, `    :DEPENDS: ${ms.deps.map(d => `id:${d}`).join(' ')}`, '    :END:');
    }
    lines.push('');
    return lines.join('\n');
}

function peopleFile() {
    const lines = ['#+TITLE: Team', '', '# Generated by scripts/gen-stress-portfolio.cjs.', ''];
    PEOPLE.forEach((p, i) => {
        lines.push(`${`* ${p.name}`.padEnd(70)} :person:`);
        lines.push('  :PROPERTIES:', `  :ID: person-${p.nick}`, `  :NICK: ${p.nick}`, `  :ROLE: ${p.role}`,
            `  :EMAIL: ${p.nick}@example.edu`, `  :CAPACITY: ${p.capacity}`, '  :KIND: person', '  :END:');
        if (i % 3 === 1) {
            const from = addWorkdays(START, int(5, 40));
            const to = addWorkdays(from, int(3, 10));
            lines.push(`** Away`, `   ${active(from)}--${active(to)}`);
        }
        lines.push('');
    });
    return lines.join('\n');
}

function resourcesFile() {
    const lines = ['#+TITLE: Shared Resources', '', '# Generated by scripts/gen-stress-portfolio.cjs.', ''];
    for (const r of RESOURCES) {
        lines.push(`${`* ${r.name}`.padEnd(70)} :resource:`);
        lines.push('  :PROPERTIES:', `  :ID: ${r.id}`, `  :KIND: ${r.kind}`, `  :CAPACITY: ${r.capacity}`);
        if (r.where) lines.push(`  :LOCATION: ${r.where}`);
        lines.push('  :END:');
        if (r.id === 'res-xrd') {
            const from = addWorkdays(START, 12);
            lines.push('** Maintenance', `   ${active(from)}--${active(addWorkdays(from, 3))}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

// ---- Write everything ------------------------------------------------------------------------

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'people.org'), peopleFile());
fs.writeFileSync(path.join(outDir, 'resources.org'), resourcesFile());
let taskCount = 0;
for (const proj of projects) {
    const dir = path.join(outDir, proj.key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.projectile'), '');
    for (let f = 0; f < proj.files; f++) {
        fs.writeFileSync(path.join(dir, f === 0 ? 'project.org' : 'project-2.org'), projectFile(proj, f));
    }
    taskCount += proj.tasks.reduce((s, t) => s + 1 + t.children.length, 0);
}
const summary = {
    start: ymd(START), seed, scale,
    projects: projects.length, tasks: taskCount, milestones: milestoneCount,
    people: PEOPLE.length, resources: RESOURCES.length, crossProjectDependencies: crossEdges,
    deliberateProblems: {
        cycle: `${cycleA.id} ↔ ${cycleB.id}`,
        missingDependency: `${byKey.co2.phaseList[2].tasks[2].id} → co2-does-not-exist`,
        duplicateId: `${duplicate.id} reuses the :ID: ${duplicate.duplicateOf}`,
    },
};
fs.writeFileSync(path.join(outDir, 'portfolio.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
