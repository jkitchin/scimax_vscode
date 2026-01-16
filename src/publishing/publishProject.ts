/**
 * Org Publishing Project Configuration
 * Defines project structure for multi-file HTML publishing
 */

import type { HtmlExportOptions } from '../parser/orgExportHtml';
import type { ThemeConfig } from './themes/themeTypes';

// =============================================================================
// Project Configuration Types
// =============================================================================

/**
 * Publishing function types
 */
export type PublishingFunction =
    | 'org-html-publish-to-html'  // Export org to HTML
    | 'md-html-publish-to-html'   // Export markdown to HTML
    | 'ipynb-html-publish-to-html' // Export Jupyter notebook to HTML
    | 'auto'                       // Auto-detect by extension
    | 'copy';                      // Copy files as-is

/**
 * Sitemap sort order
 */
export type SitemapSortOrder = 'alphabetically' | 'chronologically' | 'anti-chronologically';

/**
 * Sitemap display style
 */
export type SitemapStyle = 'list' | 'tree';

/**
 * Single project configuration
 */
export interface PublishProject {
    /** Project name (used as identifier) */
    name: string;

    // =========================================================================
    // File Selection
    // =========================================================================

    /** Source directory containing org files */
    baseDirectory: string;

    /** File extension to match (default: 'org') */
    baseExtension?: string;

    /** Output directory for published files */
    publishingDirectory: string;

    /** Process subdirectories recursively */
    recursive?: boolean;

    // =========================================================================
    // File Filtering
    // =========================================================================

    /** Glob pattern or regex to exclude files */
    exclude?: string;

    /** Extra files to include (glob patterns) */
    include?: string[];

    // =========================================================================
    // Publishing Function
    // =========================================================================

    /** How to publish files */
    publishingFunction?: PublishingFunction;

    // =========================================================================
    // Sitemap Options
    // =========================================================================

    /** Generate sitemap automatically */
    autoSitemap?: boolean;

    /** Sitemap output filename (default: 'sitemap.org' -> 'sitemap.html') */
    sitemapFilename?: string;

    /** Title for the sitemap page */
    sitemapTitle?: string;

    /** Sitemap display style */
    sitemapStyle?: SitemapStyle;

    /** How to sort files in sitemap */
    sitemapSortFiles?: SitemapSortOrder;

    /** Put folders first or last in sitemap */
    sitemapSortFolders?: 'first' | 'last' | 'mixed';

    // =========================================================================
    // HTML Options (passed to HTML exporter)
    // =========================================================================

    /** Custom HTML preamble (navigation, header) - can be file path or HTML string */
    htmlPreamble?: string;

    /** Custom HTML postamble (footer) - can be file path or HTML string */
    htmlPostamble?: string;

    /** Extra content for <head> section */
    htmlHead?: string;

    /** Additional head content (appended to htmlHead) */
    htmlHeadExtra?: string;

    /** CSS files to include (paths relative to publishingDirectory) */
    cssFiles?: string[];

    /** JavaScript files to include */
    jsFiles?: string[];

    /** Use the built-in default theme */
    useDefaultTheme?: boolean;

    // =========================================================================
    // Export Options
    // =========================================================================

    /** Include author in output */
    withAuthor?: boolean;

    /** Include generator info in footer */
    withCreator?: boolean;

    /** Include table of contents (true, false, or depth number) */
    withToc?: boolean | number;

    /** Include section numbers */
    sectionNumbers?: boolean;

    /** Default document title if not specified */
    defaultTitle?: string;

    // =========================================================================
    // Hooks
    // =========================================================================

    /** Shell command to run before publishing */
    preparationCommand?: string;

    /** Shell command to run after publishing */
    completionCommand?: string;
}

/**
 * Component project - groups multiple projects
 */
export interface ComponentProject {
    /** Project name */
    name: string;

    /** Names of projects to include */
    components: string[];
}

/**
 * Full publish configuration file structure
 */
export interface PublishConfig {
    /** Project definitions */
    projects: Record<string, PublishProject | ComponentProject>;

    /** Enable GitHub Pages specific features */
    githubPages?: boolean;

    /** Custom domain for GitHub Pages (creates CNAME file) */
    customDomain?: string;

    /** Default project to publish when none specified */
    defaultProject?: string;

