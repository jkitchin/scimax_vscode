// @ts-check
/**
 * Scimax Marp: lay out slides in VS Code's Markdown preview.
 *
 * Contributed through `markdown.previewScripts`. When the preview shows a
 * Marp deck (rendered by src/marp/marpPreviewPlugin.ts, which adds a
 * <style id="scimax-marp-style">), this marks the body with `scimax-marp` and
 * turns off VS Code's own Markdown stylesheets, whose heading, table and code
 * styles would otherwise leak into the slides. Both are undone when the
 * preview moves to an ordinary Markdown file.
 */
(function () {
    'use strict';

    /** VS Code's Markdown styles come from the built-in markdown extension. */
    function isVsCodeMarkdownStyle(/** @type {HTMLLinkElement} */ link) {
        return /markdown-language-features/.test(link.href);
    }

    function update() {
        const isDeck = document.getElementById('scimax-marp-style') !== null;
        document.body.classList.toggle('scimax-marp', isDeck);
        document.querySelectorAll('link[rel="stylesheet"]').forEach(el => {
            const link = /** @type {HTMLLinkElement} */ (el);
            if (isVsCodeMarkdownStyle(link)) {
                link.disabled = isDeck;
            }
        });
    }

    // The preview replaces its content in place when the file changes.
    new MutationObserver(update).observe(document.body, { childList: true, subtree: false });
    update();
})();
