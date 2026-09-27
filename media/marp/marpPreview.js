// @ts-check
/**
 * Scimax Marp: double-click a slide in the Marp preview to jump to the exact
 * source line in the Markdown file.
 *
 * Contributed through `markdown.previewScripts`, so it runs inside VS Code's
 * built-in Markdown preview, which is where the Marp extension renders slides.
 *
 * The built-in preview already switches to the editor on double-click, but it
 * guesses the line by interpolating the click's vertical position between
 * `data-line` elements. Inside scaled SVG slides that guess is often several
 * lines off. Here the line comes from the element under the cursor instead,
 * plus the number of source line breaks between the start of that element and
 * the caret, so a click on the second line of a paragraph or a code block lands
 * on that line.
 *
 * The result is sent as the preview's own `didClick` message, so VS Code opens
 * the editor and reveals the line exactly as it does for its own double-click.
 * If the message channel is unavailable the event is left alone and the
 * built-in behaviour applies.
 */
(function () {
    'use strict';

    /** Name of the host function behind `acquireVsCodeApi().postMessage`. */
    const HOST_POST_MESSAGE = '__vscode_post_message__';

    /** @returns {Record<string, any>} */
    function readPreviewSettings() {
        const meta = document.getElementById('vscode-markdown-preview-data');
        try {
            return JSON.parse((meta && meta.getAttribute('data-settings')) || '{}');
        } catch {
            return {};
        }
    }

    const settings = readPreviewSettings();

    // The preview can be retargeted at another file without reloading; the
    // settings meta tag keeps the old source, so follow updateContent instead.
    /** @type {string | undefined} */
    let currentSource = settings.source;
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (data && data.type === 'updateContent' && typeof data.source === 'string') {
            currentSource = data.source;
        }
    });

    /**
     * The preview has already acquired the VS Code API, so a second
     * acquireVsCodeApi() would throw. Post through the same host function it
     * wraps, which lives on the webview host frame.
     * @returns {((channel: string, data: unknown) => void) | undefined}
     */
    function hostPostMessage() {
        try {
            const host = /** @type {any} */ (window.frameElement?.ownerDocument?.defaultView);
            const post = host && host[HOST_POST_MESSAGE];
            return typeof post === 'function' ? post.bind(host) : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Marp's runtime may replace `<pre is="marp-pre">` with a `<marp-pre>`
     * custom element, so accept either tag.
     * @param {Element | null | undefined} el
     */
    function isPre(el) {
        return !!el && (el.tagName === 'PRE' || el.tagName === 'MARP-PRE');
    }

    /** @param {Element} el */
    function numericLine(el) {
        // MathJax output also uses data-line (values like "v" and "h").
        const value = el.getAttribute('data-line');
        return value !== null && /^\d+$/.test(value) ? Number(value) : undefined;
    }

    /**
     * Nearest element carrying a numeric `data-line`, searching up from `el`
     * but not past the slide it is on.
     * @param {Element | null} el
     * @returns {Element | undefined}
     */
    function lineElement(el) {
        for (let node = el; node; node = node.parentElement) {
            if (numericLine(node) !== undefined) {
                return node;
            }
            if (node.tagName === 'SECTION') {
                return undefined;
            }
        }
        return undefined;
    }

    /**
     * First source line of the slide containing `el`, used for clicks on empty
     * slide space. Marp for VS Code marks each slide with its start line.
     * @param {Element} el
     * @returns {number | undefined}
     */
    function slideStartLine(el) {
        const slide = el.closest('section');
        if (!slide) {
            return undefined;
        }
        const start = slide.getAttribute('data-marp-vscode-content-start-line');
        if (start !== null && /^\d+$/.test(start)) {
            return Number(start);
        }
        for (const child of slide.querySelectorAll('[data-line]')) {
            const line = numericLine(child);
            if (line !== undefined) {
                return line;
            }
        }
        return undefined;
    }

    /**
     * Caret position under the pointer, or undefined when the browser cannot
     * resolve one (e.g. over an image).
     * @param {number} x
     * @param {number} y
     * @returns {{ node: Node, offset: number } | undefined}
     */
    function caretAt(x, y) {
        const doc = /** @type {any} */ (document);
        if (typeof doc.caretPositionFromPoint === 'function') {
            const pos = doc.caretPositionFromPoint(x, y);
            if (pos && pos.offsetNode) {
                return { node: pos.offsetNode, offset: pos.offset };
            }
        }
        if (typeof doc.caretRangeFromPoint === 'function') {
            const range = doc.caretRangeFromPoint(x, y);
            if (range) {
                return { node: range.startContainer, offset: range.startOffset };
            }
        }
        return undefined;
    }

    /**
     * Elements whose own text children are only formatting newlines emitted by
     * markdown-it between block tags, e.g. `<tr>\n<td>`. Those newlines do not
     * correspond to source lines.
     */
    const BLOCK_CONTAINERS = new Set([
        'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'UL', 'OL', 'DL',
        'BLOCKQUOTE', 'SECTION', 'DIV', 'DETAILS', 'FIGURE',
    ]);

    /**
     * Source line breaks between the start of `el` and the caret. Marp renders
     * soft and hard breaks with a literal newline, and code keeps its own, so
     * newlines in inline text before the caret map one-to-one to source lines.
     * @param {Element} el
     * @param {{ node: Node, offset: number } | undefined} caret
     * @returns {number}
     */
    function linesBeforeCaret(el, caret) {
        if (!caret || !el.contains(caret.node)) {
            return 0;
        }
        let range;
        try {
            range = document.createRange();
            range.setStart(el, 0);
            range.setEnd(caret.node, caret.offset);
        } catch {
            return 0;
        }
        let count = 0;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!range.intersectsNode(node)) {
                break;
            }
            if (node.parentElement && BLOCK_CONTAINERS.has(node.parentElement.tagName)) {
                continue;
            }
            const text = node === range.endContainer
                ? /** @type {Text} */ (node).data.slice(0, range.endOffset)
                : /** @type {Text} */ (node).data;
            count += (text.match(/\n/g) || []).length;
        }
        return count;
    }

    /**
     * Zero-based source line for a double-click inside a Marp slide.
     * @param {MouseEvent} event
     * @returns {number | undefined}
     */
    function sourceLineForClick(event) {
        let target = event.target instanceof Element ? event.target : null;
        // Clicking the padding of a code block hits the <pre>, which carries no
        // line; the fenced code inside it does.
        if (target && isPre(target)) {
            target = target.querySelector(':scope > code') || target;
        }
        if (!target) {
            return undefined;
        }
        const el = lineElement(target);
        if (!el) {
            return slideStartLine(target);
        }
        let line = /** @type {number} */ (numericLine(el));
        const isFencedCode = el.tagName === 'CODE' && isPre(el.parentElement);
        if (isFencedCode) {
            // data-line is the opening fence; the code starts on the next line.
            line += 1;
        }
        if (el instanceof HTMLElement) {
            line += linesBeforeCaret(el, caretAt(event.clientX, event.clientY));
        }
        return line;
    }

    window.addEventListener('dblclick', (event) => {
        if (settings.doubleClickToSwitchToEditor === false || !currentSource) {
            return;
        }
        const target = event.target instanceof Element ? event.target : null;
        // Only Marp slides; links keep their normal behaviour.
        if (!target || !target.closest('svg[data-marpit-svg], .marpit') || target.closest('a')) {
            return;
        }
        const line = sourceLineForClick(event);
        const post = hostPostMessage();
        if (line === undefined || !post) {
            return;
        }
        post('onmessage', { message: { type: 'didClick', source: currentSource, line } });
        // Runs in the capture phase on window, so this keeps the built-in
        // handler (on document) from also sending its approximate line.
        event.stopImmediatePropagation();
        event.preventDefault();
    }, true);
})();