    /** Theme configuration for styled output */
    theme?: ThemeConfig;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a project config is a component project
 */
export function isComponentProject(
    project: PublishProject | ComponentProject
): project is ComponentProject {
    return 'components' in project && Array.isArray(project.components);
}

/**
 * Check if a project config is a regular project
 */
export function isPublishProject(
    project: PublishProject | ComponentProject
): project is PublishProject {
    return 'baseDirectory' in project;
}

// =============================================================================
// Defaults
// =============================================================================

/**
 * Default project configuration values
 */
export const DEFAULT_PROJECT_CONFIG: Partial<PublishProject> = {
    baseExtension: 'org',
    recursive: true,
    publishingFunction: 'org-html-publish-to-html',
    autoSitemap: true,
    sitemapFilename: 'sitemap.org',
    sitemapTitle: 'Site Map',
    sitemapStyle: 'list',
    sitemapSortFiles: 'alphabetically',
    sitemapSortFolders: 'first',
    useDefaultTheme: true,
    withAuthor: true,
    withCreator: true,
    withToc: true,
    sectionNumbers: false,
};

/**
 * GitHub Pages preset - optimized for GitHub Pages hosting
 */
export const GITHUB_PAGES_PRESET: Partial<PublishProject> = {
    ...DEFAULT_PROJECT_CONFIG,
    publishingDirectory: './docs',
    sitemapFilename: 'index.org',  // index.html is the landing page
    sitemapTitle: 'Home',
};

/**
 * Configuration file name
 */
export const CONFIG_FILENAME = '.org-publish.json';

/**
 * YAML configuration file name (Jupyter Book compatible)
 */
export const CONFIG_YAML_FILENAME = '_config.yml';

/**
 * TOC file name (Jupyter Book compatible)
 */
export const TOC_FILENAME = '_toc.yml';

// =============================================================================
// Table of Contents Types (Jupyter Book compatible)
// =============================================================================

/**
 * A single entry in the TOC - can be a file or a section with nested entries
 */
export interface TocEntry {
    /** File path (without extension) relative to baseDirectory */
    file?: string;

    /** Custom title (overrides file's #+TITLE) */
    title?: string;

    /** Nested sections under this entry */
    sections?: TocEntry[];

    /** URL for external links */
    url?: string;

    /** Glob pattern to include multiple files */
    glob?: string;
}

/**
 * A part/chapter grouping in the TOC
 */
export interface TocPart {
    /** Part/chapter caption shown in navigation */
    caption: string;

    /** Numbered chapters (default: false) */
    numbered?: boolean;

    /** Chapters/files in this part */
    chapters?: TocEntry[];
}

/**
 * Root TOC configuration (_toc.yml)
 * Compatible with Jupyter Book format
 */
export interface TocConfig {
    /** Format identifier */
    format?: 'jb-book' | 'jb-article' | 'scimax';

    /** Root/landing page file (without extension) */
    root: string;

    /** Parts (for book format with multiple sections) */
    parts?: TocPart[];

    /** Chapters (flat list, alternative to parts) */
    chapters?: TocEntry[];

    /** Default behavior for unlisted files */
    defaults?: {
        /** Include files not in TOC (default: false) */
        includeUnlisted?: boolean;

        /** Numbering for sections */
        numbered?: boolean;
    };
}

/**
 * Flattened TOC entry with navigation info
 */
export interface FlatTocEntry {
    /** File path relative to baseDirectory */
    file: string;

    /** Display title */
    title?: string;

    /** Part/chapter this belongs to */
    part?: string;

    /** Nesting level (0 = top level) */
    level: number;

    /** Index in flat list */
    index: number;

    /** Previous entry file path */
    prev?: string;

    /** Next entry file path */
    next?: string;
}

// =============================================================================
// Configuration Helpers
// =============================================================================

/**
 * Merge project config with defaults
 */
export function mergeWithDefaults(
    project: Partial<PublishProject>,
    preset: Partial<PublishProject> = DEFAULT_PROJECT_CONFIG
): PublishProject {
    return {
        name: project.name || 'default',
        baseDirectory: project.baseDirectory || './org',
        publishingDirectory: project.publishingDirectory || './docs',
        ...preset,
        ...project,
    } as PublishProject;
}

/**
 * Convert PublishProject options to HtmlExportOptions
 */
export function toHtmlExportOptions(project: PublishProject): Partial<HtmlExportOptions> {
    return {
        toc: project.withToc,
        sectionNumbers: project.sectionNumbers,
        cssFiles: project.cssFiles,
        jsFiles: project.jsFiles,
        headExtra: project.htmlHeadExtra,
        preamble: !!project.htmlPreamble,
        preambleContent: project.htmlPreamble,
        postamble: !!project.htmlPostamble,
        postambleContent: project.htmlPostamble,
    };
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validation error
 */
export interface ValidationError {
    field: string;
    message: string;
}

/**
 * Validate a project configuration
 */
export function validateProject(project: Partial<PublishProject>): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!project.name) {
        errors.push({ field: 'name', message: 'Project name is required' });
    }

