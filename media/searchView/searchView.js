// Search view webview. The extension does the searching (src/search/searchView.ts);
// this sends the query, modes and filters as they change and draws the results.
(function () {
    const vscode = acquireVsCodeApi();
    const $ = id => document.getElementById(id);

    const queryInput = $('query');
    const propsInput = $('properties');
    const pathsInput = $('paths');
    const list = $('list');
    const modeBoxes = [...document.querySelectorAll('input[data-mode]')];
    const tagsButton = $('tagsButton');
    const tagsMenu = $('tagsMenu');
    const tagsSearch = $('tagsSearch');
    const tagsList = $('tagsList');
    const todoButton = $('todoButton');
    const todoMenu = $('todoMenu');
    const todoList = $('todoList');
    const sortSelect = $('sort');

    const SHOWN_HITS = 5;

    /** "3 days ago" for a time in ms. */
    function ago(ms) {
        const s = Math.max(0, (Date.now() - ms) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return `${Math.round(s / 60)} min ago`;
        if (s < 86400) return `${Math.round(s / 3600)} h ago`;
        if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
        return new Date(ms).toLocaleDateString();
    }
    const PAGE = 50;
    const MAX_LINE = 240;

    let options = { query: '', modes: ['fulltext', 'headings'], includeTags: [], excludeTags: [], includeTodo: [], excludeTodo: [], properties: '', paths: '', sort: 'recent' };
    let allTags = [];
    /** {state, count, done} from the index */
    let todoStates = [];
    let semantic = { available: false };
    let requestId = 0;
    let limit = PAGE;
    let files = [];
    /** Files whose every hit is shown */
    const expanded = new Set();
    let debounce;

    // ------------------------------------------------------------------
    // Sending searches
    // ------------------------------------------------------------------

    function readOptions() {
        options.query = queryInput.value;
        options.modes = modeBoxes.filter(b => b.checked).map(b => b.dataset.mode);
        options.properties = propsInput.value;
        options.paths = pathsInput.value;
        options.sort = sortSelect.value;
    }

    function search(delay) {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            readOptions();
            vscode.setState({ options });
            vscode.postMessage({ type: 'search', id: ++requestId, options, limit });
        }, delay);
    }

    function restart(delay) {
        limit = PAGE;
        expanded.clear();
        search(delay);
    }

    queryInput.addEventListener('input', () => restart(200));
    propsInput.addEventListener('input', () => restart(350));
    pathsInput.addEventListener('input', () => restart(350));
    modeBoxes.forEach(b => b.addEventListener('change', () => restart(0)));
    sortSelect.addEventListener('change', () => restart(0));
    $('database').addEventListener('click', () => vscode.postMessage({ type: 'database' }));
    $('clearFilters').addEventListener('click', () => {
        options.includeTags = [];
        options.excludeTags = [];
        options.includeTodo = [];
        options.excludeTodo = [];
        propsInput.value = '';
        pathsInput.value = '';
        drawTagsButton();
        drawTags();
        drawTodoButton();
        drawTodo();
        restart(0);
    });

    // ------------------------------------------------------------------
    // Tags menu: click once to require, twice to exclude, three times to clear
    // ------------------------------------------------------------------

    function drawTagsButton() {
        const parts = [
            ...options.includeTags.map(t => '+' + t),
            ...options.excludeTags.map(t => '−' + t),
        ];
        tagsButton.textContent = parts.length ? 'Tags: ' + parts.join(' ') : 'Tags: any';
        tagsButton.classList.toggle('active', parts.length > 0);
    }

    function drawTags() {
        const find = tagsSearch.value.trim().toLowerCase();
        tagsList.textContent = '';
        const shown = allTags.filter(t => !find || t.tag.toLowerCase().includes(find));
        if (!shown.length) {
            const empty = document.createElement('div');
            empty.className = 'muted';
            empty.textContent = allTags.length ? 'No tag matches.' : 'No tags in the index.';
            tagsList.appendChild(empty);
            return;
        }
        for (const { tag, count } of shown.slice(0, 300)) {
            const state = options.includeTags.includes(tag) ? 'include' : options.excludeTags.includes(tag) ? 'exclude' : '';
            const b = document.createElement('button');
            b.className = 'tag ' + state;
            b.setAttribute('role', 'menuitem');
            b.title = state === 'include' ? 'Required: click to exclude' : state === 'exclude' ? 'Excluded: click to clear' : 'Click to require';
            const mark = document.createElement('span');
            mark.className = 'tagState';
            mark.textContent = state === 'include' ? '+' : state === 'exclude' ? '−' : '';
            const name = document.createElement('span');
            name.textContent = tag;
            const n = document.createElement('span');
            n.className = 'muted count';
            n.textContent = String(count);
            b.append(mark, name, n);
            b.addEventListener('click', () => {
                const inc = options.includeTags.filter(t => t !== tag);
                const exc = options.excludeTags.filter(t => t !== tag);
                if (state === '') inc.push(tag);
                else if (state === 'include') exc.push(tag);
                options.includeTags = inc;
                options.excludeTags = exc;
                drawTagsButton();
                drawTags();
                restart(0);
            });
            tagsList.appendChild(b);
        }
    }

    function toggleTagsMenu(open) {
        const show = open ?? tagsMenu.hidden;
        tagsMenu.hidden = !show;
        tagsButton.setAttribute('aria-expanded', String(show));
        if (show) {
            drawTags();
            tagsSearch.focus();
        }
    }

    tagsButton.addEventListener('click', e => { e.stopPropagation(); toggleTodoMenu(false); toggleTagsMenu(); });
    tagsMenu.addEventListener('click', e => e.stopPropagation());
    tagsSearch.addEventListener('input', drawTags);
    tagsSearch.addEventListener('keydown', e => {
        if (e.key === 'Escape') { toggleTagsMenu(false); tagsButton.focus(); e.preventDefault(); }
    });
    document.addEventListener('click', () => toggleTagsMenu(false));

    // ------------------------------------------------------------------
    // TODO menu: like tags, but a heading has one state, so the selected
    // states are alternatives. @open and @done stand for any open or done state.
    // ------------------------------------------------------------------

    const TODO_LABELS = { '@open': 'Any open', '@done': 'Any done' };
    const todoLabel = s => TODO_LABELS[s] || s;

    function drawTodoButton() {
        const inc = options.includeTodo || [];
        const exc = options.excludeTodo || [];
        const parts = [inc.map(todoLabel).join(' or '), ...exc.map(s => '−' + todoLabel(s))].filter(Boolean);
        todoButton.textContent = parts.length ? 'TODO: ' + parts.join(' ') : 'TODO: any';
        todoButton.classList.toggle('active', parts.length > 0);
    }

    function todoItem(state, count, done) {
        const inc = options.includeTodo || [];
        const exc = options.excludeTodo || [];
        const st = inc.includes(state) ? 'include' : exc.includes(state) ? 'exclude' : '';
        const b = document.createElement('button');
        b.className = 'tag ' + st + (done ? ' done' : '');
        b.setAttribute('role', 'menuitem');
        b.title = st === 'include' ? 'Selected: click to exclude' : st === 'exclude' ? 'Excluded: click to clear' : 'Click to select';
        const mark = document.createElement('span');
        mark.className = 'tagState';
        mark.textContent = st === 'include' ? '+' : st === 'exclude' ? '−' : '';
        const name = document.createElement('span');
        name.textContent = todoLabel(state);
        const n = document.createElement('span');
        n.className = 'muted count';
        n.textContent = count === undefined ? '' : String(count);
        b.append(mark, name, n);
        b.addEventListener('click', () => {
            const i = inc.filter(s => s !== state);
            const e = exc.filter(s => s !== state);
            if (st === '') i.push(state);
            else if (st === 'include') e.push(state);
            options.includeTodo = i;
            options.excludeTodo = e;
            drawTodoButton();
            drawTodo();
            restart(0);
        });
        return b;
    }

    function drawTodo() {
        todoList.textContent = '';
        const open = todoStates.filter(t => !t.done).reduce((a, t) => a + t.count, 0);
        const done = todoStates.filter(t => t.done).reduce((a, t) => a + t.count, 0);
        todoList.append(todoItem('@open', open, false), todoItem('@done', done, true));
        const sep = document.createElement('div');
        sep.className = 'menuSep';
        todoList.appendChild(sep);
        if (!todoStates.length) {
            const empty = document.createElement('div');
            empty.className = 'muted';
            empty.textContent = 'No TODO states in the index.';
            todoList.appendChild(empty);
        }
        for (const t of todoStates) todoList.appendChild(todoItem(t.state, t.count, t.done));
    }

    function toggleTodoMenu(open) {
        const show = open ?? todoMenu.hidden;
        todoMenu.hidden = !show;
        todoButton.setAttribute('aria-expanded', String(show));
        if (show) {
            drawTodo();
            const first = todoList.querySelector('button');
            if (first) first.focus();
        }
    }

    todoButton.addEventListener('click', e => { e.stopPropagation(); toggleTagsMenu(false); toggleTodoMenu(); });
    todoMenu.addEventListener('click', e => e.stopPropagation());
    todoMenu.addEventListener('keydown', e => {
        if (e.key === 'Escape') { toggleTodoMenu(false); todoButton.focus(); e.preventDefault(); }
    });
    document.addEventListener('click', () => toggleTodoMenu(false));

    // ------------------------------------------------------------------
    // Results
    // ------------------------------------------------------------------

    const KIND_LABEL = { fulltext: 'text', semantic: 'meaning', headings: 'heading' };

    /** A long line cut to a window around its first mark, with the marks moved to match. */
    function clip(text, marks) {
        if (text.length <= MAX_LINE) return { text, marks, before: false, after: false };
        const first = marks.length ? marks[0][0] : 0;
        const start = Math.max(0, Math.min(first - 60, text.length - MAX_LINE));
        const end = Math.min(text.length, start + MAX_LINE);
        return {
            text: text.slice(start, end),
            marks: marks.filter(([a]) => a >= start && a < end).map(([a, b]) => [a - start, Math.min(b, end) - start]),
            before: start > 0,
            after: end < text.length,
        };
    }

    function markedText(el, text, marks) {
        const c = clip(text, marks);
        if (c.before) el.append('…');
        let at = 0;
        for (const [a, b] of c.marks) {
            if (a < at) continue;
            if (a > at) el.append(c.text.slice(at, a));
            const m = document.createElement('mark');
            m.textContent = c.text.slice(a, b);
            el.appendChild(m);
            at = b;
        }
        if (at < c.text.length) el.append(c.text.slice(at));
        if (c.after) el.append('…');
    }

    function badge(kind) {
        const b = document.createElement('span');
        b.className = 'badge ' + kind;
        b.textContent = KIND_LABEL[kind] || kind;
        return b;
    }

    function drawHit(file, hit) {
        const row = document.createElement('div');
        row.className = 'hit';
        row.tabIndex = -1;
        row.setAttribute('role', 'option');
        row.dataset.file = file.filePath;
        row.dataset.line = String(hit.line);
        if (hit.marks.length) {
            row.dataset.column = String(hit.marks[0][0]);
            row.dataset.length = String(hit.marks[0][1] - hit.marks[0][0]);
        }

        const num = document.createElement('span');
        num.className = 'lineNo';
        num.textContent = String(hit.line);
        row.appendChild(num);

        const body = document.createElement('div');
        body.className = 'hitBody';
        const outline = hit.kinds.includes('headings') ? hit.outline.slice(0, -1) : hit.outline;
        if (outline.length) {
            const o = document.createElement('div');
            o.className = 'outline';
            o.textContent = outline.join(' › ');
            body.appendChild(o);
        }
        const text = document.createElement('div');
        text.className = 'text' + (hit.kinds.includes('headings') ? ' heading' : '');
        markedText(text, hit.text, hit.marks);
        body.appendChild(text);
        for (const extra of hit.more || []) {
            const m = document.createElement('div');
            m.className = 'text more';
            markedText(m, extra, []);
            body.appendChild(m);
        }
        row.appendChild(body);

        const kinds = document.createElement('span');
        kinds.className = 'kinds';
        if (files.some(f => f.kinds.length > 1) || options.modes.length > 1) hit.kinds.forEach(k => kinds.appendChild(badge(k)));
        row.appendChild(kinds);
        return row;
    }

    function drawFile(file) {
        const group = document.createElement('section');
        group.className = 'file';

        const head = document.createElement('div');
        head.className = 'fileHead';
        head.tabIndex = -1;
        head.dataset.file = file.filePath;
        head.dataset.line = String(file.hits[0] ? file.hits[0].line : 1);
        head.title = file.filePath;
        const name = document.createElement('span');
        name.className = 'fileName';
        name.textContent = file.name;
        const dir = document.createElement('span');
        dir.className = 'muted dir';
        dir.textContent = file.dir === '.' ? '' : file.dir;
        const count = document.createElement('span');
        count.className = 'muted';
        count.textContent = file.hits.length ? `${file.hits.length}${file.hits.length >= 50 ? '+' : ''} line${file.hits.length === 1 ? '' : 's'}` : '';
        const when = document.createElement('span');
        when.className = 'muted when';
        if (file.mtime) {
            when.textContent = ago(file.mtime);
            when.title = 'Modified ' + new Date(file.mtime).toLocaleString();
        }
        const kinds = document.createElement('span');
        kinds.className = 'kinds';
        file.kinds.forEach(k => kinds.appendChild(badge(k)));
        head.append(name, dir, count, when, kinds);
        group.appendChild(head);

        if (!file.hits.length && file.snippet) {
            const s = document.createElement('div');
            s.className = 'hit snippet';
            s.textContent = file.snippet;
            group.appendChild(s);
        }
        const all = expanded.has(file.filePath);
        const shown = all ? file.hits : file.hits.slice(0, SHOWN_HITS);
        shown.forEach(h => group.appendChild(drawHit(file, h)));
        if (file.hits.length > SHOWN_HITS) {
            const more = document.createElement('button');
            more.className = 'moreHits';
            more.textContent = all ? 'Show fewer' : `Show ${file.hits.length - SHOWN_HITS} more`;
            more.addEventListener('click', () => {
                if (all) expanded.delete(file.filePath); else expanded.add(file.filePath);
                draw();
            });
            group.appendChild(more);
        }
        return group;
    }

    function hint(text) {
        const d = document.createElement('div');
        d.className = 'hint muted';
        d.textContent = text;
        list.appendChild(d);
    }

    function draw(message) {
        const focusedKey = currentKey();
        list.textContent = '';
        if (message && message.error) {
            hint(message.error);
            return;
        }
        if (!files.length) {
            const anyFilter = options.includeTags.length || options.excludeTags.length
                || (options.includeTodo || []).length || (options.excludeTodo || []).length || options.properties.trim() || options.paths.trim();
            if (!options.query.trim() && !anyFilter) hint('Type to search the notes in the database. Check Full text, Semantic or Headings to choose how; the tags, properties and paths narrow the results.');
            else if (message && message.pending) hint('Searching…');
            else hint('Nothing found.');
            return;
        }
        files.forEach(f => list.appendChild(drawFile(f)));
        if (files.length >= limit) {
            const more = document.createElement('button');
            more.className = 'moreFiles';
            more.textContent = 'More files';
            more.addEventListener('click', () => { limit += PAGE; search(0); });
            list.appendChild(more);
        }
        if (focusedKey) restoreFocus(focusedKey);
    }

    function drawCount(message) {
        const lines = files.reduce((n, f) => n + f.hits.length, 0);
        $('count').textContent = files.length
            ? `${files.length}${files.length >= limit ? '+' : ''} file${files.length === 1 ? '' : 's'}, ${lines} line${lines === 1 ? '' : 's'}` + (message.ms !== undefined ? ` · ${message.ms} ms` : '')
            : '';
        $('pending').hidden = !message.pending;
        $('note').textContent = message.note || '';
    }

    // ------------------------------------------------------------------
    // Moving and opening
    // ------------------------------------------------------------------

    const rows = () => [...list.querySelectorAll('.hit[data-file], .fileHead')];

    function currentKey() {
        const el = document.activeElement;
        return el && el.dataset && el.dataset.file ? `${el.className}|${el.dataset.file}|${el.dataset.line}` : null;
    }

    function restoreFocus(key) {
        const el = rows().find(r => `${r.className}|${r.dataset.file}|${r.dataset.line}` === key);
        if (el) el.focus();
    }

    function move(delta) {
        const all = rows();
        if (!all.length) return;
        const at = all.indexOf(document.activeElement);
        const next = at < 0 ? (delta > 0 ? 0 : all.length - 1) : Math.min(all.length - 1, Math.max(0, at + delta));
        all[next].focus();
        all[next].scrollIntoView({ block: 'nearest' });
    }

    function open(el) {
        if (!el || !el.dataset.file) return;
        vscode.postMessage({
            type: 'open',
            filePath: el.dataset.file,
            line: Number(el.dataset.line),
            column: el.dataset.column ? Number(el.dataset.column) : undefined,
            length: el.dataset.length ? Number(el.dataset.length) : undefined,
        });
    }

    list.addEventListener('click', e => {
        const el = e.target.closest('.hit[data-file], .fileHead');
        if (el) el.focus();
    });
    list.addEventListener('dblclick', e => open(e.target.closest('.hit[data-file], .fileHead')));

    queryInput.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.isComposing)) {
            e.preventDefault();
            clearTimeout(debounce);
            readOptions();
            move(1);
        }
    });

    document.addEventListener('keydown', e => {
        const t = e.target;
        const typing = t instanceof HTMLInputElement && t.type !== 'checkbox';
        if (typing) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        switch (e.key) {
            case 'ArrowDown': case 'n': case 'j': move(1); break;
            case 'ArrowUp': case 'p': case 'k':
                if (rows().indexOf(document.activeElement) === 0) queryInput.focus(); else move(-1);
                break;
            case 'Enter': case 'o': open(document.activeElement); break;
            case '/': queryInput.focus(); queryInput.select(); break;
            case 'Escape': queryInput.focus(); break;
            case 'q': vscode.postMessage({ type: 'close' }); break;
            default: return;
        }
        e.preventDefault();
    });

    // ------------------------------------------------------------------
    // Messages from the extension
    // ------------------------------------------------------------------

    function applyOptions(o) {
        options = { ...options, ...o };
        queryInput.value = options.query || '';
        propsInput.value = options.properties || '';
        pathsInput.value = options.paths || '';
        sortSelect.value = options.sort || 'recent';
        modeBoxes.forEach(b => { b.checked = options.modes.includes(b.dataset.mode); });
        drawTagsButton();
        drawTodoButton();
    }

    function applySemantic() {
        const box = modeBoxes.find(b => b.dataset.mode === 'semantic');
        const label = $('semanticLabel');
        box.disabled = !semantic.available;
        label.classList.toggle('disabled', !semantic.available);
        label.title = semantic.available ? 'Passages close in meaning (embeddings)' : 'Semantic search is off: ' + (semantic.reason || '');
    }

    window.addEventListener('message', event => {
        const m = event.data;
        switch (m.type) {
            case 'setup': {
                const saved = vscode.getState();
                applyOptions(saved && saved.options ? saved.options : m.options);
                allTags = m.tags || [];
                todoStates = m.todoStates || [];
                semantic = m.semantic || { available: false };
                applySemantic();
                const dl = $('propertyNames');
                dl.textContent = '';
                for (const name of m.propertyNames || []) {
                    const opt = document.createElement('option');
                    opt.value = name;
                    dl.appendChild(opt);
                }
                if (m.dbMissing) {
                    list.textContent = '';
                    hint('The database is not available. Scimax indexes your notes into it: see "Scimax: Sync Files".');
                    return;
                }
                queryInput.focus();
                queryInput.select();
                restart(0);
                break;
            }
            case 'setQuery':
                queryInput.value = m.query;
                queryInput.focus();
                restart(0);
                break;
            case 'results':
                if (m.id !== requestId) return;
                files = m.files || [];
                drawCount(m);
                draw(m);
                break;
        }
    });

    vscode.postMessage({ type: 'ready' });
})();
