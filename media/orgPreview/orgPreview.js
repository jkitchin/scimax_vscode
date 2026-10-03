// Scimax org preview webview script.
// Loaded before MathJax so it can configure it; everything touching the DOM
// waits for DOMContentLoaded.
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();

    window.MathJax = {
        tex: { inlineMath: [['\\(', '\\)']], displayMath: [['\\[', '\\]']] },
        options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] },
    };

    function readInitialState() {
        const meta = document.getElementById('org-preview-state');
        let state = {};
        try {
            state = JSON.parse(meta ? meta.getAttribute('data-state') || '{}' : '{}');
        } catch {
            state = {};
        }
        const saved = vscode.getState() || {};
        return Object.assign({}, state, saved.line !== undefined ? { line: saved.line } : {});
    }

    const settings = readInitialState();
    let currentLine = typeof settings.line === 'number' ? settings.line : 0;

    // ------------------------------------------------------------------
    // Theme: swap the highlight.js stylesheet with the VS Code theme
    // ------------------------------------------------------------------
    function applyCodeTheme() {
        const dark = document.body.classList.contains('vscode-dark') ||
            document.body.classList.contains('vscode-high-contrast');
        const light = document.getElementById('hljs-light');
        const darkSheet = document.getElementById('hljs-dark');
        if (light) { light.disabled = dark; }
        if (darkSheet) { darkSheet.disabled = !dark; }
    }

    // ------------------------------------------------------------------
    // Rendering helpers
    // ------------------------------------------------------------------
    function highlightCode(root) {
        if (!window.hljs) { return; }
        root.querySelectorAll('pre code').forEach(block => {
            if (block.dataset.highlighted) { delete block.dataset.highlighted; }
            try { window.hljs.highlightElement(block); } catch { /* unknown language */ }
        });
    }

    function typesetMath(root) {
        const mj = window.MathJax;
        if (mj && typeof mj.typesetPromise === 'function') {
            if (typeof mj.typesetClear === 'function') { mj.typesetClear([root]); }
            return mj.typesetPromise([root]).catch(() => { /* ignore bad TeX */ });
        }
        return Promise.resolve();
    }

    // ------------------------------------------------------------------
    // Scroll sync: map source lines <-> vertical offsets using data-line
    // ------------------------------------------------------------------
    function lineMarkers() {
        const markers = [];
        document.querySelectorAll('[data-line]').forEach(el => {
            const line = parseInt(el.getAttribute('data-line'), 10);
            if (isNaN(line)) { return; }
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0 && el.offsetParent === null) { return; }
            markers.push({ line, top: rect.top + window.scrollY });
        });
        markers.sort((a, b) => a.line - b.line || a.top - b.top);
        return markers;
    }

    function offsetForLine(line) {
        const markers = lineMarkers();
        if (markers.length === 0) { return 0; }
        let prev = null;
        let next = null;
        for (const m of markers) {
            if (m.line <= line) { prev = m; } else { next = m; break; }
        }
        if (!prev) { return 0; }
        if (!next || next.line === prev.line) { return prev.top; }
        const frac = (line - prev.line) / (next.line - prev.line);
        return prev.top + frac * Math.max(0, next.top - prev.top);
    }

    function lineForOffset(offset) {
        const markers = lineMarkers().sort((a, b) => a.top - b.top);
        if (markers.length === 0) { return 0; }
        let prev = null;
        let next = null;
        for (const m of markers) {
            if (m.top <= offset) { prev = m; } else { next = m; break; }
        }
        if (!prev) { return Math.max(0, markers[0].line - 1); }
        if (!next || next.top === prev.top || next.line <= prev.line) { return prev.line; }
        const frac = (offset - prev.top) / (next.top - prev.top);
        return prev.line + frac * (next.line - prev.line);
    }

    // Programmatic scrolls should not be echoed back to the editor
    let ignoreScrollUntil = 0;

    function scrollToLine(line) {
        currentLine = line;
        vscode.setState({ uri: settings.uri, line });
        ignoreScrollUntil = Date.now() + 150;
        window.scrollTo(0, Math.max(0, offsetForLine(line) - 10));
    }

    let scrollTimer = null;
    function onScroll() {
        if (Date.now() < ignoreScrollUntil) { return; }
        if (scrollTimer) { return; }
        scrollTimer = setTimeout(() => {
            scrollTimer = null;
            if (Date.now() < ignoreScrollUntil) { return; }
            const line = lineForOffset(window.scrollY + 10);
            currentLine = line;
            vscode.setState({ uri: settings.uri, line });
            if (settings.scrollEditorWithPreview) {
                vscode.postMessage({ type: 'revealLine', line });
            }
        }, 50);
    }

    // ------------------------------------------------------------------
    // Links and double-click
    // ------------------------------------------------------------------
    function onClick(event) {
        const anchor = event.target.closest ? event.target.closest('a[href]') : null;
        if (!anchor) { return; }
        const href = anchor.getAttribute('href') || '';
        event.preventDefault();
        if (href.startsWith('#')) {
            const id = decodeURIComponent(href.slice(1));
            const target = document.getElementById(id) ||
                document.querySelector(`[name="${CSS.escape(id)}"]`);
            if (target) { jumpTo(target); }
            return;
        }
        vscode.postMessage({ type: 'openLink', href });
    }

    // ------------------------------------------------------------------
    // Jump history: links within the page (citations, references, footnotes)
    // remember where they were followed from. Back (the button, Cmd+[ or
    // Cmd+Left, Ctrl+[ or Ctrl+Left elsewhere, or Backspace) returns there.
    // ------------------------------------------------------------------
    const jumps = [];
    let backButton = null;

    function updateBackButton() {
        if (backButton) { backButton.hidden = jumps.length === 0; }
    }

    function jumpTo(target) {
        jumps.push(window.scrollY);
        if (jumps.length > 100) { jumps.shift(); }
        target.scrollIntoView();
        target.classList.remove('org-jump-target');
        void target.offsetWidth; // restart the highlight animation
        target.classList.add('org-jump-target');
        updateBackButton();
    }

    function goBack() {
        if (jumps.length === 0) { return false; }
        window.scrollTo(0, jumps.pop());
        updateBackButton();
        return true;
    }

    function onKeyDown(event) {
        const mod = event.metaKey || event.ctrlKey;
        const back = (mod && !event.altKey && !event.shiftKey && (event.key === '[' || event.key === 'ArrowLeft'))
            || (event.key === 'Backspace' && !mod && !event.altKey && !event.shiftKey);
        if (back && goBack()) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    function onDoubleClick(event) {
        const line = lineForOffset(event.pageY);
        vscode.postMessage({ type: 'gotoLine', line: Math.floor(line) });
    }

    // ------------------------------------------------------------------
    // Messages from the extension
    // ------------------------------------------------------------------
    window.addEventListener('message', event => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') { return; }
        switch (msg.type) {
            case 'update': {
                const root = document.getElementById('org-preview-root');
                if (!root) { return; }
                root.innerHTML = msg.html;
                if (msg.title) { document.title = msg.title; }
                highlightCode(root);
                scrollToLine(currentLine);
                typesetMath(root).then(() => scrollToLine(currentLine));
                break;
            }
            case 'scrollToLine':
                if (settings.scrollPreviewWithEditor) { scrollToLine(msg.line); }
                break;
            case 'settings':
                Object.assign(settings, msg.settings || {});
                break;
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        applyCodeTheme();
        new MutationObserver(applyCodeTheme).observe(document.body, {
            attributes: true, attributeFilter: ['class'],
        });
        const root = document.getElementById('org-preview-root') || document.body;
        highlightCode(root);
        document.addEventListener('click', onClick);
        document.addEventListener('dblclick', onDoubleClick);
        document.addEventListener('keydown', onKeyDown, true);
        backButton = document.createElement('button');
        backButton.className = 'org-back';
        backButton.textContent = '← Back';
        backButton.title = 'Back to where you followed the link from (Cmd+[ or Backspace)';
        backButton.hidden = true;
        backButton.addEventListener('click', event => {
            event.stopPropagation();
            goBack();
        });
        document.body.appendChild(backButton);
        window.addEventListener('scroll', onScroll, { passive: true });
        vscode.postMessage({ type: 'ready' });
        // Restore position once layout (and images) have settled
        scrollToLine(currentLine);
        window.addEventListener('load', () => scrollToLine(currentLine));
    });
}());
