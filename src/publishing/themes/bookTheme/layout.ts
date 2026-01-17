/**
 * Book Theme Layout
 * Generates the three-column HTML structure
 */

import type { PageContext, ProjectContext, ThemeConfig } from '../themeTypes';
import { renderLeftSidebar } from './leftSidebar';
import { renderRightSidebar } from './rightSidebar';
import { renderHeader } from './header';
import { renderFooter } from './footer';

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Compute the relative path from current page to root
 * e.g., if page is at "guide/getting-started.html", returns "../"
 */
export function computePathToRoot(relativePath: string): string {
    const depth = (relativePath.match(/\//g) || []).length;
    if (depth === 0) {
        return './';
    }
    return '../'.repeat(depth);
}

/**
 * Render the complete page layout
 */
export function renderLayout(content: string, page: PageContext, project: ProjectContext): string {
    const config = project.config;
    const title = page.title || 'Untitled';
    const pathToRoot = computePathToRoot(page.relativePath);

    // Determine which sidebars to show
    const showLeftSidebar = config.layout?.show_left_sidebar !== false;
    const showRightSidebar = config.layout?.show_right_sidebar !== false && page.pageHeadings.length > 0;

    // Render components
    const headerHtml = renderHeader(config, project, pathToRoot);
    const leftSidebarHtml = showLeftSidebar ? renderLeftSidebar(page, project, pathToRoot) : '';
    const rightSidebarHtml = showRightSidebar ? renderRightSidebar(page, config) : '';
    const footerHtml = renderFooter(config);
    const navHtml = renderPageNavigation(page);

    // Determine default theme mode
    const defaultMode = config.appearance?.default_mode || 'auto';

    // Build container classes based on sidebar visibility
    const containerClasses = ['book-container'];
    if (!showLeftSidebar) containerClasses.push('no-left-sidebar');
    if (!showRightSidebar) containerClasses.push('no-right-sidebar');

    // Custom CSS link
    let customCssLink = '';
    if (config.custom_css) {
        customCssLink = `<link rel="stylesheet" href="${pathToRoot}${config.custom_css}" />`;
    }

    // Primary color CSS variable
    let customColorCss = '';
    if (config.appearance?.primary_color) {
        customColorCss = `<style>:root { --primary-color: ${config.appearance.primary_color}; }</style>`;
    }

    return `<!DOCTYPE html>
<html lang="en" data-theme="${defaultMode}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="${pathToRoot}_static/book-theme.css">
    ${customCssLink}
    ${customColorCss}
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script>hljs.highlightAll();</script>
    <script>MathJax={tex:{inlineMath:[["\\\\(","\\\\)"]],displayMath:[["\\\\[","\\\\]"]]}};</script>
    <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
</head>
<body>
    ${headerHtml}

    <div class="${containerClasses.join(' ')}">
        ${showLeftSidebar ? `
        <aside class="sidebar-left" id="sidebar-left">
            ${leftSidebarHtml}
        </aside>
        ` : ''}

        <main class="content" id="main-content">
            <article class="page-content">
                ${content}
            </article>
            ${navHtml}
            ${footerHtml}
        </main>

        ${showRightSidebar ? `
        <aside class="sidebar-right" id="sidebar-right">
            ${rightSidebarHtml}
        </aside>
        ` : ''}
    </div>

    <script src="${pathToRoot}_static/book-theme.js"></script>
</body>
</html>`;
}

/**
 * Render prev/next page navigation
 */
function renderPageNavigation(page: PageContext): string {
    if (!page.tocEntry) {
        return '';
    }

    const { prev, next } = page.tocEntry;

    if (!prev && !next) {
        return '';
    }

    const parts: string[] = ['<nav class="page-nav">'];

    if (prev) {
        parts.push(`
            <a href="${prev}.html" class="nav-prev">
                <span class="nav-label">Previous</span>
                <span class="nav-title">\u2190 Previous</span>
            </a>
        `);
    } else {
        parts.push('<span class="nav-prev"></span>');
    }

    if (next) {
        parts.push(`
            <a href="${next}.html" class="nav-next">
                <span class="nav-label">Next</span>
                <span class="nav-title">Next \u2192</span>
            </a>
        `);
    } else {
        parts.push('<span class="nav-next"></span>');
    }

    parts.push('</nav>');
    return parts.join('\n');
}
