/**
 * Org Publishing Project Configuration
 * Defines project structure for multi-file HTML publishing
 */

import type { HtmlExportOptions } from '../parser/orgExportHtml';

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
