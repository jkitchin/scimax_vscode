// The Crucible graph webview: a force-directed SVG of `crucible graph --json`.
//
// Messages from the extension:
//   {type: 'graph', graph, focus, keepView}  draw a graph (focus: node id to centre on)
//   {type: 'focus', id}                      centre on a node
//   {type: 'error', message}
// Messages to the extension:
//   {type: 'ready'}, {type: 'refresh'}, {type: 'open', path}
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();
    const SVG = 'http://www.w3.org/2000/svg';

    const svg = document.getElementById('graph');
    const tooltip = document.getElementById('tooltip');
    const status = document.getElementById('status');
    const find = document.getElementById('find');
    const titles = document.getElementById('titles');
    const showConcepts = document.getElementById('showConcepts');
    const showSources = document.getElementById('showSources');
    const showLabels = document.getElementById('showLabels');
    const queryInput = document.getElementById('query');
    const tagInput = document.getElementById('tagInput');
    const tagNames = document.getElementById('tagNames');
    const tagChips = document.getElementById('tagChips');
    const withNeighbours = document.getElementById('withNeighbours');
    const typeBoxes = [...document.querySelectorAll('.types input[data-type]')];

    // Filters: articles must match all of them. Tags and types are checked
    // against the graph; a query runs `crucible search` (with the same tags and
    // types) and keeps the articles it returns.
    const filter = { query: '', searchPaths: null, tags: [], types: new Set() };
    let searchId = 0;
    /** Article id -> names of its concept tags. */
    let tagsOf = new Map();

    // Edge rest lengths and spring strengths, by edge type.
    const LENGTH = { link: 120, derivation: 100, concept: 150, source: 90 };
    // Each spring is divided by the smaller degree of its ends (as in d3-force),
    // so hubs with many edges stay stable.
    const STRENGTH = { link: 0.6, derivation: 0.8, concept: 0.3, source: 0.5 };
    const MAX_SPEED = 40;
    const REPULSION = 3000;
    const GRAVITY = 0.002;
    const LABEL_ZOOM = 1.6;

    let nodes = [];          // {id, type, kind, label, path, x, y, vx, vy, r, el, fixed}
    let edges = [];          // {source, target, type, el}
    let byId = new Map();
    let neighbours = new Map();
    let focusId = null;
    let hoverId = null;
    let alpha = 0;
    let running = false;
    // View transform: screen = (world - centre) * scale + size / 2.
    const view = { x: 0, y: 0, scale: 1 };
    // While true the view follows the focused node as the layout settles.
    let followFocus = true;
    // Fit the whole graph once the first layout settles (no article to centre on).
    let fitWhenSettled = false;

    const root = document.createElementNS(SVG, 'g');
    const edgeLayer = document.createElementNS(SVG, 'g');
    const nodeLayer = document.createElementNS(SVG, 'g');
    svg.appendChild(defs());
    root.append(edgeLayer, nodeLayer);
    svg.appendChild(root);

    function defs() {
        const d = document.createElementNS(SVG, 'defs');
        for (const type of ['link', 'derivation']) {
            const marker = document.createElementNS(SVG, 'marker');
            marker.setAttribute('id', `arrow-${type}`);
            marker.setAttribute('viewBox', '0 0 10 10');
            marker.setAttribute('refX', '10');
            marker.setAttribute('refY', '5');
            marker.setAttribute('markerWidth', '6');
            marker.setAttribute('markerHeight', '6');
            marker.setAttribute('orient', 'auto');
            const tip = document.createElementNS(SVG, 'path');
            tip.setAttribute('d', 'M0,0 L10,5 L0,10 z');
            tip.setAttribute('class', `arrow ${type}`);
            marker.appendChild(tip);
            d.appendChild(marker);
        }
        return d;
    }

    // ---- Building the graph ---------------------------------------------------

    function label(n) {
        return n.type === 'concept' ? n.name : (n.title || n.path || n.id);
    }

    function build(graph, keepView) {
        const old = new Map(nodes.map(n => [n.id, n]));
        edgeLayer.textContent = '';
        nodeLayer.textContent = '';
        nodes = graph.nodes.map(g => {
            const prev = old.get(g.id);
            const n = {
                id: g.id, type: g.type, kind: g.kind, path: g.path, label: label(g),
                meta: g.type === 'concept' ? `concept tag · ${g.article_count} articles`
                    : g.type === 'source' ? `source · ${[g.key, g.source_type].filter(Boolean).join(' · ')}`
                    : `${g.kind || 'article'}${g.status ? ` · ${g.status}` : ''}`,
                x: prev ? prev.x : (Math.random() - 0.5) * 600,
                y: prev ? prev.y : (Math.random() - 0.5) * 600,
                vx: 0, vy: 0,
                r: g.type === 'concept' ? 3 + Math.sqrt(g.article_count || 1) : g.type === 'source' ? 4 : 6,
            };
            return n;
        });
        byId = new Map(nodes.map(n => [n.id, n]));
        edges = graph.edges
            .filter(e => byId.has(e.source) && byId.has(e.target))
            .map(e => ({ source: byId.get(e.source), target: byId.get(e.target), type: e.type }));
        neighbours = new Map(nodes.map(n => [n.id, new Set()]));
        for (const e of edges) {
            neighbours.get(e.source.id).add(e.target.id);
            neighbours.get(e.target.id).add(e.source.id);
        }
        for (const e of edges) {
            e.strength = STRENGTH[e.type]
                / Math.max(1, Math.min(neighbours.get(e.source.id).size, neighbours.get(e.target.id).size));
        }
        // Articles' degree sets their size a little.
        for (const n of nodes) {
            if (n.type === 'article') {
                n.r = 5 + Math.min(6, Math.sqrt(neighbours.get(n.id).size));
            }
        }

        for (const e of edges) {
            e.el = document.createElementNS(SVG, 'line');
            e.el.setAttribute('class', `edge ${e.type}`);
            if (e.type === 'link' || e.type === 'derivation') {
                e.el.setAttribute('marker-end', `url(#arrow-${e.type})`);
            }
            edgeLayer.appendChild(e.el);
        }
        for (const n of nodes) {
            n.el = nodeElement(n);
            nodeLayer.appendChild(n.el);
        }

        tagsOf = new Map(nodes.filter(n => n.type === 'article').map(n => [n.id, new Set()]));
        for (const e of edges) {
            if (e.type === 'concept') tagsOf.get(e.source.id)?.add(e.target.label);
        }
        tagNames.textContent = '';
        for (const n of nodes.filter(n => n.type === 'concept').sort((a, b) => a.label.localeCompare(b.label))) {
            const option = document.createElement('option');
            option.value = n.label;
            tagNames.appendChild(option);
        }

        titles.textContent = '';
        for (const n of [...nodes].sort((a, b) => a.label.localeCompare(b.label))) {
            const option = document.createElement('option');
            option.value = n.label;
            titles.appendChild(option);
        }

        applyVisibility();
        if (!keepView) {
            followFocus = true;
            view.scale = 0.8;
        }
        reheat(keepView ? 0.3 : 1);
    }

    function nodeElement(n) {
        const g = document.createElementNS(SVG, 'g');
        g.setAttribute('class', `node ${n.type === 'concept' ? 'tag' : n.type} ${n.kind || ''}`);
        let shape;
        if (n.type === 'article') {
            shape = document.createElementNS(SVG, 'circle');
            shape.setAttribute('r', n.r);
        } else {
            shape = document.createElementNS(SVG, 'rect');
            shape.setAttribute('x', -n.r);
            shape.setAttribute('y', -n.r);
            shape.setAttribute('width', 2 * n.r);
            shape.setAttribute('height', 2 * n.r);
            shape.setAttribute('rx', n.type === 'concept' ? n.r / 2 : 1);
        }
        const text = document.createElementNS(SVG, 'text');
        text.setAttribute('x', n.r + 4);
        text.setAttribute('y', 4);
        text.textContent = n.label.length > 60 ? `${n.label.slice(0, 57)}…` : n.label;
        g.append(shape, text);
        g.addEventListener('pointerenter', ev => { hoverId = n.id; highlight(); showTooltip(n, ev); });
        g.addEventListener('pointermove', ev => moveTooltip(ev));
        g.addEventListener('pointerleave', () => { hoverId = null; highlight(); tooltip.hidden = true; });
        g.addEventListener('pointerdown', ev => startNodeDrag(n, ev));
        return g;
    }

    function visible(n) {
        return (n.type !== 'concept' || showConcepts.checked) && (n.type !== 'source' || showSources.checked);
    }

    function filterActive() {
        return filter.searchPaths !== null || filter.tags.length > 0 || filter.types.size > 0;
    }

    function matches(n) {
        if (n.type !== 'article') return false;
        if (filter.types.size > 0 && !filter.types.has(n.kind)) return false;
        const tags = tagsOf.get(n.id);
        if (!filter.tags.every(t => tags.has(t))) return false;
        return filter.searchPaths === null || filter.searchPaths.has(n.path);
    }

    /** Ids of the nodes a filter shows, or null when no filter is set. */
    function filteredIds() {
        if (!filterActive()) return null;
        const matched = nodes.filter(matches).map(n => n.id);
        const shown = new Set(matched);
        if (withNeighbours.checked) {
            for (const id of matched) for (const other of neighbours.get(id)) shown.add(other);
        }
        for (const n of nodes) {
            if (n.type === 'concept' && filter.tags.includes(n.label)) shown.add(n.id);
        }
        return { shown, matched: new Set(matched) };
    }

    function applyVisibility() {
        const f = filteredIds();
        for (const n of nodes) {
            n.hidden = !visible(n) || (f !== null && !f.shown.has(n.id));
            n.el.classList.toggle('hidden', n.hidden);
            n.el.classList.toggle('match', f !== null && f.matched.has(n.id));
        }
        if (f !== null) {
            setStatus(`${f.matched.size} matching article${f.matched.size === 1 ? '' : 's'}`, f.matched.size === 0);
        } else if (nodes.length > 0) {
            const articles = nodes.filter(n => n.type === 'article').length;
            const concepts = nodes.filter(n => n.type === 'concept').length;
            setStatus(`${articles} articles · ${concepts} concepts · ${edges.length} edges`);
        }
        for (const e of edges) {
            e.hidden = e.source.hidden || e.target.hidden;
            e.el.classList.toggle('hidden', e.hidden);
        }
        highlight();
    }

    // ---- Layout ---------------------------------------------------------------

    function reheat(value) {
        alpha = Math.max(alpha, value);
        if (!running) {
            running = true;
            requestAnimationFrame(tick);
        }
    }

    function step() {
        const live = nodes.filter(n => !n.hidden);
        // Repulsion between every pair of visible nodes.
        for (let i = 0; i < live.length; i++) {
            const a = live[i];
            for (let j = i + 1; j < live.length; j++) {
                const b = live[j];
                let dx = a.x - b.x, dy = a.y - b.y;
                let d2 = dx * dx + dy * dy;
                if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
                if (d2 > 1000000) continue;
                const f = REPULSION * alpha / d2;
                const d = Math.sqrt(d2);
                const fx = dx / d * f, fy = dy / d * f;
                a.vx += fx; a.vy += fy;
                b.vx -= fx; b.vy -= fy;
            }
        }
        // Springs along edges.
        for (const e of edges) {
            if (e.hidden) continue;
            const a = e.source, b = e.target;
            const dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            // Half the correction to each end.
            const f = (d - LENGTH[e.type]) * e.strength * alpha * 0.5;
            const fx = dx / d * f, fy = dy / d * f;
            a.vx += fx; a.vy += fy;
            b.vx -= fx; b.vy -= fy;
        }
        for (const n of live) {
            n.vx -= n.x * GRAVITY * alpha;
            n.vy -= n.y * GRAVITY * alpha;
            if (n.fixed) {
                n.vx = n.vy = 0;
                continue;
            }
            n.vx *= 0.6; n.vy *= 0.6;
            const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
            if (speed > MAX_SPEED) {
                n.vx *= MAX_SPEED / speed;
                n.vy *= MAX_SPEED / speed;
            }
            n.x += n.vx; n.y += n.vy;
        }
    }

    function tick() {
        step();
        alpha *= 0.985;
        if (followFocus && focusId && byId.has(focusId)) {
            const f = byId.get(focusId);
            view.x = f.x;
            view.y = f.y;
        }
        render();
        if (alpha > 0.005) {
            requestAnimationFrame(tick);
        } else {
            alpha = 0;
            running = false;
            if (fitWhenSettled) {
                fitWhenSettled = false;
                fit();
            }
        }
    }

    function render() {
        const w = svg.clientWidth, h = svg.clientHeight;
        root.setAttribute('transform',
            `translate(${w / 2},${h / 2}) scale(${view.scale}) translate(${-view.x},${-view.y})`);
        svg.classList.toggle('zoomed', view.scale >= LABEL_ZOOM);
        for (const e of edges) {
            if (e.hidden) continue;
            // Stop arrows at the target's edge.
            const dx = e.target.x - e.source.x, dy = e.target.y - e.source.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            const back = e.type === 'link' || e.type === 'derivation' ? e.target.r + 2 : 0;
            e.el.setAttribute('x1', e.source.x);
            e.el.setAttribute('y1', e.source.y);
            e.el.setAttribute('x2', e.target.x - dx / d * back);
            e.el.setAttribute('y2', e.target.y - dy / d * back);
        }
        for (const n of nodes) {
            if (!n.hidden) n.el.setAttribute('transform', `translate(${n.x},${n.y})`);
        }
    }

    // ---- Highlighting and focus -------------------------------------------------

    function highlight() {
        const centre = hoverId || focusId;
        const lit = new Set(centre ? [centre, ...(neighbours.get(centre) || [])] : []);
        svg.classList.toggle('highlighting', lit.size > 0);
        for (const n of nodes) {
            n.el.classList.toggle('lit', lit.has(n.id));
            n.el.classList.toggle('focus', n.id === focusId);
        }
        for (const e of edges) {
            e.el.classList.toggle('lit', !!centre && (e.source.id === centre || e.target.id === centre));
        }
    }

    function focus(id, animate) {
        if (!byId.has(id)) return;
        focusId = id;
        highlight();
        const n = byId.get(id);
        if (byId.get(id).hidden && n.type === 'concept') {
            showConcepts.checked = true;
            applyVisibility();
        }
        followFocus = true;
        if (animate) {
            panTo(n.x, n.y);
        } else {
            view.x = n.x;
            view.y = n.y;
            render();
        }
    }

    function panTo(x, y) {
        const x0 = view.x, y0 = view.y;
        const start = performance.now();
        const frame = now => {
            const t = Math.min(1, (now - start) / 300);
            const ease = t * (2 - t);
            view.x = x0 + (x - x0) * ease;
            view.y = y0 + (y - y0) * ease;
            render();
            if (t < 1) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }

    function fit() {
        const live = nodes.filter(n => !n.hidden);
        if (live.length === 0) return;
        const xs = live.map(n => n.x), ys = live.map(n => n.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        followFocus = false;
        view.x = (minX + maxX) / 2;
        view.y = (minY + maxY) / 2;
        view.scale = Math.min(svg.clientWidth / (maxX - minX + 80), svg.clientHeight / (maxY - minY + 80), 2);
        render();
    }

    // ---- Interaction ------------------------------------------------------------

    function toWorld(clientX, clientY) {
        const rect = svg.getBoundingClientRect();
        return {
            x: (clientX - rect.left - rect.width / 2) / view.scale + view.x,
            y: (clientY - rect.top - rect.height / 2) / view.scale + view.y,
        };
    }

    let drag = null;

    function startNodeDrag(n, ev) {
        ev.stopPropagation();
        if (ev.button !== 0) return;
        drag = { node: n, startX: ev.clientX, startY: ev.clientY, moved: false };
    }

    svg.addEventListener('pointerdown', ev => {
        if (ev.button !== 0) return;
        drag = { pan: true, startX: ev.clientX, startY: ev.clientY, viewX: view.x, viewY: view.y, moved: false };
        svg.classList.add('panning');
    });

    window.addEventListener('pointermove', ev => {
        if (!drag) return;
        const dx = ev.clientX - drag.startX, dy = ev.clientY - drag.startY;
        if (!drag.moved && dx * dx + dy * dy < 9) return;
        drag.moved = true;
        if (drag.pan) {
            followFocus = false;
            view.x = drag.viewX - dx / view.scale;
            view.y = drag.viewY - dy / view.scale;
            render();
        } else {
            const p = toWorld(ev.clientX, ev.clientY);
            drag.node.fixed = true;
            drag.node.x = p.x;
            drag.node.y = p.y;
            reheat(0.2);
            render();
        }
    });

    window.addEventListener('pointerup', ev => {
        svg.classList.remove('panning');
        const d = drag;
        drag = null;
        if (!d) return;
        if (d.node) {
            d.node.fixed = false;
            if (!d.moved) activate(d.node, ev);
        }
    });

    /** A click: open an article or source; filter by a concept tag. */
    function activate(n) {
        if (n.path) {
            focus(n.id, true);
            vscode.postMessage({ type: 'open', path: n.path });
        } else if (n.type === 'concept') {
            addTagFilter(n.label);
        }
    }

    /** Zoom by `factor`, keeping the point at (clientX, clientY) (default: the centre) in place. */
    function zoom(factor, clientX, clientY) {
        const rect = svg.getBoundingClientRect();
        const cx = clientX ?? rect.left + rect.width / 2, cy = clientY ?? rect.top + rect.height / 2;
        const before = toWorld(cx, cy);
        view.scale = Math.min(8, Math.max(0.05, view.scale * factor));
        const after = toWorld(cx, cy);
        view.x += before.x - after.x;
        view.y += before.y - after.y;
        render();
    }

    // Mouse wheel, trackpad scroll and pinch (which arrives as a wheel event with ctrlKey) all zoom.
    svg.addEventListener('wheel', ev => {
        ev.preventDefault();
        const delta = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
        followFocus = false;
        zoom(Math.exp(-delta * (ev.ctrlKey ? 0.01 : 0.002)), ev.clientX, ev.clientY);
    }, { passive: false });

    function showTooltip(n, ev) {
        tooltip.textContent = '';
        const title = document.createElement('div');
        title.textContent = n.label;
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = `${n.meta} · ${neighbours.get(n.id).size} connections`;
        const hint = document.createElement('div');
        hint.className = 'meta';
        hint.textContent = n.path ? 'Click to open'
            : filter.tags.includes(n.label) ? 'Already a tag filter' : 'Click to show only articles with this tag';
        tooltip.append(title, meta, hint);
        tooltip.hidden = false;
        moveTooltip(ev);
    }

    function moveTooltip(ev) {
        tooltip.style.left = `${Math.min(ev.clientX + 14, window.innerWidth - tooltip.offsetWidth - 4)}px`;
        tooltip.style.top = `${Math.min(ev.clientY + 14, window.innerHeight - tooltip.offsetHeight - 4)}px`;
    }

    function setStatus(text, error) {
        status.textContent = text;
        status.classList.toggle('error', !!error);
    }

    find.addEventListener('change', () => {
        const query = find.value.trim().toLowerCase();
        if (!query) return;
        const match = nodes.find(n => n.label.toLowerCase() === query)
            || nodes.find(n => n.label.toLowerCase().includes(query));
        if (match) {
            if (match.type === 'source' && match.hidden) {
                showSources.checked = true;
                applyVisibility();
            }
            focus(match.id, true);
        } else {
            setStatus(`Nothing matches "${find.value}"`, true);
        }
    });

    showConcepts.addEventListener('change', () => { applyVisibility(); reheat(0.5); });
    showSources.addEventListener('change', () => { applyVisibility(); reheat(0.5); });
    showLabels.addEventListener('change', () => svg.classList.toggle('labels', showLabels.checked));
    document.getElementById('center').addEventListener('click', () => focusId && focus(focusId, true));
    document.getElementById('fit').addEventListener('click', fit);
    document.getElementById('reload').addEventListener('click', () => {
        setStatus('Reloading…');
        vscode.postMessage({ type: 'refresh' });
    });

    document.getElementById('zoomIn').addEventListener('click', () => zoom(1.4));
    document.getElementById('zoomOut').addEventListener('click', () => zoom(1 / 1.4));

    document.addEventListener('keydown', ev => {
        if (ev.target instanceof HTMLInputElement) return;
        if (ev.key === '+' || ev.key === '=') zoom(1.4);
        else if (ev.key === '-' || ev.key === '_') zoom(1 / 1.4);
        else if (ev.key === 'f') fit();
        else if (ev.key === 'c' && focusId) focus(focusId, true);
    });

    // ---- Filter controls ----------------------------------------------------------

    function filterChanged() {
        applyVisibility();
        reheat(0.3);
        if (filterActive()) setTimeout(fit, 50);
    }

    function runSearch() {
        filter.query = queryInput.value.trim();
        if (!filter.query) {
            filter.searchPaths = null;
            searchId++;
            filterChanged();
            return;
        }
        setStatus(`Searching for "${filter.query}"…`);
        vscode.postMessage({
            type: 'search', id: ++searchId, query: filter.query, tags: filter.tags, types: [...filter.types],
        });
    }

    function renderChips() {
        tagChips.textContent = '';
        for (const tag of filter.tags) {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = tag;
            const remove = document.createElement('button');
            remove.textContent = '×';
            remove.title = `Remove ${tag}`;
            remove.addEventListener('click', () => {
                filter.tags = filter.tags.filter(t => t !== tag);
                renderChips();
                refilter();
            });
            chip.appendChild(remove);
            tagChips.appendChild(chip);
        }
    }

    /** Tags or types changed: rerun the search (it takes them too) or just reapply. */
    function refilter() {
        if (filter.query) runSearch();
        else filterChanged();
    }

    queryInput.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') runSearch();
    });
    queryInput.addEventListener('search', () => {
        if (!queryInput.value) runSearch(); // The clear (x) button.
    });

    tagInput.addEventListener('change', () => {
        const name = tagInput.value.trim();
        const tag = nodes.find(n => n.type === 'concept' && n.label.toLowerCase() === name.toLowerCase());
        tagInput.value = '';
        if (!tag) {
            if (name) setStatus(`No tag "${name}"`, true);
            return;
        }
        addTagFilter(tag.label);
    });

    function addTagFilter(tag) {
        if (!filter.tags.includes(tag)) {
            filter.tags.push(tag);
            renderChips();
            refilter();
        }
    }

    for (const box of typeBoxes) {
        box.addEventListener('change', () => {
            filter.types = new Set(typeBoxes.filter(b => b.checked).map(b => b.dataset.type));
            refilter();
        });
    }

    withNeighbours.addEventListener('change', filterChanged);

    document.getElementById('clearFilter').addEventListener('click', () => {
        queryInput.value = '';
        filter.query = '';
        filter.searchPaths = null;
        filter.tags = [];
        filter.types = new Set();
        typeBoxes.forEach(b => { b.checked = false; });
        searchId++;
        renderChips();
        filterChanged();
    });

    window.addEventListener('resize', render);

    window.addEventListener('message', ev => {
        const message = ev.data;
        switch (message.type) {
            case 'graph':
                build(message.graph, message.keepView);
                if (message.focus) {
                    focusId = message.focus;
                    highlight();
                } else if (!message.keepView) {
                    focusId = null;
                    followFocus = false;
                    view.x = view.y = 0;
                    view.scale = 0.4;
                    fitWhenSettled = true;
                    highlight();
                }
                break;
            case 'focus':
                focus(message.id, true);
                break;
            case 'error':
                setStatus(message.message, true);
                break;
            case 'searchResults':
                if (message.id !== searchId) break; // A newer search is running.
                if (message.error) {
                    setStatus(message.error, true);
                    break;
                }
                filter.searchPaths = new Set(message.paths);
                filterChanged();
                break;
        }
    });

    vscode.postMessage({ type: 'ready' });
}());
