// Database view webview: overview, actions, folders, settings.
(function () {
    const vscode = acquireVsCodeApi();
    const $ = id => document.getElementById(id);

    function el(tag, attrs, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k === 'width') node.style.width = v; // CSSOM, which the CSP allows
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v === true ? '' : String(v));
        }
        for (const c of children.flat()) {
            if (c === undefined || c === null || c === false) continue;
            node.append(c instanceof Node ? c : document.createTextNode(String(c)));
        }
        return node;
    }

    const number = n => (typeof n === 'number' ? n.toLocaleString() : '—');

    function bytes(n) {
        if (typeof n !== 'number') return '—';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
    }

    function ago(ms) {
        if (!ms) return 'never';
        const s = Math.max(0, (Date.now() - ms) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return `${Math.round(s / 60)} min ago`;
        if (s < 86400) return `${Math.round(s / 3600)} h ago`;
        if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
        return new Date(ms).toLocaleDateString();
    }

    // ---- Overview ---------------------------------------------------------

    let lastStats = {};

    function card(label, value, detail, cls) {
        return el('div', { class: 'card' + (cls ? ' ' + cls : '') },
            el('div', { class: 'cardValue' }, value),
            el('div', { class: 'cardLabel' }, label),
            detail ? el('div', { class: 'cardDetail muted' }, detail) : null);
    }

    function embeddingCard(e) {
        if (!e) return card('Semantic search', '—');
        if (!e.supported) return card('Semantic search', 'Unavailable', e.error || 'Vector search is not supported by this SQLite build', 'warn');
        if (!e.service) return card('Semantic search', 'Off', e.stored ? 'Embeddings are stored, but no embedding service is set up' : 'Set up Ollama under Embeddings', 'warn');
        if (e.progress && e.progress.total) {
            return card('Semantic search', `${Math.round(100 * e.progress.done / e.progress.total)}%`,
                `Embedding ${number(e.progress.done)} of ${number(e.progress.total)}`);
        }
        return card('Semantic search', 'On', e.stored ? 'Embeddings up to date' : 'No embeddings yet');
    }

    function renderStats(s) {
        const cards = $('cards');
        cards.replaceChildren();
        if (s.missing) {
            cards.append(el('p', { class: 'warn' }, 'The database is not open. It opens when the extension finishes starting; Refresh to try again.'));
            return;
        }
        if (s.error) {
            cards.append(el('p', { class: 'warn' }, 'Could not read the database: ' + s.error));
            return;
        }
        lastStats = { ...lastStats, ...s };
        s = lastStats;
        const types = s.byType ? `${number(s.byType.org)} org · ${number(s.byType.md)} Markdown` : '';
        cards.append(
            card('Files', number(s.files), types),
            card('Headings', number(s.headings)),
            card('Source blocks', number(s.blocks)),
            card('Chunks', number(s.chunks), 'Text pieces for semantic search'),
            card('Size', bytes(s.size)),
            card('Last indexed', ago(s.lastIndexed), s.lastIndexed ? new Date(s.lastIndexed).toLocaleString() : ''),
            embeddingCard(s.embeddings),
            card('Search scope', s.scope || '—'),
            s.schema ? card('Schema', `v${s.schema.current}`, s.schema.current < s.schema.latest ? `v${s.schema.latest} is available` : 'Up to date', s.schema.current < s.schema.latest ? 'warn' : '') : null,
        );
        const line = $('dbPath');
        line.replaceChildren();
        if (s.dbPath) {
            line.append('Database file: ', el('code', {}, s.dbPath), ' ',
                el('button', { class: 'link', onclick: () => vscode.postMessage({ type: 'reveal' }) }, 'Reveal'));
        }
        if (s.folders) renderFolders(s.folders, s.files);
        if (s.recent) renderRecent(s.recent);
    }

    function renderFolders(folders, total) {
        const table = $('folders');
        table.replaceChildren();
        if (!folders.length) {
            table.append(el('tr', {}, el('td', { class: 'muted' }, 'No files indexed yet.')));
            return;
        }
        const max = Math.max(...folders.map(f => f.files), 1);
        for (const f of folders) {
            table.append(el('tr', {},
                el('td', { class: 'num' }, number(f.files)),
                el('td', { class: 'barCell' }, el('div', { class: 'bar', width: `${(100 * f.files / max).toFixed(1)}%` })),
                el('td', { class: 'pathCell', title: f.folder }, f.label),
                el('td', {}, el('button', {
                    class: 'link',
                    title: `Add ${f.folder} to scimax.db.exclude`,
                    onclick: () => vscode.postMessage({ type: 'exclude', folder: f.folder }),
                }, 'Exclude'))));
        }
        if (typeof total === 'number') {
            const shown = folders.reduce((a, f) => a + f.files, 0);
            if (shown < total) table.append(el('tr', {}, el('td', { class: 'num muted' }, number(total - shown)), el('td'), el('td', { class: 'muted' }, 'in other folders'), el('td')));
        }
    }

    function renderRecent(recent) {
        const table = $('recent');
        table.replaceChildren();
        if (!recent.length) {
            table.append(el('tr', {}, el('td', { class: 'muted' }, 'No files indexed yet.')));
            return;
        }
        for (const f of recent) {
            table.append(el('tr', {},
                el('td', { class: 'pathCell' }, el('button', {
                    class: 'link', title: f.path,
                    onclick: () => vscode.postMessage({ type: 'openFile', path: f.path }),
                }, f.label)),
                el('td', { class: 'muted nowrap' }, ago(f.mtime))));
        }
    }

    // ---- Actions ----------------------------------------------------------

    function renderActions(actions) {
        const box = $('actions');
        box.replaceChildren();
        const groups = new Map();
        for (const a of actions) {
            if (!groups.has(a.group)) groups.set(a.group, []);
            groups.get(a.group).push(a);
        }
        for (const [group, items] of groups) {
            box.append(el('div', { class: 'actionGroup' },
                el('h3', {}, group),
                items.map(a => el('button', {
                    class: 'action' + (a.danger ? ' danger' : ''),
                    title: `${a.detail} (${a.command})`,
                    onclick: () => vscode.postMessage({ type: 'run', command: a.command }),
                }, a.label))));
        }
    }

    // ---- Settings ---------------------------------------------------------

    let settings = [];
    let sections = [];
    const filterInput = $('settingsFilter');

    const shortKey = key => key.replace(/^scimax\./, '');
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    // Descriptions may hold Markdown; show `code` spans and drop the rest.
    function description(text) {
        const frag = document.createDocumentFragment();
        text.split(/(`[^`]+`)/).forEach(part => {
            if (part.startsWith('`') && part.endsWith('`') && part.length > 1) frag.append(el('code', {}, part.slice(1, -1)));
            else frag.append(part.replace(/\*\*|__/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));
        });
        return frag;
    }

    function control(s) {
        const set = value => vscode.postMessage({ type: 'set', key: s.key, value });
        if (s.type === 'boolean') {
            return el('input', { type: 'checkbox', checked: !!s.value, 'aria-label': s.key, onchange: e => set(e.target.checked) });
        }
        if (s.enum) {
            const select = el('select', { 'aria-label': s.key, onchange: e => set(e.target.value) },
                s.enum.map((v, i) => el('option', { value: v, selected: v === s.value, title: (s.enumDescriptions || [])[i] }, v)));
            return select;
        }
        if (s.type === 'number' || s.type === 'integer') {
            return el('input', {
                type: 'number', value: s.value ?? '', min: s.minimum, max: s.maximum,
                step: s.type === 'integer' ? 1 : 'any', 'aria-label': s.key,
                onchange: e => {
                    const v = e.target.value === '' ? undefined : Number(e.target.value);
                    if (v === undefined) vscode.postMessage({ type: 'reset', key: s.key });
                    else if (!Number.isNaN(v)) set(s.type === 'integer' ? Math.round(v) : v);
                },
            });
        }
        if (s.type === 'array') {
            const list = Array.isArray(s.value) ? s.value : [];
            const input = el('input', { type: 'text', placeholder: 'Add…', 'aria-label': `Add to ${s.key}` });
            const add = () => {
                const v = input.value.trim();
                if (v && !list.includes(v)) set([...list, v]);
                input.value = '';
            };
            input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
            return el('div', { class: 'chips' },
                list.map((v, i) => el('span', { class: 'chip' }, el('span', {}, v),
                    el('button', { class: 'chipX', title: 'Remove', 'aria-label': `Remove ${v}`, onclick: () => set(list.filter((_, j) => j !== i)) }, '×'))),
                el('span', { class: 'chipAdd' }, input,
                    el('button', { onclick: add }, 'Add'),
                    s.key === 'scimax.db.include' ? el('button', { title: 'Pick folders or files', onclick: () => vscode.postMessage({ type: 'addInclude' }) }, 'Browse…') : null));
        }
        if (s.type === 'string') {
            return el('input', { type: 'text', value: s.value ?? '', 'aria-label': s.key, onchange: e => set(e.target.value) });
        }
        // Objects and anything else: edit in VS Code.
        return el('button', { class: 'link', onclick: () => vscode.postMessage({ type: 'openSetting', key: s.key }) }, 'Edit in settings.json');
    }

    function renderSettings() {
        const box = $('settings');
        const q = filterInput.value.trim().toLowerCase();
        const focused = document.activeElement && document.activeElement.getAttribute('aria-label');
        box.replaceChildren();
        for (const title of sections) {
            const items = settings.filter(s => s.section === title
                && (!q || s.key.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)));
            if (!items.length) continue;
            box.append(el('h3', { class: 'sectionTitle' }, title));
            for (const s of items) {
                const changed = s.where !== 'default' && !same(s.value, s.default);
                box.append(el('div', { class: 'setting' + (changed ? ' changed' : '') },
                    el('div', { class: 'settingHead' },
                        el('span', { class: 'settingKey' }, shortKey(s.key)),
                        s.where !== 'default' ? el('span', { class: 'where', title: `Set in ${s.where} settings` }, s.where) : null,
                        el('span', { class: 'spacer' }),
                        changed ? el('button', { class: 'link', title: `Reset to ${JSON.stringify(s.default)}`, onclick: () => vscode.postMessage({ type: 'reset', key: s.key }) }, 'Reset') : null,
                        el('button', { class: 'gear', title: 'Open in Settings', 'aria-label': `Open ${s.key} in Settings`, onclick: () => vscode.postMessage({ type: 'openSetting', key: s.key }) }, '⚙')),
                    el('div', { class: 'settingDesc muted' }, description(s.description)),
                    el('div', { class: 'settingControl' }, control(s))));
            }
        }
        if (!box.children.length) box.append(el('p', { class: 'muted' }, 'No settings match.'));
        if (focused) {
            const again = box.querySelector(`[aria-label="${CSS.escape(focused)}"]`);
            if (again) again.focus();
        }
    }

    filterInput.addEventListener('input', renderSettings);

    // ---- Wiring -----------------------------------------------------------

    $('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    $('openSettings').addEventListener('click', () => vscode.postMessage({ type: 'openSetting' }));
    $('openJson').addEventListener('click', () => vscode.postMessage({ type: 'openSettingsJson' }));

    window.addEventListener('message', ({ data }) => {
        switch (data.type) {
            case 'stats': renderStats(data); break;
            case 'actions': renderActions(data.actions); break;
            case 'settings':
                settings = data.settings;
                sections = data.sections;
                renderSettings();
                break;
        }
    });

    vscode.postMessage({ type: 'ready' });
})();