    if (!project.baseDirectory) {
        errors.push({ field: 'baseDirectory', message: 'Base directory is required' });
    }

    if (!project.publishingDirectory) {
        errors.push({ field: 'publishingDirectory', message: 'Publishing directory is required' });
    }

    if (project.baseDirectory === project.publishingDirectory) {
        errors.push({
            field: 'publishingDirectory',
            message: 'Publishing directory must be different from base directory'
        });
    }

    return errors;
}

/**
 * Validate a full configuration
 */
export function validateConfig(config: Partial<PublishConfig>): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!config.projects || Object.keys(config.projects).length === 0) {
        errors.push({ field: 'projects', message: 'At least one project is required' });
        return errors;
    }

    for (const [name, project] of Object.entries(config.projects)) {
        if (isComponentProject(project)) {
            // Validate component references exist
            for (const componentName of project.components) {
                if (!config.projects[componentName]) {
                    errors.push({
                        field: `projects.${name}.components`,
                        message: `Referenced project "${componentName}" does not exist`
                    });
                }
            }
        } else {
            // Validate regular project
            const projectErrors = validateProject({ ...project, name });
            errors.push(...projectErrors.map(e => ({
                ...e,
                field: `projects.${name}.${e.field}`
            })));
        }
    }

    return errors;
}

// =============================================================================
// TOC Helpers
// =============================================================================

/**
 * Flatten a TOC config into a linear list with navigation links
 */
export function flattenToc(toc: TocConfig): FlatTocEntry[] {
    const entries: FlatTocEntry[] = [];

    // Add root entry first
    entries.push({
        file: toc.root,
        level: 0,
        index: 0,
    });

    // Process parts or chapters
    if (toc.parts) {
        for (const part of toc.parts) {
            if (part.chapters) {
                flattenEntries(part.chapters, entries, part.caption, 1);
            }
        }
    } else if (toc.chapters) {
        flattenEntries(toc.chapters, entries, undefined, 1);
    }

    // Add prev/next links
    for (let i = 0; i < entries.length; i++) {
        entries[i].index = i;
        if (i > 0) {
            entries[i].prev = entries[i - 1].file;
        }
        if (i < entries.length - 1) {
            entries[i].next = entries[i + 1].file;
        }
    }

    return entries;
}

/**
 * Recursively flatten TOC entries
 */
function flattenEntries(
    tocEntries: TocEntry[],
    result: FlatTocEntry[],
    part: string | undefined,
    level: number
): void {
    for (const entry of tocEntries) {
        if (entry.file) {
            result.push({
                file: entry.file,
                title: entry.title,
                part,
                level,
                index: result.length,
            });
        }

        // Recursively process sections
        if (entry.sections) {
            flattenEntries(entry.sections, result, part, level + 1);
        }
    }
}

/**
 * Get all files referenced in a TOC
 */
export function getTocFiles(toc: TocConfig): string[] {
    const files: string[] = [toc.root];

    function collectFiles(entries: TocEntry[] | undefined) {
        if (!entries) return;
        for (const entry of entries) {
            if (entry.file) {
                files.push(entry.file);
            }
            if (entry.sections) {
                collectFiles(entry.sections);
            }
        }
    }

    if (toc.parts) {
        for (const part of toc.parts) {
            collectFiles(part.chapters);
        }
    }
    collectFiles(toc.chapters);

    return files;
}

/**
 * Find a TOC entry by file path
 */
export function findTocEntry(toc: TocConfig, filePath: string): FlatTocEntry | undefined {
    const flat = flattenToc(toc);
    // Normalize file path (remove extension)
    const normalized = filePath.replace(/\.(org|md|ipynb)$/i, '');
    return flat.find(e => e.file === normalized || e.file === filePath);
}
