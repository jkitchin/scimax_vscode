// Team view webview: a person x week grid of planned hours against capacity.
// The model comes from src/org/teamModel.ts; options go back to the extension.
(function () {
    'use strict';
    const vscode = acquireVsCodeApi();
    const $ = id => document.getElementById(id);
    const grid = $('grid');
    const details = $('details');

    let model = null;
    let options = null;
    let folders = [];
    const expanded = new Set(vscode.getState()?.expanded ?? []);
    let selected = null; // { handle, week } for the details pane

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    const DAY_MS = 86400000;
    function parseDay(s) {
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    function isoDay(d) {
        return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    }
    function shiftWeeks(s, n) {
        const d = parseDay(s);
        return isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * n));
    }
    function weekLabel(s) {
        return parseDay(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    const fmt = h => (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10).toString();

    function send(type, extra) {
        vscode.postMessage(Object.assign({ type }, extra));
    }
    function setOptions(patch) {
        options = Object.assign({}, options, patch);
        send('options', { options });
    }
    function saveState() {
        vscode.setState({ expanded: [...expanded] });
    }

    /** The ratio's class: free, busy, over, or none without a capacity. */
    function loadClass(load, capacity) {
        if (capacity === undefined || capacity === null) return load > 0 ? 'unknown' : '';
        if (capacity <= 0) return load > 0 ? 'over' : '';
        const r = load / capacity;
        return r > 1.0001 ? 'over' : r >= 0.8 ? 'busy' : load > 0 ? 'free' : '';
    }

    function cellText(load, capacity) {
        if (options.unit === 'percent' && capacity) return `${Math.round((100 * load) / capacity)}%`;
        return load ? fmt(load) : '';
    }

    // ---- Rendering ------------------------------------------------------------

    function render() {
        if (!model) return;
        grid.replaceChildren();
        const cols = model.weeks.length;
        grid.style.gridTemplateColumns = `minmax(14em, 18em) 5em repeat(${cols}, minmax(3.2em, 1fr)) 5em`;

        // Header row.
        grid.appendChild(el('div', 'head name', 'Person'));
        const od = el('div', 'head num', 'Overdue');
        od.title = 'Unfinished work scheduled before the first week';
        grid.appendChild(od);
        for (const w of model.weeks) {
            const h = el('div', 'head num', weekLabel(w));
            h.title = `Week of ${w}`;
            const end = shiftWeeks(w, 1);
            if (model.today >= w && model.today < end) h.classList.add('now');
            grid.appendChild(h);
        }
        const later = el('div', 'head num', 'Later');
        later.title = 'Work scheduled after the last week';
        grid.appendChild(later);

        for (const row of model.rows) renderRow(row, cols);
        $('status').textContent = `${model.rows.length} people, ${model.taskCount} open tasks`;
        renderDetails();
    }

    function renderRow(row, cols) {
        const open = expanded.has(row.handle);
        const name = el('div', 'name person' + (row.unknown ? ' unknown' : ''));
        const twisty = el('span', 'twisty', row.tasks.length ? (open ? '▾' : '▸') : ' ');
        name.appendChild(twisty);
        const label = el('span', 'label', row.name);
        name.appendChild(label);
        const meta = [];
        if (row.role) meta.push(row.role);
        if (row.capacityPerWeek !== undefined && row.capacityPerWeek !== null) meta.push(`${fmt(row.capacityPerWeek)}h/wk`);
        else if (!row.unknown) meta.push('no capacity');
        if (row.unknown && row.handle !== '(unassigned)') meta.push('no :person: heading');
        if (meta.length) name.appendChild(el('span', 'meta', meta.join(' · ')));
        name.title = `${row.handle}: ${row.tasks.length} open task(s) in ${row.projects.join(', ') || 'no project'}` +
            (row.unestimated ? `; ${row.unestimated} without an effort` : '');
        name.addEventListener('click', () => {
            if (!row.tasks.length) return;
            if (open) expanded.delete(row.handle); else expanded.add(row.handle);
            saveState();
            render();
        });
        name.addEventListener('dblclick', () => {
            if (row.filePath) send('open', { filePath: row.filePath, line: row.line });
        });
        grid.appendChild(name);

        const overdue = el('div', 'num overdue' + (row.overdue > 0 ? ' late' : ''), row.overdue ? fmt(row.overdue) : '');
        overdue.addEventListener('click', () => select(row.handle, 'overdue'));
        grid.appendChild(overdue);

        row.load.forEach((load, i) => {
            const cap = row.capacity[i];
            const cell = el('div', 'num cell ' + loadClass(load, cap), cellText(load, cap));
            if (row.awayDays[i]) cell.classList.add('away');
            const parts = [`${fmt(load)}h planned`];
            if (cap !== undefined && cap !== null) parts.push(`of ${fmt(cap)}h capacity`);
            if (row.awayDays[i]) parts.push(`away ${row.awayDays[i]} day(s)`);
            cell.title = `Week of ${model.weeks[i]}: ${parts.join(', ')}`;
            if (selected && selected.handle === row.handle && selected.week === i) cell.classList.add('selected');
            cell.addEventListener('click', () => select(row.handle, i));
            grid.appendChild(cell);
        });
        const laterCell = el('div', 'num later', row.later ? fmt(row.later) : '');
        laterCell.addEventListener('click', () => select(row.handle, 'later'));
        grid.appendChild(laterCell);

        if (!open) return;
        // The person's tasks, grouped by project, with their hours per week.
        const byProject = new Map();
        for (const t of row.tasks) {
            if (!byProject.has(t.project)) byProject.set(t.project, []);
            byProject.get(t.project).push(t);
        }
        for (const [project, tasks] of byProject) {
            const head = el('div', 'project', project);
            head.style.gridColumn = `1 / span ${cols + 3}`;
            grid.appendChild(head);
            for (const t of tasks) renderTask(t);
        }
    }

    function renderTask(t) {
        const name = el('div', 'name task' + (t.blocked ? ' blocked' : ''));
        if (t.todo) name.appendChild(el('span', 'todo', t.todo));
        name.appendChild(el('span', 'label', t.title));
        name.title = `${t.title}\n${t.start} to ${t.end}${t.deadline ? `, due ${t.deadline}` : ''}` +
            `\n${fmt(t.hours)}h for this person${t.with.length ? `, shared with ${t.with.join(', ')}` : ''}` +
            (t.blocked ? '\nBlocked: waits on unfinished work' : '') + '\nDouble-click to open';
        name.addEventListener('dblclick', () => send('open', { filePath: t.file, line: t.line }));
        grid.appendChild(name);
        grid.appendChild(el('div', 'num sub overdue' + (t.overdue ? ' late' : ''), t.overdue ? fmt(t.overdue) : ''));
        for (const h of t.weeks) {
            const c = el('div', 'num sub' + (h ? ' has' : ''), h ? fmt(h) : '');
            grid.appendChild(c);
        }
        grid.appendChild(el('div', 'num sub later', t.later ? fmt(t.later) : ''));
    }

    // ---- The details pane: the tasks behind one cell -------------------------------

    function select(handle, week) {
        selected = selected && selected.handle === handle && selected.week === week ? null : { handle, week };
        render();
    }

    function renderDetails() {
        const row = selected && model.rows.find(r => r.handle === selected.handle);
        if (!row) {
            details.hidden = true;
            return;
        }
        const w = selected.week;
        const hoursOf = t => (w === 'overdue' ? t.overdue : w === 'later' ? t.later : t.weeks[w]);
        const tasks = row.tasks.filter(t => hoursOf(t) > 0).sort((a, b) => hoursOf(b) - hoursOf(a));
        details.replaceChildren();
        const when = w === 'overdue' ? 'overdue work' : w === 'later' ? 'later work' : `the week of ${model.weeks[w]}`;
        const total = tasks.reduce((s, t) => s + hoursOf(t), 0);
        const title = el('div', 'detailsTitle', `${row.name}: ${when}, ${fmt(total)}h in ${tasks.length} task(s)`);
        const close = el('button', 'close', '×');
        close.title = 'Close';
        close.addEventListener('click', () => { selected = null; render(); });
        title.appendChild(close);
        details.appendChild(title);
        if (typeof w === 'number' && row.capacity[w] !== undefined && row.capacity[w] !== null) {
            const cap = row.capacity[w];
            details.appendChild(el('div', 'detailsMeta',
                `Capacity ${fmt(cap)}h${row.awayDays[w] ? ` (away ${row.awayDays[w]} day(s))` : ''}; ` +
                (total > cap ? `${fmt(total - cap)}h over.` : `${fmt(cap - total)}h free.`)));
        }
        const list = el('ul', 'detailsList');
        for (const t of tasks) {
            const li = el('li', t.blocked ? 'blocked' : '');
            li.appendChild(el('span', 'hours', `${fmt(hoursOf(t))}h`));
            li.appendChild(el('span', 'project', t.project));
            li.appendChild(el('span', 'label', `${t.todo ? t.todo + ' ' : ''}${t.title}`));
            li.appendChild(el('span', 'meta', `${t.start} to ${t.end}${t.deadline ? `, due ${t.deadline}` : ''}${t.blocked ? ', blocked' : ''}`));
            li.title = 'Double-click to open';
            li.addEventListener('dblclick', () => send('open', { filePath: t.file, line: t.line }));
            list.appendChild(li);
        }
        details.appendChild(list);
        details.hidden = false;
    }

    // ---- Toolbar ----------------------------------------------------------------------

    function syncToolbar() {
        $('weeks').value = String(options.weeks);
        $('unit').value = options.unit;
        const scope = $('scope');
        scope.replaceChildren();
        scope.appendChild(new Option('Everything indexed', ''));
        for (const f of folders) scope.appendChild(new Option(f.name, f.path));
        scope.value = options.scope;
        const chosen = options.projects.length;
        $('projectsButton').textContent = chosen ? `Projects: ${chosen} of ${model.projects.length}` : 'Projects: all';
    }

    function buildProjectsMenu() {
        const menu = $('projectsMenu');
        menu.replaceChildren();
        const chosen = new Set(options.projects);
        for (const p of model.projects) {
            const label = el('label');
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = chosen.has(p);
            box.addEventListener('change', () => {
                if (box.checked) chosen.add(p); else chosen.delete(p);
                setOptions({ projects: [...chosen] });
            });
            label.appendChild(box);
            label.appendChild(document.createTextNode(' ' + p));
            menu.appendChild(label);
        }
        const all = el('button', '', 'All projects');
        all.addEventListener('click', () => { setOptions({ projects: [] }); menu.hidden = true; });
        menu.appendChild(all);
    }

    $('projectsButton').addEventListener('click', e => {
        e.stopPropagation();
        const menu = $('projectsMenu');
        if (menu.hidden) buildProjectsMenu();
        menu.hidden = !menu.hidden;
    });
    $('projectsMenu').addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => { $('projectsMenu').hidden = true; });

    $('prev').addEventListener('click', () => setOptions({ start: shiftWeeks(model.weeks[0], -Math.max(1, Math.floor(options.weeks / 2))) }));
    $('next').addEventListener('click', () => setOptions({ start: shiftWeeks(model.weeks[0], Math.max(1, Math.floor(options.weeks / 2))) }));
    $('today').addEventListener('click', () => setOptions({ start: '' }));
    $('weeks').addEventListener('change', e => setOptions({ weeks: Number(e.target.value) }));
    $('unit').addEventListener('change', e => setOptions({ unit: e.target.value }));
    $('scope').addEventListener('change', e => setOptions({ scope: e.target.value, projects: [] }));
    $('refresh').addEventListener('click', () => send('refresh'));
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && selected) { selected = null; render(); }
    });

    window.addEventListener('message', event => {
        const m = event.data;
        if (m.type !== 'model') return;
        model = m.model;
        options = m.options;
        folders = m.folders || [];
        if (selected && !model.rows.some(r => r.handle === selected.handle)) selected = null;
        syncToolbar();
        render();
    });

    send('ready');
})();
