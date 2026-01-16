/**
 * Site Footer Component
 * Renders the page footer with copyright and links
 */

import type { ThemeConfig } from '../themeTypes';
import { escapeHtml } from './layout';

/**
 * Render the site footer
 */
export function renderFooter(config: ThemeConfig): string {
    const footerConfig = config.footer || {};

    // Check if footer has any content
    if (!footerConfig.copyright && (!footerConfig.links || footerConfig.links.length === 0)) {
        // Return minimal footer
        return `
            <footer class="site-footer">
                <div class="footer-content">
                    <p class="powered-by">
                        Built with <a href="https://github.com/jkitchin/scimax-vscode" target="_blank" rel="noopener">scimax-vscode</a>
                    </p>
                </div>
            </footer>
        `;
    }

    const parts: string[] = [];

    parts.push('<footer class="site-footer">');
    parts.push('<div class="footer-content">');

    // Footer links
    if (footerConfig.links && footerConfig.links.length > 0) {
        parts.push('<nav class="footer-links">');
        parts.push('<ul>');

        for (const link of footerConfig.links) {
            const isExternal = link.url.startsWith('http://') || link.url.startsWith('https://');
            const target = isExternal ? ' target="_blank" rel="noopener"' : '';

            parts.push(`
                <li>
                    <a href="${escapeHtml(link.url)}"${target}>${escapeHtml(link.text)}</a>
                </li>
            `);
        }

        parts.push('</ul>');
        parts.push('</nav>');
    }

    // Copyright
    if (footerConfig.copyright) {
        parts.push(`
            <p class="copyright">
                &copy; ${escapeHtml(footerConfig.copyright)}
            </p>
        `);
    }

    // Powered by
    parts.push(`
        <p class="powered-by">
            Built with <a href="https://github.com/jkitchin/scimax-vscode" target="_blank" rel="noopener">scimax-vscode</a>
        </p>
    `);

    parts.push('</div>'); // footer-content
    parts.push('</footer>');

    return parts.join('\n');
}
