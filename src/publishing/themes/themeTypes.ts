/**
 * Theme Type Definitions for Org Publishing
 * Defines configuration interfaces for theming the published output
 */

import type { FlatTocEntry, TocConfig, TocPart, TocEntry } from '../publishProject';

// =============================================================================
// Theme Configuration Types
// =============================================================================

/**
 * Header configuration for the site
 */
export interface ThemeHeaderConfig {
    /** Path to logo image relative to _static/ */
    logo?: string;

    /** Site title displayed in header */
    title?: string;

    /** Navigation links in the header */
    navbar_links?: Array<{
        text: string;
        url: string;
    }>;
}

/**
 * Footer configuration for the site
 */
export interface ThemeFooterConfig {
    /** Copyright notice */
    copyright?: string;

    /** Footer links */
    links?: Array<{
        text: string;
        url: string;
    }>;
}

/**
 * Layout configuration
 */
export interface ThemeLayoutConfig {
    /** Show left sidebar with site navigation */
    show_left_sidebar?: boolean;

    /** Show right sidebar with page TOC */
    show_right_sidebar?: boolean;

    /** Maximum depth for right sidebar TOC (default: 3) */
    toc_depth?: number;
}

/**
 * Appearance/styling configuration
 */
export interface ThemeAppearanceConfig {
    /** Primary color for links, buttons, etc. */
    primary_color?: string;

    /** Enable dark mode toggle */
    enable_dark_mode?: boolean;

    /** Default color mode: "light", "dark", or "auto" (follows system) */
    default_mode?: 'light' | 'dark' | 'auto';
}

/**
 * Search configuration
 */
export interface ThemeSearchConfig {
    /** Enable client-side search */
    enabled?: boolean;
}

/**
 * "Ask the docs" chat: a language model that runs in the reader's browser
 * (WebLLM, WebGPU) and answers from the sections of the site that best match
 * the question. Off unless enabled.
 */
export interface ThemeChatConfig {
    /** Add the chat button and write the section index (_static/chat-index.json) */
    enabled?: boolean;

    /** WebLLM prebuilt model ID used until the reader picks another */
    model?: string;

    /** WebLLM prebuilt model IDs the reader can pick from */
    models?: string[];

    /** Reorder the search hits with a small cross-encoder in the browser (about 23 MB, downloaded once) */
    rerank?: boolean;

    /** Number of sections given to the model with each question */
    top_k?: number;

    /** Most characters of documentation given to the model with each question */
    max_context_chars?: number;

    /** Replaces the default instructions given to the model */
    system_prompt?: string;

    /** Title of the chat panel */
    title?: string;
}

/**
 * Complete theme configuration
 */
export interface ThemeConfig {
    /** Theme name: "book" | "default" */
    name: 'book' | 'default';

    /** Layout options */
    layout?: ThemeLayoutConfig;

    /** Header configuration */
    header?: ThemeHeaderConfig;

    /** Footer configuration */
    footer?: ThemeFooterConfig;

    /** Appearance options */
    appearance?: ThemeAppearanceConfig;

    /** Search options */
    search?: ThemeSearchConfig;

    /** "Ask the docs" chat options */
    chat?: ThemeChatConfig;

    /** Path to custom CSS file relative to source directory */
    custom_css?: string;
}

// =============================================================================
// Page and Project Context Types
// =============================================================================

/**
 * Heading extracted from page content for right sidebar TOC
 */
export interface PageHeading {
    /** Heading ID (anchor) */
    id: string;

    /** Heading text */
    text: string;

    /** Heading level (1-6) */
    level: number;
}

/**
 * Context for a single page being rendered
 */
export interface PageContext {
    /** Page title */
    title: string;

    /** HTML content (body only, no document wrapper) */
    content: string;

    /** TOC entry for this page (for navigation) */
    tocEntry?: FlatTocEntry;

    /** Headings extracted from page content for right sidebar */
    pageHeadings: PageHeading[];

