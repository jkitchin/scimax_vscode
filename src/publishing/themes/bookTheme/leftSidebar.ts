/**
 * Left Sidebar Navigation
 * Renders the site navigation tree from TOC
 */

import type { PageContext, ProjectContext, ThemeConfig } from '../themeTypes';
import type { FlatTocEntry, TocConfig, TocPart, TocEntry } from '../../publishProject';
import { escapeHtml } from './layout';

/**
 * Render the left sidebar content
 */
export function renderLeftSidebar(
    page: PageContext,
    project: ProjectContext,
    pathToRoot: string
): string {
    const config = project.config;
    const parts: string[] = [];

    // Search box (if enabled)
    if (config.search?.enabled) {
        parts.push(renderSearchBox(pathToRoot));
    }

    // Site navigation
    parts.push('<nav class="site-nav">');
    parts.push(renderNavigation(page, project, pathToRoot));
    parts.push('</nav>');

    return parts.join('\n');
}

/**
 * Render the search box
 */
function renderSearchBox(pathToRoot: string): string {
    return `
<div class="search-box">
    <input type="search" id="search-input" placeholder="Search..." aria-label="Search">
    <div id="search-results" class="search-results"></div>
</div>
`;
}

/**
 * Render the navigation tree
 */
function renderNavigation(
    page: PageContext,
    project: ProjectContext,
    pathToRoot: string
): string {
    const tocConfig = project.tocConfig;
    const currentFile = page.relativePath.replace(/\.html$/, '').replace(/\.(org|md|ipynb)$/, '');
    const parts: string[] = [];

    // Root entry
    if (tocConfig.root) {
        const isActive = tocConfig.root === currentFile;
        const rootTitle = getEntryTitle(tocConfig.root, project.flatToc) || 'Home';
        parts.push(`
            <div class="nav-entry nav-root ${isActive ? 'active' : ''}">
                <a href="${pathToRoot}${tocConfig.root}.html">${escapeHtml(rootTitle)}</a>
            </div>
        `);
    }

    // Render parts or chapters
    if (tocConfig.parts && tocConfig.parts.length > 0) {
        for (const part of tocConfig.parts) {
            parts.push(renderPart(part, currentFile, project.flatToc, pathToRoot));
        }
    } else if (tocConfig.chapters && tocConfig.chapters.length > 0) {
        parts.push('<ul class="nav-list">');
        for (const chapter of tocConfig.chapters) {
            parts.push(renderEntry(chapter, currentFile, project.flatToc, pathToRoot, 0));
        }
        parts.push('</ul>');
    }

    return parts.join('\n');
}

/**
 * Render a part (section with caption)
 */
function renderPart(
    part: TocPart,
    currentFile: string,
    flatToc: FlatTocEntry[],
    pathToRoot: string
): string {
    const parts: string[] = [];

    // Part caption
    parts.push(`
        <div class="nav-part">
            <button class="nav-part-toggle" aria-expanded="true">
                <span class="toggle-icon">&#9660;</span>
                <span class="part-caption">${escapeHtml(part.caption)}</span>
            </button>
            <ul class="nav-list part-chapters">
    `);

    // Chapters in this part
    if (part.chapters) {
        for (const chapter of part.chapters) {
            parts.push(renderEntry(chapter, currentFile, flatToc, pathToRoot, 0));
        }
    }

    parts.push('</ul></div>');
    return parts.join('\n');
}

/**
 * Render a single TOC entry (recursively handles sections)
 */
function renderEntry(
    entry: TocEntry,
    currentFile: string,
    flatToc: FlatTocEntry[],
    pathToRoot: string,
    level: number
): string {
    if (!entry.file && !entry.url && !entry.sections) {
        return '';
    }

    const parts: string[] = [];
    const entryFile = entry.file || '';
    const isActive = entryFile === currentFile;
    const hasChildren = entry.sections && entry.sections.length > 0;
    const title = entry.title || getEntryTitle(entryFile, flatToc) || entryFile;

    // Determine if any descendant is active (for expanding)
    const hasActiveDescendant = hasChildren && containsActiveEntry(entry.sections!, currentFile);

    parts.push(`<li class="nav-item level-${level} ${isActive ? 'active' : ''} ${hasActiveDescendant ? 'has-active' : ''}">`);

    if (entry.url) {
        // External link
        parts.push(`
            <a href="${escapeHtml(entry.url)}" class="nav-link external" target="_blank" rel="noopener">
                ${escapeHtml(title)}
                <span class="external-icon">&#8599;</span>
            </a>
        `);
    } else if (entry.file) {
        // Internal link
        const href = `${pathToRoot}${entry.file}.html`;

        if (hasChildren) {
            // Entry with children - add toggle
            parts.push(`
                <div class="nav-link-wrapper">
                    <a href="${escapeHtml(href)}" class="nav-link">${escapeHtml(title)}</a>
                    <button class="nav-toggle" aria-expanded="${isActive || hasActiveDescendant ? 'true' : 'false'}">
                        <span class="toggle-icon">${isActive || hasActiveDescendant ? '&#9660;' : '&#9654;'}</span>
                    </button>
                </div>
            `);
        } else {
            // Simple link
            parts.push(`<a href="${escapeHtml(href)}" class="nav-link">${escapeHtml(title)}</a>`);
        }
    }

    // Render children
    if (hasChildren) {
        const expanded = isActive || hasActiveDescendant;
        parts.push(`<ul class="nav-children ${expanded ? 'expanded' : 'collapsed'}">`);
        for (const section of entry.sections!) {
            parts.push(renderEntry(section, currentFile, flatToc, pathToRoot, level + 1));
        }
        parts.push('</ul>');
    }

    parts.push('</li>');
    return parts.join('\n');
}

/**
 * Check if any entry in the list matches the current file
 */
function containsActiveEntry(entries: TocEntry[], currentFile: string): boolean {
    for (const entry of entries) {
        if (entry.file === currentFile) {
            return true;
        }
        if (entry.sections && containsActiveEntry(entry.sections, currentFile)) {
            return true;
        }
    }
    return false;
}

/**
 * Get the display title for an entry from the flat TOC
 */
function getEntryTitle(file: string, flatToc: FlatTocEntry[]): string | undefined {
    const entry = flatToc.find(e => e.file === file);
    return entry?.title;
}
