// Agenda view webview: draws and filters the rows the extension sends.
//
// Messages in:  { type: 'model', title, range, paged, sections, error?, options, projects, customs }
//                { type: 'preview', id, outline, lines, location }
// Messages out: ready | refresh | options | open | cycleTodo | preview | close
//
// The extension chooses the rows (span, page, project, custom agenda; see
// agendaView.ts). The tag, file, state, priority, assignee, property and text
// filters are applied
// here, over every row sent, so the menus can list everything there is to
// filter by. Filter changes are still sent back, so they outlast the view.
// Each row carries data-vscode-context, which VS Code hands to the right-click
// menu commands declared under webview/context in package.json.
(function () {
    const vscode = acquireVsCodeApi();
    const VIEW = 'scimax.agendaView';
    const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

    let model = null;
    let options = { span: 'week', offset: 0 };
    /** The rows drawn, in order, for keyboard movement. */
    let shown = [];
    let selected = -1;
    let selectedKey = null;

    const $ = id => document.getElementById(id);
    const list = $('list');

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    const basename = f => f.split(/[\\/]/).pop();
    const rowKey = (row, group) => `${row.file}:${row.line}:${row.leader}:${group.key}`;

    function sendOptions() {
        vscode.postMessage({ type: 'options', options });
    }
    /** A filter changed: redraw here and remember it in the extension. */
    function filtersChanged() {
        render();
        sendOptions();
    }
    /** The span, page, project or custom agenda changed: the extension sends new rows. */
    function rowsChanged() {
        selected = -1;
        selectedKey = null;
        sendOptions();
    }

    // Filtering ----------------------------------------------------------------
    function allRows() {
        if (!model) return [];
        return model.sections.flatMap(s => s.groups.flatMap(g => g.rows));
    }

    function passes(row) {
        const o = options;
        if (o.includeTags && !o.includeTags.every(t => row.tags.includes(t))) return false;
        if (o.excludeTags && o.excludeTags.some(t => row.tags.includes(t))) return false;
        if (o.hiddenFiles && o.hiddenFiles.includes(row.file)) return false;
        if (o.hiddenStates && o.hiddenStates.includes(row.todo || '')) return false;
        if (o.hiddenPriorities && o.hiddenPriorities.includes(row.priority || '')) return false;
        if (o.assignees && !o.assignees.some(a => (a === '' ? row.assignees.length === 0 : row.assignees.includes(a)))) {
            return false;
        }
        if (o.properties) {
            for (const [key, values] of Object.entries(o.properties)) {
                if (!values.includes(row.properties[key] || '')) return false;
            }
        }
        const q = (o.search || '').trim().toLowerCase();
        if (q) {
            const text = [row.title, row.todo, row.category, basename(row.file), ...row.tags,
                ...row.assignees.map(a => '@' + a), ...Object.values(row.properties)].join(' ').toLowerCase();
            if (!q.split(/\s+/).every(word => text.includes(word))) return false;
        }
        return true;
    }

    function anyFilter() {
        const o = options;
        return !!(o.includeTags || o.excludeTags || o.hiddenFiles || o.hiddenStates || o.hiddenPriorities
            || o.assignees || o.properties
            || (o.search || '').trim());
    }

    /** Counts of each value of `pick` over every row, sorted by name. */
    function tally(pick) {
        const counts = new Map();
        for (const row of allRows()) {
            for (const v of [].concat(pick(row))) counts.set(v, (counts.get(v) || 0) + 1);
        }
        return counts;
    }

    // Menus ----------------------------------------------------------------------
    const MENUS = ['tags', 'files', 'states', 'priorities', 'assignees', 'properties'];

    function showMenu(name, show) {
        for (const m of MENUS) {
            const open = m === name && show;
            $(m + 'Menu').hidden = !open;
            $(m + 'Button').setAttribute('aria-expanded', String(open));
        }
    }
    for (const m of MENUS) {
        $(m + 'Button').addEventListener('click', e => {
            e.stopPropagation();
            showMenu(m, $(m + 'Menu').hidden);
        });
        $(m + 'Menu').addEventListener('click', e => e.stopPropagation());
    }
    document.addEventListener('click', () => showMenu(null, false));
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        const open = MENUS.find(m => !$(m + 'Menu').hidden);
        if (open) {
            showMenu(null, false);
            $(open + 'Button').focus();
            e.stopPropagation();
        }
    });

    function menuButtons(menu, buttons) {
        const bar = el('div', 'menuButtons');
        for (const [text, disabled, onClick] of buttons) {
            const b = el('button', 'clear', text);
            b.disabled = disabled;
            b.addEventListener('click', onClick);
            bar.appendChild(b);
        }
        menu.appendChild(bar);
    }

    function setList(name, values) {
        options[name] = values.length ? values : undefined;
        filtersChanged();
    }

    // A checklist where unchecked values are hidden (files, states, priorities).
    function fillChecklist(name, hiddenKey, counts, labelOf, buttonText) {
        const hidden = options[hiddenKey] || [];
        // Keep hidden values listed even with no rows now, so they can be checked again.
        const all = [...new Set([...counts.keys(), ...hidden])].sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
        const button = $(name + 'Button');
        button.textContent = buttonText(all, hidden);
        button.classList.toggle('active', hidden.length > 0);
        button.disabled = all.length < 2 && hidden.length === 0;

        const menu = $(name + 'Menu');
        menu.textContent = '';
        menuButtons(menu, [
            ['Show all', hidden.length === 0, () => setList(hiddenKey, [])],
            ['Hide all', hidden.length === all.length, () => setList(hiddenKey, all)],
        ]);
        for (const value of all) {
            const label = el('label');
            label.title = name === 'files' ? value : '';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = !hidden.includes(value);
            box.addEventListener('change', () => {
                const now = new Set(options[hiddenKey] || []);
                if (box.checked) now.delete(value); else now.add(value);
                setList(hiddenKey, all.filter(v => now.has(v)));
            });
            label.appendChild(box);
            label.appendChild(document.createTextNode(labelOf(value)));
            label.appendChild(el('span', 'count', String(counts.get(value) || 0)));
            menu.appendChild(label);
        }
    }

    function summary(prefix, all, hidden, labelOf) {
        const shownValues = all.filter(v => !hidden.includes(v));
        if (hidden.length === 0) return `${prefix}: all`;
        if (shownValues.length === 1) return `${prefix}: ${labelOf(shownValues[0])}`;
        return `${prefix}: ${shownValues.length} of ${all.length}`;
    }

    // Tags cycle: off -> required -> excluded -> off.
    function cycleTag(tag) {
        const inc = new Set(options.includeTags || []);
        const exc = new Set(options.excludeTags || []);
        if (inc.has(tag)) { inc.delete(tag); exc.add(tag); }
        else if (exc.has(tag)) exc.delete(tag);
        else inc.add(tag);
        options.includeTags = inc.size ? [...inc] : undefined;
        options.excludeTags = exc.size ? [...exc] : undefined;
        filtersChanged();
    }

    function fillTags() {
        const inc = options.includeTags || [];
        const exc = options.excludeTags || [];
        const counts = tally(r => r.tags);
        const all = [...new Set([...counts.keys(), ...inc, ...exc])].sort((a, b) => a.localeCompare(b));
        const chosen = [...inc.map(t => '+' + t), ...exc.map(t => '-' + t)];
        const button = $('tagsButton');
        button.textContent = chosen.length === 0 ? (all.length ? 'Tags: any' : 'Tags: none')
            : chosen.length <= 3 ? 'Tags: ' + chosen.join(' ')
            : `Tags: ${chosen.length} chosen`;
        button.classList.toggle('active', chosen.length > 0);
        button.disabled = all.length === 0;

        const menu = $('tagsMenu');
        menu.textContent = '';
        menuButtons(menu, [['Clear', chosen.length === 0, () => {
            options.includeTags = undefined;
            options.excludeTags = undefined;
            filtersChanged();
        }]]);
        menu.appendChild(el('div', 'hint muted', 'Click: require, exclude, clear'));
        for (const tag of all) {
            const state = inc.includes(tag) ? 'inc' : exc.includes(tag) ? 'exc' : '';
            const item = el('button', 'tagItem ' + state);
            item.setAttribute('role', 'menuitemcheckbox');
            item.setAttribute('aria-checked', state === 'inc' ? 'true' : state === 'exc' ? 'mixed' : 'false');
            item.title = state === 'inc' ? 'Required: click to exclude' : state === 'exc' ? 'Excluded: click to clear' : 'Click to require';
            item.appendChild(el('span', 'mark', state === 'inc' ? '+' : state === 'exc' ? '−' : ''));
            item.appendChild(document.createTextNode(tag));
            item.appendChild(el('span', 'count', String(counts.get(tag) || 0)));
            item.addEventListener('click', () => cycleTag(tag));
            menu.appendChild(item);
        }
    }

    // Assignees: checked people are shown; none checked shows everyone.
    const assigneeLabel = a => (a ? '@' + a : '(unassigned)');
    function toggleAssignee(handle) {
        const now = new Set(options.assignees || []);
        if (now.has(handle)) now.delete(handle); else now.add(handle);
        options.assignees = now.size ? [...now] : undefined;
        filtersChanged();
    }
    function fillAssignees() {
        const chosen = options.assignees || [];
        const counts = tally(r => (r.assignees.length ? r.assignees : ['']));
        const all = [...new Set([...counts.keys(), ...chosen])]
            .sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
        const button = $('assigneesButton');
        button.textContent = chosen.length === 0 ? 'Assignee: anyone'
            : chosen.length <= 2 ? 'Assignee: ' + chosen.map(assigneeLabel).join(', ')
            : `Assignee: ${chosen.length} people`;
        button.classList.toggle('active', chosen.length > 0);
        button.disabled = all.length < 2 && chosen.length === 0;

        const menu = $('assigneesMenu');
        menu.textContent = '';
        menuButtons(menu, [['Anyone', chosen.length === 0, () => { options.assignees = undefined; filtersChanged(); }]]);
        for (const handle of all) {
            const label = el('label');
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = chosen.includes(handle);
            box.addEventListener('change', () => toggleAssignee(handle));
            label.appendChild(box);
            label.appendChild(document.createTextNode(assigneeLabel(handle)));
            label.appendChild(el('span', 'count', String(counts.get(handle) || 0)));
            menu.appendChild(label);
        }
    }

    // Properties: one section per key; an item shows if, for every key with
    // checked values, its value is one of them. Keys with their own filter
    // (ASSIGNEE) or that are unique per heading (ID) are left out.
    const SKIP_PROPERTIES = new Set(['ID', 'CUSTOM_ID', 'ASSIGNEE']);
    const MAX_VALUES = 40;
    const openKeys = new Set();
    function setPropertyValue(key, value, on) {
        const props = { ...(options.properties || {}) };
        const now = new Set(props[key] || []);
        if (on) now.add(value); else now.delete(value);
        if (now.size) props[key] = [...now]; else delete props[key];
        options.properties = Object.keys(props).length ? props : undefined;
        filtersChanged();
    }
    function fillProperties() {
        const chosen = options.properties || {};
        const rows = allRows();
        const keys = new Set(Object.keys(chosen));
        for (const r of rows) for (const k of Object.keys(r.properties)) if (!SKIP_PROPERTIES.has(k)) keys.add(k);
        const picked = Object.entries(chosen).flatMap(([k, vs]) => vs.map(v => `${k}=${v || '(not set)'}`));
        const button = $('propertiesButton');
        button.textContent = picked.length === 0 ? (keys.size ? 'Properties: any' : 'Properties: none')
            : picked.length <= 2 ? 'Properties: ' + picked.join(', ')
            : `Properties: ${picked.length} chosen`;
        button.classList.toggle('active', picked.length > 0);
        button.disabled = keys.size === 0;

        const menu = $('propertiesMenu');
        menu.textContent = '';
        menuButtons(menu, [['Clear', picked.length === 0, () => { options.properties = undefined; filtersChanged(); }]]);
        for (const key of [...keys].sort()) {
            const counts = new Map();
            for (const r of rows) {
                const v = r.properties[key] || '';
                counts.set(v, (counts.get(v) || 0) + 1);
            }
            const want = chosen[key] || [];
            for (const v of want) if (!counts.has(v)) counts.set(v, 0);
            // Most common first; checked values always listed.
            const values = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
            const listed = [...new Set([...want, ...values.slice(0, MAX_VALUES)])];

            const section = el('details', 'propKey');
            section.open = openKeys.has(key) || want.length > 0;
            section.addEventListener('toggle', () => { if (section.open) openKeys.add(key); else openKeys.delete(key); });
            const summaryEl = el('summary', '', key);
            if (want.length) summaryEl.appendChild(el('span', 'count', `${want.length} checked`));
            section.appendChild(summaryEl);
            for (const value of listed) {
                const label = el('label');
                label.title = value;
                const box = document.createElement('input');
                box.type = 'checkbox';
                box.checked = want.includes(value);
                box.addEventListener('change', () => setPropertyValue(key, value, box.checked));
                label.appendChild(box);
                label.appendChild(document.createTextNode(value || '(not set)'));
                label.appendChild(el('span', 'count', String(counts.get(value))));
                section.appendChild(label);
            }
            if (values.length > listed.length) {
                section.appendChild(el('div', 'hint muted', `${values.length - listed.length} more values: type one in the filter box`));
            }
            menu.appendChild(section);
        }
    }

    function fillMenus() {
        fillAssignees();
        fillProperties();
        fillTags();
        const fileLabel = f => basename(f);
        fillChecklist('files', 'hiddenFiles', tally(r => r.file), fileLabel,
            (all, hidden) => summary('Files', all, hidden, fileLabel));
        const stateLabel = s => s || '(no keyword)';
        fillChecklist('states', 'hiddenStates', tally(r => r.todo || ''), stateLabel,
            (all, hidden) => summary('States', all, hidden, stateLabel));
        const prioLabel = p => (p ? `#${p}` : '(none)');
        fillChecklist('priorities', 'hiddenPriorities', tally(r => r.priority || ''), prioLabel,
            (all, hidden) => summary('Priority', all, hidden, prioLabel));
        $('clearFilters').disabled = !anyFilter();
    }

    // Toolbar ----------------------------------------------------------------------
    function setSpan(span) {
        options.span = span;
        options.custom = undefined;
        options.offset = 0;
        rowsChanged();
    }
    for (const b of document.querySelectorAll('[data-span]')) {
        b.addEventListener('click', () => setSpan(b.dataset.span));
    }
    $('custom').addEventListener('change', e => {
        options.custom = e.target.value === '' ? undefined : e.target.value;
        options.offset = 0;
        rowsChanged();
    });
    $('project').addEventListener('change', e => {
        options.project = e.target.value || undefined;
        rowsChanged();
    });
    function page(delta) {
        if (!model || !model.paged) return;
        options.offset = delta === 0 ? 0 : (options.offset || 0) + delta;
        rowsChanged();
    }
    $('prev').addEventListener('click', () => page(-1));
    $('next').addEventListener('click', () => page(1));
    $('today').addEventListener('click', () => page(0));
    $('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    let searchTimer;
    $('search').addEventListener('input', e => {
        options.search = e.target.value || undefined;
        render();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(sendOptions, 400);
    });
    $('search').addEventListener('keydown', e => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowDown') {
            list.focus();
            if (e.key === 'ArrowDown' && selected < 0) select(0);
            e.preventDefault();
            e.stopPropagation();
        }
    });
    $('clearFilters').addEventListener('click', () => {
        for (const k of ['includeTags', 'excludeTags', 'hiddenFiles', 'hiddenStates', 'hiddenPriorities',
            'assignees', 'properties', 'search']) {
            options[k] = undefined;
        }
        $('search').value = '';
        filtersChanged();
    });

    function fillToolbar() {
        for (const b of document.querySelectorAll('[data-span]')) {
            const on = options.custom === undefined && b.dataset.span === options.span;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
        }
        const custom = $('custom');
        custom.textContent = '';
        custom.appendChild(new Option('(none)', ''));
        for (const c of model.customs) custom.appendChild(new Option(`${c.key}: ${c.description}`, c.key));
        if (options.custom !== undefined && !model.customs.some(c => c.key === options.custom)) {
            custom.appendChild(new Option(options.custom, options.custom));
        }
        custom.value = options.custom === undefined ? '' : options.custom;
        custom.disabled = model.customs.length === 0 && options.custom === undefined;
        custom.title = custom.disabled ? 'No custom agendas: add them in scimax.agenda.customCommands' : 'A custom agenda from scimax.agenda.customCommands';

        const project = $('project');
        project.textContent = '';
        project.appendChild(new Option('All agenda files', ''));
        for (const p of model.projects) {
            const o = new Option(p.name, p.path);
            o.title = p.path;
            project.appendChild(o);
        }
        project.value = options.project || '';

        for (const id of ['prev', 'today', 'next']) $(id).disabled = !model.paged;
        if (document.activeElement !== $('search')) $('search').value = options.search || '';
    }

    // Drawing ---------------------------------------------------------------------
    function drawRow(row, group) {
        const r = el('div', 'row');
        r.setAttribute('role', 'option');
        r.dataset.index = String(shown.length);
        if (row.done) r.classList.add('done');
        if (row.blocked) r.classList.add('blocked');
        r.setAttribute('data-vscode-context', JSON.stringify({
            webviewSection: 'task',
            view: VIEW,
            filePath: row.file,
            line: row.line,
            planning: row.planning,
            preventDefaultContextMenuItems: true,
        }));

        r.appendChild(el('span', 'category', row.category || basename(row.file).replace(/\.org$/, '')));
        r.appendChild(el('span', 'time', row.time || ''));
        r.appendChild(el('span', 'leader' + (row.overdue ? ' overdue' : ''), row.leader));
        const main = el('span', 'main');
        if (row.todo) main.appendChild(el('span', 'todo' + (row.done ? ' isDone' : ''), row.todo));
        if (row.priority) main.appendChild(el('span', 'priority p' + row.priority, `[#${row.priority}]`));
        main.appendChild(el('span', 'title', row.title));
        r.appendChild(main);

        const tags = el('span', 'tags');
        for (const handle of row.assignees) {
            const on = (options.assignees || []).includes(handle) ? ' inc' : '';
            const a = el('span', 'tag assignee' + on, '@' + handle);
            a.title = on ? 'Stop filtering by this person' : 'Show only items assigned to this person';
            a.addEventListener('click', e => { e.stopPropagation(); toggleAssignee(handle); });
            tags.appendChild(a);
        }
        for (const tag of row.tags) {
            const state = (options.includeTags || []).includes(tag) ? ' inc' : '';
            const t = el('span', 'tag' + state, tag);
            t.title = 'Show only items with this tag (click again to exclude it)';
            t.addEventListener('click', e => { e.stopPropagation(); cycleTag(tag); });
            tags.appendChild(t);
        }
        r.appendChild(tags);

        shown.push({ row, key: rowKey(row, group) });
        return r;
    }

    function render() {
        if (!model) return;
        fillMenus();
        list.textContent = '';
        shown = [];
        if (model.error) {
            list.appendChild(el('pre', 'error', model.error));
            $('count').textContent = '';
            return;
        }
        const total = allRows().length;
        // Empty days show (dimmed) in the shorter spans, as in org-agenda.
        const emptyDays = options.custom === undefined && options.span !== 'month' && !anyFilter();
        for (const section of model.sections) {
            const block = el('section', 'block');
            if (section.header) block.appendChild(el('h2', 'blockHeader', section.header));
            let drawn = 0;
            for (const group of section.groups) {
                const rows = group.rows.filter(passes);
                const isDay = DATE_KEY.test(group.key);
                if (rows.length === 0 && !(isDay && emptyDays)) continue;
                const g = el('div', 'group' + (group.today ? ' today' : '') + (rows.length ? '' : ' empty'));
                g.appendChild(el('h3', 'groupLabel', group.label));
                for (const row of rows) g.appendChild(drawRow(row, group));
                block.appendChild(g);
                drawn += rows.length;
            }
            if (section.header && drawn === 0) block.appendChild(el('div', 'none muted', 'Nothing here.'));
            list.appendChild(block);
        }
        if (shown.length === 0 && !model.sections.some(s => s.header)) {
            list.appendChild(el('div', 'none muted', total ? 'No items match the filters.' : 'Nothing on the agenda.'));
        }
        $('count').textContent = shown.length === total ? `${total} items` : `${shown.length} of ${total} items`;

        // Keep the selection on the same item across redraws.
        const again = selectedKey ? shown.findIndex(s => s.key === selectedKey) : -1;
        select(again >= 0 ? again : Math.min(selected, shown.length - 1), false);
    }

    // Interaction ---------------------------------------------------------------
    function rowElement(index) {
        return list.querySelector(`.row[data-index="${index}"]`);
    }
    function select(index, scroll = true) {
        for (const r of list.querySelectorAll('.row.selected')) {
            r.classList.remove('selected');
            r.removeAttribute('aria-selected');
        }
        selected = index;
        selectedKey = index >= 0 && shown[index] ? shown[index].key : null;
        const r = rowElement(index);
        if (r) {
            r.classList.add('selected');
            r.setAttribute('aria-selected', 'true');
            if (scroll) r.scrollIntoView({ block: 'nearest' });
        }
    }
    function current() {
        return selected >= 0 && shown[selected] ? shown[selected].row : null;
    }
    function openSelected() {
        const row = current();
        if (row) vscode.postMessage({ type: 'open', filePath: row.file, line: row.line });
    }
    function indexOf(target) {
        const r = target.closest && target.closest('.row');
        return r ? Number(r.dataset.index) : -1;
    }

    // Tooltips: the heading's context from its file (the headings above it
    // and the start of its entry), asked for on hover or Space and kept until
    // the next reload.
    const previewBox = $('preview');
    const previewCache = new Map();
    let previewTimer;
    let previewTarget = null;
    let nextPreviewId = 1;
    const PREVIEW_DELAY = 400;

    function hidePreview() {
        clearTimeout(previewTimer);
        previewTarget = null;
        previewBox.hidden = true;
    }
    function showPreview(index, anchor) {
        const entry = shown[index];
        if (!entry || !anchor) return;
        const key = `${entry.row.file}:${entry.row.line}`;
        previewTarget = { key, anchor, row: entry.row, id: nextPreviewId++ };
        const cached = previewCache.get(key);
        if (cached) drawPreview(cached);
        else vscode.postMessage({ type: 'preview', id: previewTarget.id, filePath: entry.row.file, line: entry.row.line });
    }
    function drawPreview(data) {
        const { row, anchor } = previewTarget;
        previewBox.textContent = '';
        if (data.outline.length) previewBox.appendChild(el('div', 'outline', data.outline.join(' › ')));
        const body = el('div', 'entry');
        data.lines.forEach((text, i) => body.appendChild(el('div', i === 0 ? 'heading' : 'line', text || ' ')));
        if (data.lines.length === 0) body.appendChild(el('div', 'line muted', 'The heading could not be read.'));
        previewBox.appendChild(body);
        const notes = [];
        if (row.blocked) notes.push('Blocked: a dependency is not done yet');
        if (row.assignees.length) notes.push('Assigned to ' + row.assignees.map(a => '@' + a).join(', '));
        for (const n of notes) previewBox.appendChild(el('div', 'note', n));
        previewBox.appendChild(el('div', 'location muted', data.location));
        previewBox.hidden = false;

        // Below the row, or above it when there is no room; inside the window.
        const r = anchor.getBoundingClientRect();
        const box = previewBox.getBoundingClientRect();
        const below = r.bottom + 4;
        const top = below + box.height > window.innerHeight && r.top - box.height - 4 > 0 ? r.top - box.height - 4 : below;
        const title = anchor.querySelector('.main');
        const left = Math.max(4, Math.min((title ? title.getBoundingClientRect().left : r.left), window.innerWidth - box.width - 8));
        previewBox.style.top = `${Math.max(4, top)}px`;
        previewBox.style.left = `${left}px`;
    }

    list.addEventListener('mouseover', e => {
        const r = e.target.closest && e.target.closest('.row');
        if (!r) return;
        if (previewTarget && previewTarget.anchor === r) return;
        hidePreview();
        previewTimer = setTimeout(() => showPreview(Number(r.dataset.index), r), PREVIEW_DELAY);
    });
    list.addEventListener('mouseleave', hidePreview);
    list.addEventListener('scroll', hidePreview);
    window.addEventListener('blur', hidePreview);

    list.addEventListener('click', e => {
        hidePreview();
        const i = indexOf(e.target);
        if (i < 0) return;
        select(i);
        list.focus();
        openSelected();
    });
    // Select on right-click too, so the highlighted row is the one the menu acts on.
    list.addEventListener('contextmenu', e => {
        hidePreview();
        const i = indexOf(e.target);
        if (i >= 0) select(i);
    });

    const MOVE = { ArrowDown: 1, ArrowUp: -1, n: 1, p: -1, j: 1, k: -1 };
    list.addEventListener('keydown', e => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const wasShowing = !previewBox.hidden;
        hidePreview();
        if (e.key === ' ') {
            // Space toggles the selected item's tooltip.
            if (!wasShowing && selected >= 0) showPreview(selected, rowElement(selected));
        } else if (e.key === 'Escape' && wasShowing) {
            // Just closes the tooltip.
        } else if (e.key in MOVE) {
            const next = selected < 0 ? 0 : selected + MOVE[e.key];
            if (next >= 0 && next < shown.length) select(next);
        } else if (e.key === 'Home') {
            if (shown.length) select(0);
        } else if (e.key === 'End') {
            if (shown.length) select(shown.length - 1);
        } else if (e.key === 'Enter') {
            openSelected();
        } else if (e.key === 't') {
            const row = current();
            if (row) vscode.postMessage({ type: 'cycleTodo', filePath: row.file, line: row.line });
        } else {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
    });

    // Keys that work anywhere but in a text field or a menu.
    const SPAN_KEYS = { d: 'day', w: 'week', m: 'month' };
    document.addEventListener('keydown', e => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const t = e.target;
        if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement) return;
        if (MENUS.some(m => !$(m + 'Menu').hidden)) return;
        if (e.key === 'f') page(1);
        else if (e.key === 'b') page(-1);
        else if (e.key === '.') page(0);
        else if (e.key === 'g' || e.key === 'r') vscode.postMessage({ type: 'refresh' });
        else if (e.key === '/') $('search').focus();
        else if (e.key === 'q') vscode.postMessage({ type: 'close' });
        else if (e.key in SPAN_KEYS) setSpan(SPAN_KEYS[e.key]);
        else return;
        e.preventDefault();
    });

    // Coming back from an action in the source file: keys go to the list again.
    window.addEventListener('focus', () => {
        if (document.activeElement === document.body) list.focus();
    });

    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'preview') {
            if (!previewTarget || msg.id !== previewTarget.id) return;
            previewCache.set(previewTarget.key, msg);
            drawPreview(msg);
            return;
        }
        if (msg.type !== 'model') return;
        // The files may have changed: ask again for every tooltip.
        previewCache.clear();
        hidePreview();
        model = msg;
        options = msg.options;
        $('title').textContent = msg.title;
        $('range').textContent = msg.range;
        fillToolbar();
        render();
    });

    list.focus();
    vscode.postMessage({ type: 'ready' });
})();
