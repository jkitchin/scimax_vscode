/**
 * Right Sidebar Page TOC
 * Renders the table of contents for the current page
 */

import type { PageContext, PageHeading, ThemeConfig } from '../themeTypes';
import { escapeHtml } from './layout';

/**
 * Render the right sidebar content (page TOC)
 */
export function renderRightSidebar(page: PageContext, config: ThemeConfig): string {
    const headings = page.pageHeadings;
    const maxDepth = config.layout?.toc_depth || 3;

    if (headings.length === 0) {
        return '';
    }

    const parts: string[] = [];

    parts.push('<nav class="page-toc">');
    parts.push('<h4 class="toc-title">On this page</h4>');
    parts.push('<ul class="toc-list">');

    // Build hierarchical TOC
    parts.push(renderTocItems(headings, maxDepth));

    parts.push('</ul>');
    parts.push('</nav>');

    return parts.join('\n');
}

/**
 * Render TOC items maintaining hierarchy
 */
function renderTocItems(headings: PageHeading[], maxDepth: number): string {
    const parts: string[] = [];
    let currentLevel = 0;

    for (const heading of headings) {
        // Skip headings beyond max depth
        if (heading.level > maxDepth) {
            continue;
        }

        const level = heading.level;

        // Close nested lists if going up
        while (currentLevel > level) {
            parts.push('</ul></li>');
            currentLevel--;
        }

        // Open nested lists if going down
        while (currentLevel < level) {
            if (currentLevel > 0) {
                // Remove closing </li> from previous item to nest
                const lastIdx = parts.length - 1;
                if (parts[lastIdx] === '</li>') {
                    parts.pop();
                }
            }
            parts.push('<ul class="toc-sublist">');
            currentLevel++;
        }

        // Add the item
        parts.push(`
            <li class="toc-item level-${level}">
                <a href="#${escapeHtml(heading.id)}" class="toc-link">${escapeHtml(heading.text)}</a>
            </li>
        `);
    }

    // Close any remaining open lists
    while (currentLevel > 1) {
        parts.push('</ul></li>');
        currentLevel--;
    }

    return parts.join('\n');
}

/**
 * Extract headings from HTML content
 * This is used when parsing the exported HTML to build the page TOC
 */
export function extractPageHeadings(html: string, maxDepth: number = 3): PageHeading[] {
    const headings: PageHeading[] = [];

    // Match heading tags h1-h6 with their content
    // Pattern: <h[1-6] id="..." class="...">content</h[1-6]>
    const headingPattern = /<h([1-6])[^>]*(?:id="([^"]*)")?[^>]*>([\s\S]*?)<\/h\1>/gi;

    let match;
    while ((match = headingPattern.exec(html)) !== null) {
        const level = parseInt(match[1], 10);
        const id = match[2];
        const rawText = match[3];

        // Only include headings up to maxDepth
        if (level > maxDepth) {
            continue;
        }

        // Extract plain text from heading content (strip HTML tags)
        const text = stripHtmlTags(rawText).trim();

        // Skip empty headings
        if (!text) {
            continue;
        }

        // Generate ID if not present
        const headingId = id || generateHeadingId(text);

        headings.push({
            id: headingId,
            text,
            level,
        });
    }

    return headings;
}

/**
 * Strip HTML tags from a string
 */
function stripHtmlTags(html: string): string {
    return html
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

/**
 * Generate a URL-safe ID from heading text
 */
function generateHeadingId(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}