    /** Path relative to output directory */
    relativePath: string;

    /** Original source file path */
    sourcePath: string;
}

/**
 * Information about a page for search indexing
 */
export interface PageInfo {
    /** Page title */
    title: string;

    /** Path relative to output directory (HTML file) */
    path: string;

    /** Plain text content (for indexing) */
    content: string;

    /** Headings with their IDs */
    headings: Array<{ id: string; text: string }>;

    /** The page split at its headings, for the chat index (only when chat is enabled) */
    sections?: PageSection[];
}

/**
 * The text of a page from one heading to the next
 */
export interface PageSection {
    /** Anchor of the heading (none for text before the first heading) */
    id?: string;

    /** Heading text */
    heading: string;

    /** Headings above this one, outermost first */
    path: string[];

    /** Plain text, one line per paragraph, list item or table row */
    text: string;
}

/**
 * Context for the entire project during rendering
 */
export interface ProjectContext {
    /** Theme configuration */
    config: ThemeConfig;

    /** Flattened TOC with navigation info */
    flatToc: FlatTocEntry[];

    /** Full TOC configuration */
    tocConfig: TocConfig;

    /** Parts from TOC (for sidebar sections) */
    parts?: TocPart[];

    /** Output directory path */
    outputDir: string;

    /** Base directory path (source) */
    baseDir: string;

    /** Workspace root path */
    workspaceRoot: string;
}

// =============================================================================
// Theme Interface
// =============================================================================

/**
 * Theme interface - all themes must implement this
 */
export interface Theme {
    /** Theme identifier */
    readonly name: string;

    /**
     * Render a page with the theme
     * @param content HTML content (body only)
     * @param page Page context
     * @param project Project context
     * @returns Complete HTML document
     */
    renderPage(content: string, page: PageContext, project: ProjectContext): string;

    /**
     * Copy theme assets to the output directory
     * @param outputDir Output directory path
     */
    copyAssets(outputDir: string): Promise<void>;

    /**
     * Generate search index after all pages are published
     * @param pages Information about all published pages
     * @param outputDir Output directory path
     */
    generateSearchIndex?(pages: PageInfo[], outputDir: string): Promise<void>;

    /**
     * Write the section index the chat retrieves from
     * @param pages Information about all published pages, with their sections
     * @param outputDir Output directory path
     */
    generateChatIndex?(pages: PageInfo[], outputDir: string): Promise<void>;
}

// =============================================================================
// Default Values
// =============================================================================

/**
 * Default theme configuration
 */
export const DEFAULT_THEME_CONFIG: ThemeConfig = {
    name: 'default',
    layout: {
        show_left_sidebar: true,
        show_right_sidebar: true,
        toc_depth: 3,
    },
    appearance: {
        enable_dark_mode: true,
        default_mode: 'auto',
    },
    search: {
        enabled: true,
    },
};

/**
 * Default chat configuration (the chat is off unless enabled)
 */
export const DEFAULT_CHAT_CONFIG: Required<Omit<ThemeChatConfig, 'system_prompt'>> = {
    enabled: false,
    model: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    models: [
        'SmolLM2-360M-Instruct-q4f16_1-MLC',
        'Llama-3.2-1B-Instruct-q4f16_1-MLC',
        'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
        'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    ],
    rerank: true,
    top_k: 5,
    max_context_chars: 6000,
    title: 'Ask the docs',
};

/**
 * Default book theme configuration
 */
export const DEFAULT_BOOK_THEME_CONFIG: ThemeConfig = {
    name: 'book',
    layout: {
        show_left_sidebar: true,
        show_right_sidebar: true,
        toc_depth: 3,
    },
    header: {
        title: 'Documentation',
    },
    footer: {
        copyright: new Date().getFullYear().toString(),
    },
    appearance: {
        primary_color: '#0d6efd',
        enable_dark_mode: true,
        default_mode: 'auto',
    },
    search: {
        enabled: true,
    },
    chat: DEFAULT_CHAT_CONFIG,
};
