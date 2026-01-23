/**
 * Default Theme for Org Publishing
 * Simple single-column layout (existing behavior)
 */

import type { Theme, PageContext, ProjectContext, PageInfo } from './themeTypes';

/**
 * Default theme - preserves existing single-column HTML export behavior
 */
export class DefaultTheme implements Theme {
    readonly name = 'default';

    /**
     * Render a page with the default theme
     * Simply wraps content in a basic HTML document structure
     */
    renderPage(content: string, page: PageContext, project: ProjectContext): string {
        const title = page.title || 'Untitled';
        const config = project.config;

        // Build navigation
        let navHtml = '';
        if (page.tocEntry) {
            navHtml = this.buildNavigation(page.tocEntry);
        }

        // Custom CSS
        let customCssLink = '';
        if (config.custom_css) {
            customCssLink = `<link rel="stylesheet" href="${config.custom_css}" />`;
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${this.escapeHtml(title)}</title>
${customCssLink}
<style>
${this.getDefaultStyles()}
</style>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/default.min.css" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script>hljs.highlightAll();</script>
<script>MathJax={tex:{inlineMath:[["\\\\(","\\\\)"]],displayMath:[["\\\\[","\\\\]"]]}};</script>
<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
</head>
<body>
<main class="org-content">
<header id="title-block">
<h1 class="title">${this.escapeHtml(title)}</h1>
</header>
${content}
${navHtml}
</main>
</body>
</html>`;
    }

    /**
     * Copy theme assets - default theme has no additional assets
     */
    async copyAssets(outputDir: string): Promise<void> {
        // Default theme uses inline styles, no assets to copy
    }

    /**
     * Build prev/next navigation
     */
    private buildNavigation(tocEntry: { prev?: string; next?: string }): string {
        if (!tocEntry.prev && !tocEntry.next) {
            return '';
        }

        const parts: string[] = ['<nav class="page-navigation">'];

        if (tocEntry.prev) {
            parts.push(`  <a href="${tocEntry.prev}.html" class="nav-prev">\u2190 Previous</a>`);
        } else {
            parts.push('  <span class="nav-prev"></span>');
        }

        if (tocEntry.next) {
            parts.push(`  <a href="${tocEntry.next}.html" class="nav-next">Next \u2192</a>`);
        } else {
            parts.push('  <span class="nav-next"></span>');
        }

        parts.push('</nav>');
        return parts.join('\n');
    }

    /**
     * Escape HTML special characters
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Get default inline styles
     */
    private getDefaultStyles(): string {
        return `
.org-content { max-width: 800px; margin: 0 auto; padding: 2rem; font-family: system-ui, sans-serif; line-height: 1.6; }
.org-section { margin-bottom: 2rem; }
.org-todo { font-weight: bold; padding: 0.2em 0.5em; border-radius: 3px; }
.org-todo.org-todo { background: #ff6b6b; color: white; }
.org-todo.org-done { background: #51cf66; color: white; }
.org-priority { color: #e67700; font-weight: bold; }
.org-tags { float: right; font-size: 0.8em; }
.org-tag { background: #e9ecef; padding: 0.2em 0.5em; border-radius: 3px; margin-left: 0.3em; }
.org-timestamp { font-family: monospace; background: #f1f3f5; padding: 0.1em 0.3em; border-radius: 3px; }
.org-src-container { margin: 1rem 0; }
.src { background: #f8f9fa; padding: 1rem; border-radius: 4px; overflow-x: auto; }
pre.example { background: #fff3bf; padding: 1rem; border-radius: 4px; }
blockquote { border-left: 4px solid #ced4da; margin: 1rem 0; padding-left: 1rem; color: #495057; }
.org-center { text-align: center; }
.verse { white-space: pre-line; font-style: italic; }
.org-table { border-collapse: collapse; margin: 1rem 0; }
.org-table th, .org-table td { border: 1px solid #dee2e6; padding: 0.5rem; }
.org-table th { background: #f8f9fa; }
.org-footnote-ref { font-size: 0.8em; }
.org-footnotes { border-top: 1px solid #dee2e6; margin-top: 2rem; padding-top: 1rem; font-size: 0.9em; }
.org-underline { text-decoration: underline; }
.org-statistics-cookie { font-family: monospace; }
.org-toc { background: #f8f9fa; padding: 1rem; border-radius: 4px; margin-bottom: 2rem; }
.org-toc ul { list-style: none; padding-left: 1rem; }
.section-number { color: #868e96; margin-right: 0.5em; }
.admonition { padding: 1rem; margin: 1rem 0; border-radius: 4px; border-left: 4px solid; }
.admonition.org-warning { background: #fff5f5; border-color: #fa5252; }
.admonition.org-note { background: #e7f5ff; border-color: #339af0; }
.admonition.org-tip { background: #ebfbee; border-color: #40c057; }
.admonition.org-important { background: #fff9db; border-color: #fab005; }
.page-navigation { display: flex; justify-content: space-between; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #dee2e6; }
.nav-prev, .nav-next { color: #0d6efd; text-decoration: none; }
.nav-prev:hover, .nav-next:hover { text-decoration: underline; }
`;
    }
}
