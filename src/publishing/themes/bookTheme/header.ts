/**
 * Site Header Component
 * Renders the top navigation bar with logo, title, links, and controls
 */

import type { ThemeConfig, ProjectContext } from '../themeTypes';
import { escapeHtml } from './layout';

/**
 * Render the site header
 */
export function renderHeader(
    config: ThemeConfig,
    project: ProjectContext,
    pathToRoot: string
): string {
    const headerConfig = config.header || {};
    const appearanceConfig = config.appearance || {};

    const parts: string[] = [];

    parts.push('<header class="site-header">');
    parts.push('<div class="header-content">');

    // Left section: logo, title, and mobile menu button
    parts.push('<div class="header-left">');

    // Mobile menu toggle
    parts.push(`
        <button class="mobile-menu-toggle" id="mobile-menu-toggle" aria-label="Toggle navigation">
            <span class="hamburger-icon">
                <span></span>
                <span></span>
                <span></span>
            </span>
        </button>
    `);

    // Logo
    if (headerConfig.logo) {
        parts.push(`
            <a href="${pathToRoot}index.html" class="header-logo">
                <img src="${pathToRoot}${escapeHtml(headerConfig.logo)}" alt="Logo" />
            </a>
        `);
    }

    // Site title
    if (headerConfig.title) {
        parts.push(`
            <a href="${pathToRoot}index.html" class="header-title">
                ${escapeHtml(headerConfig.title)}
            </a>
        `);
    }

    parts.push('</div>'); // header-left

    // Right section: nav links and theme toggle
    parts.push('<div class="header-right">');

    // Navigation links
    if (headerConfig.navbar_links && headerConfig.navbar_links.length > 0) {
        parts.push('<nav class="header-nav">');
        parts.push('<ul class="nav-links">');

        for (const link of headerConfig.navbar_links) {
            const isExternal = link.url.startsWith('http://') || link.url.startsWith('https://');
            const target = isExternal ? ' target="_blank" rel="noopener"' : '';
            const externalIcon = isExternal ? '<span class="external-icon">&#8599;</span>' : '';

            parts.push(`
                <li>
                    <a href="${escapeHtml(link.url)}"${target}>
                        ${escapeHtml(link.text)}${externalIcon}
                    </a>
                </li>
            `);
        }

        parts.push('</ul>');
        parts.push('</nav>');
    }

    // Dark mode toggle
    if (appearanceConfig.enable_dark_mode !== false) {
        parts.push(renderDarkModeToggle());
    }

    parts.push('</div>'); // header-right

    parts.push('</div>'); // header-content
    parts.push('</header>');

    return parts.join('\n');
}

/**
 * Render the dark mode toggle button
 */
function renderDarkModeToggle(): string {
    return `
        <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode" title="Toggle dark mode">
            <span class="theme-icon light-icon">
                <!-- Sun icon -->
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="12" y1="1" x2="12" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="23"></line>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                    <line x1="1" y1="12" x2="3" y2="12"></line>
                    <line x1="21" y1="12" x2="23" y2="12"></line>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                </svg>
            </span>
            <span class="theme-icon dark-icon">
                <!-- Moon icon -->
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                </svg>
            </span>
        </button>
    `;
}
