// Project view webview: draws the Gantt rows the extension sends.
//
// Messages in:  { type: 'model', model, options, project, taskCount, undo?, redo? }
// Messages out: ready | refresh | options | open | export | move | undo | redo
//
// The extension owns filtering and layout (projectGantt.ts), so the chart and
// its exports agree; this script only draws, scrolls, zooms and lets bars be
// dragged (the extension edits the dates and sends a new model). Each task row
// carries data-vscode-context, which is what VS Code hands to the right-click
// menu commands declared under webview/context in package.json.
(function () {
    const vscode = acquireVsCodeApi();
    const ROW_H = 26;
    const LABEL_W = 360;
    const HEADER_H = 40;
    const DAY_MS = 86400000;

    const saved = vscode.getState() || {};
    let dayW = saved.dayW || 18;
    // Fit: size the days so the whole date range fits the panel's width.
    let fit = !!saved.fit;
    let model = null;
    let options = { showDone: false, groupBy: 'none' };
    let selected = -1;
    let scrolledToToday = false;

    const $ = id => document.getElementById(id);
    const chart = $('chart');

    function parseDay(s) {
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    function days(a, b) {
        return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
            Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);
    }
    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    const SVG = 'http://www.w3.org/2000/svg';
    function svg(tag, attrs) {
        const e = document.createElementNS(SVG, tag);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        return e;
    }
    function addDays(s, n) {
        const d = parseDay(s);
        d.setDate(d.getDate() + n);
        return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    }
    function shortDay(s) {
        return parseDay(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }
    function hours(min) {
        if (!min) return '';
        const h = min / 60;
        return h >= 8 && h % 8 === 0 ? `${h / 8}d` : `${Math.round(h * 10) / 10}h`;
    }

    function sendOptions() {
        vscode.postMessage({ type: 'options', options });
    }

    function toggleFold(row) {
        const now = new Set(options.collapsed || []);
        if (now.has(row.key)) now.delete(row.key); else now.add(row.key);
        options.collapsed = now.size ? [...now] : undefined;
        sendOptions();
    }

    // Select the next (step 1) or previous (-1) row behind schedule, wrapping.
    function nextBehind(step) {
        if (!model) return;
        const n = model.rows.length;
        for (let k = 1; k <= n; k++) {
            const base = selected < 0 ? (step > 0 ? -1 : 0) : selected;
            const i = (((base + step * k) % n) + n) % n;
            if (model.rows[i].behind) {
                select(i);
                scrollToBar(i);
                return;
            }
        }
    }

    // Bring a row's bar into view horizontally.
    function scrollToBar(index) {
        const row = model.rows[index];
        if (!row || !row.start) return;
        const x = days(parseDay(model.start), parseDay(row.start)) * dayW;
        const view = chart.clientWidth - LABEL_W;
        if (x < chart.scrollLeft || x > chart.scrollLeft + view - 40) {
            chart.scrollTo({ left: Math.max(0, x - view / 3), behavior: 'smooth' });
        }
    }

    function percentText(p) {
        return `${Math.round(p.percent)}%`;
    }

    function progressTip(p) {
        if (!p) return '';
        const lines = [];
        if (p.method === 'own') lines.push(`${percentText(p)} done (:PROGRESS:)`);
        else {
            lines.push(`${percentText(p)} done by ${p.method === 'effort' ? 'effort' : 'task count'}: ${p.done} of ${p.tasks} task${p.tasks === 1 ? '' : 's'} done`);
            if (p.unestimated) lines.push(`${p.unestimated} without an effort, counted at the default effort`);
        }
        lines.push(`${Math.round(p.expected)}% of the time has passed`);
        return lines.join('\n');
    }

    // The label's fold triangle (or a spacer, to keep an outline aligned).
    function addFold(label, row) {
        if (row.collapsible) {
            const t = el('span', 'fold', row.collapsed ? '▸' : '▾');
            t.title = row.collapsed ? 'Expand' : 'Collapse';
            t.addEventListener('click', e => { e.stopPropagation(); toggleFold(row); });
            t.addEventListener('dblclick', e => e.stopPropagation());
            label.appendChild(t);
        } else if (options.groupBy === 'outline' || row.collapsed) {
            label.appendChild(el('span', 'fold' + (row.collapsed ? ' closed' : ''), row.collapsed ? '▸' : ''));
        }
    }

    function indent(label, row) {
        if (options.groupBy === 'outline') label.style.paddingLeft = `${8 + Math.max(0, row.depth - 1) * 14}px`;
    }

    // Hatch the done share of a bar, label it, and draw the behind band from
    // the end of the hatch to today, under the bar.
    function addProgress(r, bar, row, x1, x2, todayX) {
        const p = row.progress;
        if (!p) return;
        const w = Math.max(0, x2 - x1);
        const fill = el('div', 'fill');
        fill.style.width = `${Math.min(100, p.percent)}%`;
        if (p.percent > 0 && p.percent < 100) fill.classList.add('partial');
        bar.appendChild(fill);
        const pct = el('div', 'pct', percentText(p));
        pct.style.left = `${LABEL_W + x2 + 4}px`;
        r.appendChild(pct);
        if (row.behind) {
            const from = x1 + (w * Math.min(100, p.percent)) / 100;
            const band = el('div', 'behind-band');
            band.style.left = `${LABEL_W + from}px`;
            band.style.width = `${Math.max(2, Math.min(todayX, x2) - from)}px`;
            r.appendChild(band);
        }
    }

    // Toolbar ---------------------------------------------------------------
    $('assignee').addEventListener('change', e => {
        const v = e.target.value;
        options.assignee = v === '*' ? undefined : v;
        sendOptions();
    });
    $('tagsButton').addEventListener('click', e => {
        e.stopPropagation();
        showTagsMenu($('tagsMenu').hidden);
    });
    $('tagsMenu').addEventListener('click', e => e.stopPropagation());
    $('filesButton').addEventListener('click', e => {
        e.stopPropagation();
        showFilesMenu($('filesMenu').hidden);
    });
    $('filesMenu').addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => { showTagsMenu(false); showFilesMenu(false); });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !$('tagsMenu').hidden) {
            showTagsMenu(false);
            $('tagsButton').focus();
        } else if (e.key === 'Escape' && !$('filesMenu').hidden) {
            showFilesMenu(false);
            $('filesButton').focus();
        }
    });
    $('groupBy').addEventListener('change', e => { options.groupBy = e.target.value; sendOptions(); });
    $('showDone').addEventListener('change', e => { options.showDone = e.target.checked; sendOptions(); });
    $('showProgress').addEventListener('change', e => { options.showProgress = e.target.checked; sendOptions(); });
    $('behindOnly').addEventListener('change', e => { options.behindOnly = e.target.checked; sendOptions(); });
    $('maxDepth').addEventListener('change', e => {
        const n = Number(e.target.value);
        options.maxDepth = n > 0 ? n : undefined;
        sendOptions();
    });
    $('behindNext').addEventListener('click', () => nextBehind(1));
    $('behindCount').addEventListener('click', () => nextBehind(1));
    $('behindPrev').addEventListener('click', () => nextBehind(-1));
    $('zoomIn').addEventListener('click', () => zoom(1.25));
    $('zoomOut').addEventListener('click', () => zoom(0.8));
    $('fit').addEventListener('click', () => setFit(!fit));
    // Refit when the panel is resized.
    new ResizeObserver(() => { if (fit && model) render(); }).observe(chart);
    $('today').addEventListener('click', () => scrollToToday(true));
    $('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    $('undo').addEventListener('click', () => vscode.postMessage({ type: 'undo' }));
    $('redo').addEventListener('click', () => vscode.postMessage({ type: 'redo' }));
    // Cmd/Ctrl+Z undoes a drag, Shift+Cmd/Ctrl+Z or Ctrl+Y redoes it.
    document.addEventListener('keydown', e => {
        if (!(e.metaKey || e.ctrlKey) || e.altKey || drag) return;
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
        const key = e.key.toLowerCase();
        const which = key === 'z' ? (e.shiftKey ? 'redo' : 'undo') : key === 'y' && !e.shiftKey ? 'redo' : null;
        if (!which || $(which).disabled) return;
        vscode.postMessage({ type: which });
        e.preventDefault();
        e.stopPropagation();
    });
    function setUndo(which, label) {
        const b = $(which);
        b.disabled = !label;
        b.title = label ? `${which === 'undo' ? 'Undo' : 'Redo'}: ${label}` : `Nothing to ${which}`;
    }
    $('exportXlsx').addEventListener('click', () => vscode.postMessage({ type: 'export', format: 'xlsx' }));
    $('exportPdf').addEventListener('click', () => vscode.postMessage({ type: 'export', format: 'pdf' }));

    function setFit(on) {
        fit = on;
        $('fit').classList.toggle('active', fit);
        $('fit').setAttribute('aria-pressed', String(fit));
        vscode.setState({ ...vscode.getState(), fit });
        render();
        if (!fit) scrollToToday(false);
    }

    function zoom(factor) {
        // Zooming by hand leaves fit mode, starting from the fitted width.
        if (fit) setFit(false);
        // Keep the day in the middle of the view in the middle after zooming.
        const centre = (chart.scrollLeft + (chart.clientWidth - LABEL_W) / 2) / dayW;
        dayW = Math.max(4, Math.min(64, dayW * factor));
        vscode.setState({ ...vscode.getState(), dayW });
        render();
        chart.scrollLeft = centre * dayW - (chart.clientWidth - LABEL_W) / 2;
    }

    function scrollToToday(smooth) {
        if (!model) return;
        const offset = days(parseDay(model.start), parseDay(model.today)) * dayW;
        chart.scrollTo({ left: Math.max(0, offset - (chart.clientWidth - LABEL_W) / 3), behavior: smooth ? 'smooth' : 'auto' });
    }

    function fillAssignees() {
        const select = $('assignee');
        select.textContent = '';
        const add = (value, label) => {
            const o = el('option', '', label);
            o.value = value;
            select.appendChild(o);
        };
        add('*', 'Anyone');
        for (const a of model.assignees) add(a, '@' + a);
        add('', 'Unassigned');
        select.value = options.assignee === undefined ? '*' : options.assignee;
    }

    function showTagsMenu(show) {
        $('tagsMenu').hidden = !show;
        $('tagsButton').setAttribute('aria-expanded', String(show));
        if (show) showFilesMenu(false);
    }

    function setTags(tags) {
        options.tags = tags.length ? tags : undefined;
        sendOptions();
    }

    // A checklist of the project's tags; a task shows if it has any checked tag.
    function fillTags() {
        const chosen = options.tags || [];
        const button = $('tagsButton');
        button.textContent = chosen.length === 0 ? 'Tags: any'
            : chosen.length <= 2 ? 'Tags: ' + chosen.map(t => ':' + t + ':').join(' ')
            : `Tags: ${chosen.length} chosen`;
        button.classList.toggle('active', chosen.length > 0);
        // Keep chosen tags listed even if no task has them any more, so they can be unchecked.
        const all = [...new Set([...model.tags, ...chosen])].sort((a, b) => a.localeCompare(b));
        button.disabled = all.length === 0;
        if (all.length === 0) button.textContent = 'Tags: none in project';

        const menu = $('tagsMenu');
        menu.textContent = '';
        const clear = el('button', 'clear', 'Clear');
        clear.disabled = chosen.length === 0;
        clear.addEventListener('click', () => setTags([]));
        menu.appendChild(clear);
        for (const tag of all) {
            const label = el('label');
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = chosen.includes(tag);
            box.addEventListener('change', () => {
                const now = new Set(options.tags || []);
                if (box.checked) now.add(tag); else now.delete(tag);
                setTags(all.filter(t => now.has(t)));
            });
            label.appendChild(box);
            label.appendChild(document.createTextNode(tag));
            menu.appendChild(label);
        }
    }

    function showFilesMenu(show) {
        $('filesMenu').hidden = !show;
        $('filesButton').setAttribute('aria-expanded', String(show));
        if (show) showTagsMenu(false);
    }

    function setHiddenFiles(files) {
        options.hiddenFiles = files.length ? files : undefined;
        sendOptions();
    }

    // A checklist of the project's files; unchecked files' tasks are left out.
    function fillFiles() {
        const hidden = options.hiddenFiles || [];
        // Keep hidden files listed even if they have no tasks now, so they can be checked again.
        const all = [...new Set([...model.files, ...hidden])].sort();
        const shown = all.filter(f => !hidden.includes(f));
        const button = $('filesButton');
        button.textContent = hidden.length === 0 ? 'Files: all'
            : shown.length === 1 ? 'Files: ' + shown[0].split('/').pop()
            : `Files: ${shown.length} of ${all.length}`;
        button.classList.toggle('active', hidden.length > 0);
        button.disabled = all.length < 2 && hidden.length === 0;

        const menu = $('filesMenu');
        menu.textContent = '';
        const bar = el('div', 'menuButtons');
        const showAll = el('button', 'clear', 'Show all');
        showAll.disabled = hidden.length === 0;
        showAll.addEventListener('click', () => setHiddenFiles([]));
        const hideAll = el('button', 'clear', 'Hide all');
        hideAll.disabled = shown.length === 0;
        hideAll.addEventListener('click', () => setHiddenFiles(all));
        bar.appendChild(showAll);
        bar.appendChild(hideAll);
        menu.appendChild(bar);
        for (const file of all) {
            const label = el('label');
            label.title = file;
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = !hidden.includes(file);
            box.addEventListener('change', () => {
                const now = new Set(options.hiddenFiles || []);
                if (box.checked) now.delete(file); else now.add(file);
                setHiddenFiles(all.filter(f => now.has(f)));
            });
            label.appendChild(box);
            label.appendChild(document.createTextNode(file));
            menu.appendChild(label);
        }
    }

    // Drawing -----------------------------------------------------------------
    function render() {
        if (!model) return;
        const start = parseDay(model.start);
        const nDays = Math.max(1, days(start, parseDay(model.end)));
        if (fit) dayW = Math.max(0.25, (chart.clientWidth - LABEL_W - 1) / nDays);
        const width = nDays * dayW;
        const rows = model.rows;

        chart.textContent = '';
        $('empty').hidden = rows.length > 0;
        if (!rows.length) {
            $('empty').textContent = 'No tasks to show. Tasks are TODO headings in the org files under the project folder.';
            return;
        }

        const grid = el('div', 'grid');
        grid.style.width = `${LABEL_W + width}px`;
        grid.style.height = `${HEADER_H + rows.length * ROW_H}px`;

        // Background: weekends, today, and dependency arrows.
        const bg = svg('svg', { class: 'background', width, height: rows.length * ROW_H });
        bg.style.left = `${LABEL_W}px`;
        bg.style.top = `${HEADER_H}px`;
        // Weekends are only noise once days are a few pixels wide.
        for (let i = 0; i < nDays && dayW >= 3; i++) {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            if (d.getDay() === 0 || d.getDay() === 6) {
                bg.appendChild(svg('rect', { x: i * dayW, y: 0, width: dayW, height: rows.length * ROW_H, class: 'weekend' }));
            }
        }
        grid.appendChild(bg);

        // Header: month and day labels, sticky.
        const header = el('div', 'header');
        header.style.width = `${LABEL_W + width}px`;
        const corner = el('div', 'corner', 'Task');
        corner.id = 'corner';
        header.appendChild(corner);
        const scale = el('div', 'scale');
        scale.style.width = `${width}px`;
        let lastMonth = -1;
        // Days narrower than 4px show only months (and today). Each month's
        // label fits the space the month has: with the year, without, or none.
        const labelEvery = dayW >= 16 ? 1 : dayW >= 9 ? 2 : dayW >= 4 ? 7 : Infinity;
        for (let i = 0; i < nDays; i++) {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            if (d.getMonth() !== lastMonth) {
                lastMonth = d.getMonth();
                const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
                const room = Math.min(days(d, next), nDays - i) * dayW;
                const format = room >= 64 ? { month: 'short', year: 'numeric' } : room >= 30 ? { month: 'short' } : null;
                if (format) {
                    const m = el('span', 'month', d.toLocaleString(undefined, format));
                    m.style.left = `${i * dayW}px`;
                    scale.appendChild(m);
                }
            }
            const isToday = days(d, parseDay(model.today)) === 0;
            if (i % labelEvery === 0 || isToday) {
                const dl = el('span', 'day' + (isToday ? ' today' : ''), String(d.getDate()));
                dl.style.left = `${i * dayW}px`;
                dl.style.width = `${dayW}px`;
                scale.appendChild(dl);
            }
        }
        header.appendChild(scale);
        grid.appendChild(header);

        const todayX = days(start, parseDay(model.today)) * dayW;
        const bars = new Map();
        rows.forEach((row, index) => {
            const top = HEADER_H + index * ROW_H;
            const r = el('div', 'row ' + row.kind + (index === selected ? ' selected' : ''));
            r.style.top = `${top}px`;
            r.style.width = `${LABEL_W + width}px`;
            r.dataset.index = String(index);

            if (row.kind === 'group') {
                const label = el('div', 'label group-label');
                indent(label, row);
                addFold(label, row);
                if (row.behind) label.appendChild(el('span', 'behind-dot'));
                label.appendChild(el('span', 'title', row.label));
                if (row.progress) label.appendChild(el('span', 'pct-label', percentText(row.progress)));
                const tip = [row.label, row.start ? `${row.start} to ${row.end} (end exclusive)` : '',
                    progressTip(row.progress), row.behind ? 'Behind schedule' : ''].filter(Boolean).join('\n');
                label.title = tip;
                r.appendChild(label);
                if (row.line) {
                    r.setAttribute('data-vscode-context', JSON.stringify({
                        webviewSection: 'heading', filePath: row.filePath, line: row.line,
                        preventDefaultContextMenuItems: true,
                    }));
                }
                if (row.start && row.end) {
                    const s = days(start, parseDay(row.start));
                    const e = days(start, parseDay(row.end));
                    const bar = el('div', 'bar summary');
                    bar.style.left = `${LABEL_W + s * dayW}px`;
                    bar.style.width = `${Math.max(3, (e - s) * dayW - 2)}px`;
                    bar.title = tip;
                    r.appendChild(bar);
                    addProgress(r, bar, row, s * dayW, e * dayW - 2, todayX);
                }
                grid.appendChild(r);
                return;
            }

            r.setAttribute('data-vscode-context', JSON.stringify({
                webviewSection: 'task',
                filePath: row.filePath,
                line: row.line,
                preventDefaultContextMenuItems: true,
            }));

            const label = el('div', 'label');
            indent(label, row);
            addFold(label, row);
            if (row.behind) label.appendChild(el('span', 'behind-dot'));
            if (row.todo) label.appendChild(el('span', 'todo ' + row.status, row.todo));
            if (row.priority) label.appendChild(el('span', 'priority', `[#${row.priority}]`));
            if (row.status === 'blocked') label.appendChild(el('span', 'lock', '🔒'));
            label.appendChild(el('span', 'title', row.title));
            if (row.assignees.length) label.appendChild(el('span', 'who', '@' + row.assignees.join(' @')));
            if (row.progress) label.appendChild(el('span', 'pct-label', percentText(row.progress)));
            r.appendChild(label);

            const s = days(start, parseDay(row.start));
            const e = days(start, parseDay(row.end));
            const tip = [
                row.title,
                [row.todo, row.priority && `[#${row.priority}]`, row.assignees.map(a => '@' + a).join(' ')].filter(Boolean).join('  '),
                row.tags.length ? ':' + row.tags.join(':') + ':' : '',
                row.milestone ? `Milestone ${row.start}` : `${row.start} to ${row.end} (end exclusive)`,
                row.effortMinutes ? `Effort ${hours(row.effortMinutes)}` : '',
                row.deadline ? `Deadline ${row.deadline}` : '',
                row.status === 'blocked' ? 'Blocked by an unfinished dependency' : '',
                progressTip(row.progress),
                row.behind ? 'Behind schedule' : '',
                row.summary ? 'Spans its subtasks' : '',
                row.file,
            ].filter(Boolean).join('\n');

            let bar;
            if (row.milestone) {
                bar = el('div', 'milestone');
                bar.style.left = `${LABEL_W + s * dayW + dayW / 2 - 7}px`;
                bars.set(row.ganttId, { x1: s * dayW + dayW / 2 - 7, x2: s * dayW + dayW / 2 + 7, y: index * ROW_H + ROW_H / 2 });
            } else {
                bar = el('div', `bar ${row.status}${row.priority === 'A' ? ' crit' : ''}${row.summary ? ' summary-task' : ''}`);
                bar.style.left = `${LABEL_W + s * dayW}px`;
                bar.style.width = `${Math.max(3, (e - s) * dayW - 2)}px`;
                bars.set(row.ganttId, { x1: s * dayW, x2: e * dayW - 2, y: index * ROW_H + ROW_H / 2 });
                addProgress(r, bar, row, s * dayW, e * dayW - 2, todayX);
            }
            // Unfinished tasks can be dragged; a bar that ends on its deadline
            // also has a handle on its right end to move just the deadline.
            if (row.status !== 'done' && !row.summary) {
                bar.classList.add('draggable');
                bar.title = tip + '\n\nDrag to move' + (row.endsAtDeadline ? '; drag the right end to move the deadline' : '');
                if (row.endsAtDeadline) bar.appendChild(el('div', 'handle'));
            } else {
                bar.title = tip;
            }
            label.title = tip;
            r.appendChild(bar);
            grid.appendChild(r);
        });

        // Dependency arrows: from the end of the dependency to the task.
        const defs = svg('defs', {});
        const marker = svg('marker', { id: 'arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto' });
        marker.appendChild(svg('path', { d: 'M0,0 L8,4 L0,8 z', class: 'arrow-head' }));
        defs.appendChild(marker);
        bg.appendChild(defs);
        for (const row of rows) {
            if (row.kind !== 'task') continue;
            const to = bars.get(row.ganttId);
            for (const dep of row.dependsOn) {
                const from = bars.get(dep);
                if (!from || !to) continue;
                const x = Math.max(from.x2 + 6, Math.min(to.x1 - 6, from.x2 + 10));
                bg.appendChild(svg('path', {
                    d: `M${from.x2},${from.y} H${x} V${to.y} H${to.x1}`,
                    class: 'dependency',
                    'marker-end': 'url(#arrow)',
                }));
            }
        }

        // Today.
        bg.appendChild(svg('line', { x1: todayX, x2: todayX, y1: 0, y2: rows.length * ROW_H, class: 'today-line' }));

        chart.appendChild(grid);
        updateBreadcrumb();
        if (!scrolledToToday) {
            scrolledToToday = true;
            scrollToToday(false);
        }
    }

    // Interaction ---------------------------------------------------------------
    function rowIndexOf(target) {
        const row = target.closest && target.closest('.row');
        return row ? Number(row.dataset.index) : -1;
    }
    function select(index) {
        selected = index;
        for (const r of chart.querySelectorAll('.row.selected')) r.classList.remove('selected');
        const r = chart.querySelector(`.row[data-index="${index}"]`);
        if (r) {
            r.classList.add('selected');
            const top = r.offsetTop - HEADER_H;
            if (top < chart.scrollTop) chart.scrollTop = top;
            else if (top + ROW_H > chart.scrollTop + chart.clientHeight - HEADER_H) {
                chart.scrollTop = top + ROW_H - chart.clientHeight + HEADER_H;
            }
        }
    }
    function openRow(index) {
        const row = model && model.rows[index];
        if (row && row.filePath && row.line) vscode.postMessage({ type: 'open', filePath: row.filePath, line: row.line });
    }

    // Dragging bars -------------------------------------------------------------
    // The bar follows the pointer in whole days; on release the extension moves
    // the task's dates and offers to move the tasks that wait on it.
    let drag = null;
    let suppressClick = false;
    const tipBox = el('div', 'dragTip');
    tipBox.hidden = true;
    document.body.appendChild(tipBox);

    function dragText(d) {
        const sign = d.days > 0 ? '+' : '';
        const by = `${sign}${d.days} day${Math.abs(d.days) === 1 ? '' : 's'}`;
        if (d.edge === 'end') return `Deadline ${shortDay(addDays(d.row.deadline, d.days))} (${by})`;
        if (d.row.milestone) return `${shortDay(addDays(d.row.start, d.days))} (${by})`;
        return `${shortDay(addDays(d.row.start, d.days))} to ${shortDay(addDays(d.row.end, d.days - 1))} (${by})`;
    }
    function endDrag(apply) {
        if (!drag) return;
        const d = drag;
        drag = null;
        tipBox.hidden = true;
        chart.classList.remove('dragging');
        d.bar.classList.remove('moving');
        if (apply && d.days !== 0) {
            d.bar.classList.add('pending');
            vscode.postMessage({
                type: 'move',
                filePath: d.row.filePath,
                line: d.row.line,
                days: d.days,
                edge: d.edge,
                start: addDays(d.row.start, d.days),
            });
        } else {
            d.bar.style.left = `${d.left0}px`;
            if (d.edge === 'end') d.bar.style.width = `${d.width0}px`;
        }
    }

    chart.addEventListener('pointerdown', e => {
        if (e.button !== 0 || !model) return;
        const bar = e.target.closest && e.target.closest('.draggable');
        if (!bar) return;
        const index = rowIndexOf(bar);
        const row = model.rows[index];
        if (!row || row.kind !== 'task') return;
        drag = {
            bar, row, index,
            edge: e.target.classList.contains('handle') ? 'end' : 'move',
            x0: e.clientX,
            left0: parseFloat(bar.style.left),
            width0: parseFloat(bar.style.width) || 0,
            days: 0,
            started: false,
        };
        bar.setPointerCapture(e.pointerId);
        select(index);
    });
    chart.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = e.clientX - drag.x0;
        if (!drag.started && Math.abs(dx) < 4) return;
        if (!drag.started) {
            drag.started = true;
            chart.classList.add('dragging');
            drag.bar.classList.add('moving');
        }
        let n = Math.round(dx / dayW);
        if (drag.edge === 'end') {
            // Keep at least one day.
            const lengthDays = Math.round((drag.width0 + 2) / dayW);
            n = Math.max(n, 1 - lengthDays);
            drag.bar.style.width = `${Math.max(3, drag.width0 + n * dayW)}px`;
        } else {
            drag.bar.style.left = `${drag.left0 + n * dayW}px`;
        }
        drag.days = n;
        tipBox.textContent = dragText(drag);
        tipBox.hidden = false;
        tipBox.style.left = `${e.clientX + 12}px`;
        tipBox.style.top = `${e.clientY + 16}px`;
    });
    chart.addEventListener('pointerup', () => {
        if (!drag) return;
        if (drag.started) {
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 0);
        }
        endDrag(drag.started);
    });
    chart.addEventListener('pointercancel', () => endDrag(false));
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && drag) {
            endDrag(false);
            e.stopPropagation();
        }
    }, true);

    chart.addEventListener('click', e => { if (!suppressClick) select(rowIndexOf(e.target)); });
    chart.addEventListener('dblclick', e => { if (!suppressClick) openRow(rowIndexOf(e.target)); });
    // Select on right-click too, so the highlighted row is the one the menu acts on.
    chart.addEventListener('contextmenu', e => select(rowIndexOf(e.target)));
    chart.addEventListener('keydown', e => {
        if (!model) return;
        const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        if (step) {
            let i = selected;
            do { i += step; } while (i >= 0 && i < model.rows.length && model.rows[i].kind !== 'task');
            if (i >= 0 && i < model.rows.length) select(i);
            e.preventDefault();
        } else if (e.key === 'Enter') {
            openRow(selected);
        } else if ((e.key === 'n' || e.key === 'p') && !e.metaKey && !e.ctrlKey && !e.altKey && model.behindCount) {
            nextBehind(e.key === 'n' ? 1 : -1);
            e.preventDefault();
        }
    });

    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type !== 'model') return;
        model = msg.model;
        options = msg.options;
        setUndo('undo', msg.undo);
        setUndo('redo', msg.redo);
        $('project').textContent = msg.project;
        $('count').textContent = `${model.shownTasks} of ${msg.taskCount} tasks`;
        $('groupBy').value = options.groupBy;
        $('showDone').checked = options.showDone;
        $('showProgress').checked = !!options.showProgress;
        $('behindOnly').checked = !!options.behindOnly;
        $('maxDepth').value = String(options.maxDepth || 0);
        $('behindTools').hidden = !model.progress;
        document.querySelector('.progressLegend').hidden = !model.progress;
        const n = model.behindCount;
        $('behindCount').textContent = `${n} behind`;
        $('behindCount').classList.toggle('some', n > 0);
        for (const id of ['behindPrev', 'behindCount', 'behindNext']) $(id).disabled = n === 0;
        fillAssignees();
        fillTags();
        fillFiles();
        $('fit').classList.toggle('active', fit);
        $('fit').setAttribute('aria-pressed', String(fit));
        if (selected >= model.rows.length) selected = -1;
        render();
    });

    // The corner shows the headings above the top visible row, so a long
    // chart keeps its place.
    function updateBreadcrumb() {
        const corner = $('corner');
        if (!corner || !model) return;
        const top = Math.min(model.rows.length - 1, Math.max(0, Math.floor(chart.scrollTop / ROW_H)));
        const path = [];
        let depth = top >= 0 ? model.rows[top].depth : 0;
        for (let i = top - 1; i >= 0 && depth > 0; i--) {
            const r = model.rows[i];
            if (r.depth < depth) {
                path.unshift(r.label ?? r.title);
                depth = r.depth;
            }
        }
        corner.textContent = path.length ? path.join(' › ') : 'Task';
        corner.title = corner.textContent;
    }
    chart.addEventListener('scroll', updateBreadcrumb);

    vscode.postMessage({ type: 'ready' });
})();
