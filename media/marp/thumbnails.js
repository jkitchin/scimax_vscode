// @ts-check
/**
 * Scimax Marp slide thumbnails (webview side), for both the Marp Slides
 * sidebar view and the Slide Sorter tab.
 *
 * Receives Marp's rendered HTML and CSS from src/marp/slideThumbnailView.ts,
 * wraps each slide's <svg data-marpit-svg> in its own numbered card, lays the
 * cards out in a grid whose thumbnail width is set by the zoom control, and
 * keeps a selection of cards (click, Cmd/Ctrl-click, Shift-click, arrow keys).
 *
 * In slide mode only one card is shown, fitted to the view: the slide under
 * the editor cursor, or the one stepped to with the arrow keys. This is the
 * slide preview.
 *
 * Double-click, the context menu (contributed by the extension through each
 * card's data-vscode-context), drag and drop and the keyboard shortcuts below
 * all send the selection to the extension, which edits the Markdown.
 */
(function () {
    'use strict';

    // @ts-ignore acquireVsCodeApi is provided by the webview host.
    const vscode = acquireVsCodeApi();
    const body = document.body;
    const container = /** @type {HTMLElement} */ (document.getElementById('slides'));
    const status = /** @type {HTMLElement} */ (document.getElementById('status'));
    const count = /** @type {HTMLElement} */ (document.getElementById('count'));
    const zoomInput = /** @type {HTMLInputElement} */ (document.getElementById('zoom'));
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const surface = body.dataset.surface || 'sidebar';

    const ZOOM_MIN = Number(body.dataset.zoomMin) || 80;
    const ZOOM_MAX = Number(body.dataset.zoomMax) || 640;
    const ZOOM_DEFAULT = Number(body.dataset.zoomDefault) || 240;
    const ZOOM_STEP = 1.2;

    /** Marp's theme CSS, replaced on every render. */
    const themeStyle = document.createElement('style');
    document.head.appendChild(themeStyle);

    /** Relative image paths in the deck resolve against the deck's folder. */
    const base = document.createElement('base');
    document.head.appendChild(base);

    /** @type {Set<number>} */
    let selected = new Set();
    /** Card that keyboard navigation and Shift-click ranges start from. */
    let anchor = -1;
    /** Card that has keyboard focus. */
    let focus = -1;
    /** 'grid' or 'slide'. */
    let mode = body.dataset.mode === 'slide' ? 'slide' : 'grid';
    /** Card shown in slide mode. */
    let shown = 0;
    /** Deck name and slide count for the toolbar. */
    let deckTitle = '';
    let hiddenCount = 0;

    function cards() {
        return /** @type {HTMLElement[]} */ (Array.from(container.children));
    }

    // -------------------------------------------------------------------------
    // Zoom
    // -------------------------------------------------------------------------

    let zoomTimer = 0;

    /**
     * @param {number} width thumbnail width in pixels
     * @param {boolean} [save] remember it (in the extension, per surface)
     */
    function setZoom(width, save = true) {
        const clamped = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, width)));
        body.style.setProperty('--thumb-width', `${clamped}px`);
        zoomInput.value = String(clamped);
        if (save) {
            clearTimeout(zoomTimer);
            zoomTimer = window.setTimeout(() => vscode.postMessage({ type: 'zoom', width: clamped }), 300);
        }
        if (focus >= 0) {
            scrollToCard(focus);
        }
    }

    /** @param {number} factor */
    function zoomBy(factor) {
        setZoom(Number(zoomInput.value) * factor);
    }

    setZoom(Number(body.dataset.zoom) || ZOOM_DEFAULT, false);
    zoomInput.addEventListener('input', () => setZoom(Number(zoomInput.value)));
    /** @type {HTMLElement} */ (document.getElementById('zoomIn')).addEventListener('click', () => zoomBy(ZOOM_STEP));
    /** @type {HTMLElement} */ (document.getElementById('zoomOut')).addEventListener('click', () => zoomBy(1 / ZOOM_STEP));

    // Pinch on a trackpad arrives as Ctrl+wheel.
    window.addEventListener('wheel', event => {
        if (event.ctrlKey) {
            event.preventDefault();
            setZoom(Number(zoomInput.value) * Math.exp(-event.deltaY / 200));
        }
    }, { passive: false });

    // -------------------------------------------------------------------------
    // Grid or single slide
    // -------------------------------------------------------------------------

    function updateCount() {
        const total = cards().length;
        if (total === 0) {
            count.textContent = '';
        } else if (mode === 'slide') {
            count.textContent = `Slide ${shown + 1} of ${total}` + (cards()[shown]?.classList.contains('hidden-slide') ? ' (hidden)' : '');
        } else {
            count.textContent = `${deckTitle}: ${total} slide${total === 1 ? '' : 's'}`
                + (hiddenCount > 0 ? ` (${hiddenCount} hidden)` : '');
        }
    }

    /** @param {number} index */
    function showSlide(index) {
        const all = cards();
        if (all.length === 0) {
            return;
        }
        shown = Math.max(0, Math.min(all.length - 1, index));
        all.forEach((card, i) => card.classList.toggle('shown', i === shown));
        updateCount();
    }

    /**
     * @param {string} next 'grid' or 'slide'
     * @param {boolean} [save] remember it (in the extension, per surface)
     */
    function setMode(next, save = true) {
        mode = next === 'slide' ? 'slide' : 'grid';
        body.classList.toggle('slide-mode', mode === 'slide');
        body.classList.toggle('grid-mode', mode === 'grid');
        /** @type {HTMLElement} */ (document.getElementById('modeGrid')).classList.toggle('on', mode === 'grid');
        /** @type {HTMLElement} */ (document.getElementById('modeSlide')).classList.toggle('on', mode === 'slide');
        if (mode === 'slide') {
            showSlide(focus >= 0 ? focus : shown);
        } else {
            updateCount();
            if (focus >= 0) {
                scrollToCard(focus);
            }
        }
        if (save) {
            vscode.postMessage({ type: 'mode', mode });
        }
    }

    /** @param {number} delta */
    function stepSlide(delta) {
        const total = cards().length;
        if (total > 0) {
            selectCard(Math.max(0, Math.min(total - 1, shown + delta)));
        }
    }

    /** @type {HTMLElement} */ (document.getElementById('modeGrid')).addEventListener('click', () => setMode('grid'));
    /** @type {HTMLElement} */ (document.getElementById('modeSlide')).addEventListener('click', () => setMode('slide'));
    /** @type {HTMLElement} */ (document.getElementById('prev')).addEventListener('click', () => stepSlide(-1));
    /** @type {HTMLElement} */ (document.getElementById('next')).addEventListener('click', () => stepSlide(1));

    // -------------------------------------------------------------------------
    // Selection
    // -------------------------------------------------------------------------

    /** @param {string} text */
    function showStatus(text) {
        status.textContent = text;
        status.hidden = false;
        count.textContent = '';
        container.replaceChildren();
        selected = new Set();
        anchor = focus = -1;
    }

    function selection() {
        return Array.from(selected).sort((a, b) => a - b);
    }

    function paintSelection() {
        cards().forEach((card, i) => {
            const isSelected = selected.has(i);
            card.classList.toggle('selected', isSelected);
            card.classList.toggle('focused', i === focus);
            card.setAttribute('aria-selected', String(isSelected));
        });
    }

    /**
     * @param {number[]} indices
     * @param {boolean} [notify] tell the extension (not needed when it sent the selection)
     */
    function setSelection(indices, notify = true) {
        const total = cards().length;
        selected = new Set(indices.filter(i => i >= 0 && i < total));
        paintSelection();
        if (notify) {
            vscode.postMessage({ type: 'select', indices: selection() });
        }
    }

    /** @param {number} index */
    function scrollToCard(index) {
        const card = cards()[index];
        if (card) {
            card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    /**
     * Mark the slide under the editor cursor.
     * @param {number} index
     */
    function setActive(index) {
        cards().forEach((card, i) => card.classList.toggle('active', i === index));
        if (mode === 'slide' && index >= 0) {
            // The preview follows the editor cursor.
            focus = anchor = index;
            setSelection([index]);
            showSlide(index);
        } else {
            scrollToCard(index);
        }
    }

    /**
     * @param {number} index
     * @param {{toggle?: boolean, range?: boolean}} [mode]
     */
    function selectCard(index, mode = {}) {
        if (mode.range && anchor >= 0) {
            const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
            const range = [];
            for (let i = from; i <= to; i++) {
                range.push(i);
            }
            setSelection(mode.toggle ? [...selected, ...range] : range);
        } else if (mode.toggle) {
            const next = new Set(selected);
            if (next.has(index)) {
                next.delete(index);
            } else {
                next.add(index);
            }
            setSelection(Array.from(next));
            anchor = index;
        } else {
            setSelection([index]);
            anchor = index;
        }
        focus = index;
        paintSelection();
        scrollToCard(index);
        if (mode === 'slide') {
            showSlide(index);
        }
    }

    /** Number of cards in a row of the grid. */
    function columns() {
        const all = cards();
        if (all.length === 0) {
            return 1;
        }
        const top = all[0].offsetTop;
        let n = 0;
        while (n < all.length && all[n].offsetTop === top) {
            n++;
        }
        return Math.max(1, n);
    }

    /** @param {string} command */
    function send(command) {
        vscode.postMessage({ type: 'command', command, indices: selection() });
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------

    /**
     * @param {{html: string, css: string, hidden: boolean[], baseUri: string, uri: string,
     *          title: string, active: number, selection: number[]}} message
     */
    function render(message) {
        if (message.baseUri) {
            base.href = message.baseUri;
        } else {
            base.removeAttribute('href');
        }
        themeStyle.textContent = message.css;
        // Lets VS Code reopen the sorter on this deck after a reload.
        vscode.setState({ uri: message.uri });

        const parsed = document.createElement('div');
        parsed.innerHTML = message.html;
        const svgs = parsed.querySelectorAll(':scope > .marpit > svg[data-marpit-svg]');

        const newCards = Array.from(svgs, (svg, index) => {
            const hidden = Boolean(message.hidden[index]);
            const card = document.createElement('div');
            card.className = hidden ? 'thumb hidden-slide' : 'thumb';
            card.dataset.index = String(index);
            card.draggable = true;
            card.setAttribute('role', 'option');
            card.title = `Slide ${index + 1}${hidden ? ' (hidden)' : ''}: double-click to edit, drag to move`;
            // Slide mode fits the slide to the view by its aspect ratio.
            const viewBox = (svg.getAttribute('viewBox') || '0 0 1280 720').split(/\s+/).map(Number);
            if (viewBox[2] > 0 && viewBox[3] > 0) {
                card.style.setProperty('--aspect', String(viewBox[2] / viewBox[3]));
            }
            card.dataset.vscodeContext = JSON.stringify({
                webviewSection: 'slide',
                surface,
                slideIndex: index,
                slideHidden: hidden,
                preventDefaultContextMenuItems: true,
            });

            // Marp's CSS is scoped to div.marpit, so each slide keeps that wrapper.
            const frame = document.createElement('div');
            frame.className = 'marpit frame';
            frame.appendChild(svg);
            if (hidden) {
                const badge = document.createElement('span');
                badge.className = 'badge';
                badge.textContent = 'hidden';
                frame.appendChild(badge);
            }

            const number = document.createElement('span');
            number.className = 'number';
            number.textContent = String(index + 1);

            card.append(frame, number);
            return card;
        });

        status.hidden = newCards.length > 0;
        if (newCards.length === 0) {
            status.textContent = 'This deck has no slides.';
        }
        hiddenCount = message.hidden.filter(Boolean).length;
        deckTitle = message.title;

        const scrollTop = document.scrollingElement ? document.scrollingElement.scrollTop : 0;
        container.replaceChildren(...newCards);
        if (document.scrollingElement) {
            document.scrollingElement.scrollTop = scrollTop;
        }

        setSelection(message.selection, false);
        const current = selection();
        if (current.length > 0 && !selected.has(focus)) {
            focus = anchor = current[0];
        } else if (focus >= newCards.length) {
            focus = anchor = newCards.length - 1;
        }
        paintSelection();
        if (mode === 'slide') {
            // Keep showing the same slide across re-renders while typing.
            showSlide(current.length > 0 ? focus : (message.active >= 0 ? message.active : shown));
            cards().forEach((card, i) => card.classList.toggle('active', i === message.active));
        } else {
            setActive(message.active);
            if (current.length > 0) {
                scrollToCard(focus);
            }
        }
        updateCount();
    }

    // -------------------------------------------------------------------------
    // Mouse
    // -------------------------------------------------------------------------

    /** @param {Event} event */
    function cardOf(event) {
        return /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('.thumb'));
    }

    /** @param {Event} event */
    function cardIndex(event) {
        const card = cardOf(event);
        return card ? Number(card.dataset.index) : -1;
    }

    container.addEventListener('click', event => {
        const index = cardIndex(event);
        if (index >= 0) {
            selectCard(index, { toggle: isMac ? event.metaKey : event.ctrlKey, range: event.shiftKey });
        }
    });

    container.addEventListener('dblclick', event => {
        const index = cardIndex(event);
        if (index >= 0) {
            event.preventDefault();
            vscode.postMessage({ type: 'goto', slide: index });
        }
    });

    // Right-clicking outside the selection selects just that card, so the
    // menu acts on what was clicked (as in the Explorer).
    document.addEventListener('contextmenu', event => {
        const index = cardIndex(event);
        if (index >= 0 && !selected.has(index)) {
            selectCard(index);
        }
    }, true);

    // -------------------------------------------------------------------------
    // Drag and drop
    // -------------------------------------------------------------------------

    const DRAG_TYPE = 'application/x-scimax-marp-slides';
    /** Position the dragged slides would be dropped at, or -1. */
    let dropTarget = -1;

    function clearDropMarker() {
        container.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
        dropTarget = -1;
    }

    container.addEventListener('dragstart', event => {
        const index = cardIndex(event);
        if (index < 0 || !event.dataTransfer) {
            return;
        }
        if (!selected.has(index)) {
            selectCard(index);
        }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(selection()));
        body.classList.add('dragging');
        // Drop markers go between rows in a single column, between cards in a grid.
        body.classList.toggle('single-column', columns() === 1);
    });

    container.addEventListener('dragover', event => {
        if (!event.dataTransfer || !event.dataTransfer.types.includes(DRAG_TYPE)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const all = cards();
        const card = cardOf(event);
        let target;
        let marker;
        let after = false;
        if (card) {
            const rect = card.getBoundingClientRect();
            // In a grid, left or right half; in a single column, top or bottom half.
            after = columns() > 1
                ? event.clientX > rect.left + rect.width / 2
                : event.clientY > rect.top + rect.height / 2;
            const index = Number(card.dataset.index);
            target = after ? index + 1 : index;
            marker = card;
        } else {
            // Past the last card: drop at the end.
            target = all.length;
            marker = all[all.length - 1];
            after = true;
        }
        if (target !== dropTarget) {
            clearDropMarker();
            dropTarget = target;
            if (marker) {
                marker.classList.add(after ? 'drop-after' : 'drop-before');
            }
        }
    });

    container.addEventListener('dragleave', event => {
        if (!container.contains(/** @type {Node | null} */ (event.relatedTarget))) {
            clearDropMarker();
        }
    });

    container.addEventListener('drop', event => {
        if (!event.dataTransfer || !event.dataTransfer.types.includes(DRAG_TYPE)) {
            return;
        }
        event.preventDefault();
        const target = dropTarget;
        clearDropMarker();
        if (target >= 0) {
            vscode.postMessage({ type: 'moveTo', indices: selection(), target });
        }
    });

    container.addEventListener('dragend', () => {
        clearDropMarker();
        body.classList.remove('dragging');
    });

    // -------------------------------------------------------------------------
    // Keyboard
    // -------------------------------------------------------------------------

    /**
     * Keyboard shortcuts while the view has focus. Mod is Cmd on macOS and
     * Ctrl elsewhere. Returns the operation to send, or null.
     *
     * @param {KeyboardEvent} e
     */
    function shortcut(e) {
        const mod = isMac ? e.metaKey : e.ctrlKey;
        // Letters by physical key: with Option held, macOS changes e.key (V gives √).
        const key = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key;
        if (mod && e.altKey && key === 'v') { return 'pasteBefore'; }
        if (e.altKey && !mod && (key === 'ArrowUp' || key === 'ArrowLeft')) { return 'moveUp'; }
        if (e.altKey && !mod && (key === 'ArrowDown' || key === 'ArrowRight')) { return 'moveDown'; }
        if (e.altKey) { return null; }
        if (mod && e.shiftKey && key === 'Enter') { return 'insertBefore'; }
        if (mod && e.shiftKey && key === 'z') { return 'redo'; }
        if (e.shiftKey) { return null; }
        if (mod) {
            return ({ c: 'copy', x: 'cut', v: 'pasteAfter', d: 'duplicate', Enter: 'insertAfter', z: 'undo', y: 'redo' })[key] || null;
        }
        return ({ Delete: 'delete', Backspace: 'delete', Enter: 'gotoSource', h: 'toggleHidden' })[key] || null;
    }

    window.addEventListener('keydown', event => {
        if (event.target === zoomInput && event.key.startsWith('Arrow')) {
            return;
        }
        const total = cards().length;
        const mod = isMac ? event.metaKey : event.ctrlKey;

        if (!mod && !event.altKey && event.code === 'KeyV' && !event.shiftKey) {
            event.preventDefault();
            setMode(mode === 'grid' ? 'slide' : 'grid');
            return;
        }

        // In slide mode every arrow (and Space, Page Up/Down) steps one slide.
        if (mode === 'slide' && !mod && !event.altKey && !event.shiftKey) {
            const delta = { ArrowLeft: -1, ArrowUp: -1, PageUp: -1, ArrowRight: 1, ArrowDown: 1, PageDown: 1, ' ': 1 }[event.key];
            if (delta !== undefined) {
                event.preventDefault();
                stepSlide(delta);
                return;
            }
        }

        // Zoom: plain + - 0, since Cmd+= and Cmd+- zoom the whole window.
        if (!mod && !event.altKey && mode === 'grid') {
            if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(ZOOM_STEP); return; }
            if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomBy(1 / ZOOM_STEP); return; }
            if (event.key === '0') { event.preventDefault(); setZoom(ZOOM_DEFAULT); return; }
        }

        // Moving the selection: left/right by slide, up/down by row.
        const row = columns();
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -row, ArrowDown: row, Home: -Infinity, End: Infinity }[event.key];
        if (step !== undefined && !event.altKey && !mod && total > 0) {
            event.preventDefault();
            const from = focus >= 0 ? focus : (step > 0 ? -1 : total);
            const to = Math.max(0, Math.min(total - 1, from + step));
            selectCard(to, { range: event.shiftKey });
            return;
        }
        if (mod && !event.shiftKey && !event.altKey && event.code === 'KeyA' && total > 0) {
            event.preventDefault();
            setSelection(cards().map((_, i) => i));
            return;
        }

        const operation = shortcut(event);
        if (!operation) {
            return;
        }
        const needsSelection = !['pasteAfter', 'pasteBefore', 'insertAfter', 'insertBefore', 'undo', 'redo'].includes(operation);
        if (needsSelection && selected.size === 0) {
            return;
        }
        event.preventDefault();
        send(operation);
    });

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message && message.type) {
            case 'render':
                render(message);
                break;
            case 'active':
                setActive(message.index);
                break;
            case 'setMode':
                setMode(message.mode, false);
                break;
            case 'empty':
                showStatus('Open a Marp deck (front matter marp: true) to see its slides.');
                break;
            case 'error':
                showStatus(`Could not render slides: ${message.message}`);
                break;
        }
    });

    setMode(mode, false);
    vscode.postMessage({ type: 'ready' });
})();
