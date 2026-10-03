/**
 * Jupyter Book-style Theme for Org Publishing
 * Three-column layout with left navigation, content, and page TOC
 */

import * as fs from 'fs';
import * as path from 'path';

import type { Theme, PageContext, ProjectContext, PageInfo, ThemeConfig } from '../themeTypes';
import { DEFAULT_BOOK_THEME_CONFIG } from '../themeTypes';

/**
 * The theme's asset files: next to this module in the tsc output (and the
 * CLI), under publishing/themes/bookTheme in the bundled out/extension.js.
 */
function assetsDir(): string {
    return [
        path.join(__dirname, 'assets'),
        path.join(__dirname, 'publishing', 'themes', 'bookTheme', 'assets'),
    ].find(dir => fs.existsSync(dir)) ?? path.join(__dirname, 'assets');
}
import { renderLayout } from './layout';
import { generateSearchIndex as generateSearchIndexFile } from './searchIndex';
import { generateChatIndex as generateChatIndexFile } from './chatIndex';

/** Chat files copied to _static as they are */
const CHAT_ASSETS = ['book-chat.js', 'book-chat-worker.js', 'book-chat.css'];

/**
 * Book theme implementation
 */
export class BookTheme implements Theme {
    readonly name = 'book';

    /**
     * Render a page with the book theme
     */
    renderPage(content: string, page: PageContext, project: ProjectContext): string {
        // Merge with defaults
        const config = this.mergeConfig(project.config);
        const mergedProject = { ...project, config };

        return renderLayout(content, page, mergedProject);
    }

    /**
     * Copy theme assets to the output directory
     */
    async copyAssets(outputDir: string): Promise<void> {
        const staticDir = path.join(outputDir, '_static');

        // Ensure _static directory exists
        await fs.promises.mkdir(staticDir, { recursive: true });

        // Copy CSS
        const cssContent = await this.getThemeCss();
        await fs.promises.writeFile(path.join(staticDir, 'book-theme.css'), cssContent);

        // Copy JS
        const jsContent = await this.getThemeJs();
        await fs.promises.writeFile(path.join(staticDir, 'book-theme.js'), jsContent);

        // Copy the chat files (they are only loaded on pages that enable the chat)
        for (const name of CHAT_ASSETS) {
            try {
                await fs.promises.copyFile(path.join(assetsDir(), name), path.join(staticDir, name));
            } catch {
                // Not in this build; the chat button is not shown without them.
            }
        }
    }

    /**
     * Generate search index for all pages
     */
    async generateSearchIndex(pages: PageInfo[], outputDir: string): Promise<void> {
        await generateSearchIndexFile(pages, outputDir);
    }

    /**
     * Write the section index the chat retrieves from
     */
    async generateChatIndex(pages: PageInfo[], outputDir: string): Promise<void> {
        await generateChatIndexFile(pages, outputDir);
    }

    /**
     * Merge user config with defaults
     */
    private mergeConfig(config: ThemeConfig): ThemeConfig {
        return {
            ...DEFAULT_BOOK_THEME_CONFIG,
            ...config,
            layout: {
                ...DEFAULT_BOOK_THEME_CONFIG.layout,
                ...config.layout,
            },
            header: {
                ...DEFAULT_BOOK_THEME_CONFIG.header,
                ...config.header,
            },
            footer: {
                ...DEFAULT_BOOK_THEME_CONFIG.footer,
                ...config.footer,
            },
            appearance: {
                ...DEFAULT_BOOK_THEME_CONFIG.appearance,
                ...config.appearance,
            },
            search: {
                ...DEFAULT_BOOK_THEME_CONFIG.search,
                ...config.search,
            },
            chat: {
                ...DEFAULT_BOOK_THEME_CONFIG.chat,
                ...config.chat,
            },
        };
    }

    /**
     * Get the theme CSS content
     */
    private async getThemeCss(): Promise<string> {
        // Read from bundled assets
        const assets = assetsDir();
        const cssPath = path.join(assets, 'book-theme.css');

        try {
            return await fs.promises.readFile(cssPath, 'utf-8');
        } catch {
            // Fall back to embedded CSS if file not found
            return getEmbeddedCss();
        }
    }

    /**
     * Get the theme JavaScript content
     */
    private async getThemeJs(): Promise<string> {
        // Read from bundled assets
        const assets = assetsDir();
        const jsPath = path.join(assets, 'book-theme.js');

        try {
            return await fs.promises.readFile(jsPath, 'utf-8');
        } catch {
            // Fall back to embedded JS if file not found
            return getEmbeddedJs();
        }
    }
}

/**
 * Embedded CSS fallback (in case asset files are not available)
 */
function getEmbeddedCss(): string {
    // This is imported from the assets module at build time
    // For development, we inline a minimal version
    return `/* Book Theme CSS - see assets/book-theme.css for full version */
:root {
    --primary-color: #0d6efd;
    --sidebar-width: 280px;
    --toc-width: 220px;
    --header-height: 60px;
    --content-max-width: 800px;
}
`;
}

/**
 * Embedded JavaScript fallback
 */
function getEmbeddedJs(): string {
    return `/* Book Theme JS - see assets/book-theme.js for full version */
`;
}
