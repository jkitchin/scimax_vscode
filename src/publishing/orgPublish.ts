/**
 * Core Org Publishing Engine
 * Handles multi-file project publishing to HTML
 */

import * as fs from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';

import { parseOrgFast } from '../parser/orgExportParser';
import { exportToHtml, HtmlExportOptions } from '../parser/orgExportHtml';
import { processIncludes, hasIncludes } from '../parser/orgInclude';
import type { OrgDocumentNode } from '../parser/orgElementTypes';
import { parseNotebook } from '../parser/ipynbParser';

import {
    PublishProject,
    PublishConfig,
    ComponentProject,
    isComponentProject,
    isPublishProject,
    mergeWithDefaults,
    toHtmlExportOptions,
    CONFIG_FILENAME,
    CONFIG_YAML_FILENAME,
    TOC_FILENAME,
    GITHUB_PAGES_PRESET,
    TocConfig,
    TocPart,
    FlatTocEntry,
    flattenToc,
    getTocFiles,
    findTocEntry,
} from './publishProject';

import {
    getThemeForConfig,
    type Theme,
    type ThemeConfig,
    type PageContext,
    type ProjectContext,
    type PageInfo,
    type PageHeading,
} from './themes';

import { extractPageHeadings } from './themes/bookTheme/rightSidebar';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of publishing a single file
 */
export interface PublishFileResult {
    /** Source file path */
    sourcePath: string;
    /** Output file path */
    outputPath: string;
    /** Whether publishing succeeded */
    success: boolean;
    /** Error message if failed */
    error?: string;
    /** File title (from #+TITLE) */
    title?: string;
    /** File date (from #+DATE or mtime) */
    date?: Date;
}

/**
 * Result of publishing a project
 */
export interface PublishProjectResult {
    /** Project name */
    projectName: string;
    /** Individual file results */
    files: PublishFileResult[];
    /** Total files processed */
    totalFiles: number;
    /** Successfully published */
    successCount: number;
    /** Failed to publish */
    errorCount: number;
    /** Publishing duration in ms */
    duration: number;
}

/**
 * Progress callback for publishing
 */
export type PublishProgressCallback = (
    current: number,
    total: number,
    file: string
) => void;

/**
 * Publishing options
 */
export interface PublishOptions {
    /** Progress callback */
    onProgress?: PublishProgressCallback;
    /** Force republish even if output is newer */
    force?: boolean;
    /** Dry run - don't actually write files */
    dryRun?: boolean;
}

// =============================================================================
// Configuration Loading
// =============================================================================

/**
 * Load publish configuration from file
 * Checks for _config.yml first (YAML), then .org-publish.json (JSON)
 * YAML takes precedence for Jupyter Book compatibility
 */
export async function loadConfig(workspaceRoot: string): Promise<PublishConfig | null> {
    // Try YAML config first (_config.yml) - Jupyter Book compatible
    const yamlConfigPath = path.join(workspaceRoot, CONFIG_YAML_FILENAME);
    try {
        const content = await fs.promises.readFile(yamlConfigPath, 'utf-8');
        return parseConfigYaml(content);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
        // YAML not found, try JSON
    }

    // Try JSON config (.org-publish.json)
    const jsonConfigPath = path.join(workspaceRoot, CONFIG_FILENAME);
    try {
        const content = await fs.promises.readFile(jsonConfigPath, 'utf-8');
        const config = JSON.parse(content) as PublishConfig;
        return config;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

/**
 * Parse YAML configuration file (_config.yml)
 * Compatible with Jupyter Book _config.yml format
 */
function parseConfigYaml(content: string): PublishConfig {
    const yaml = parseSimpleYamlGeneric(content);

    // Convert Jupyter Book style config to our PublishConfig format
    const config: PublishConfig = {
        projects: {},
    };

    // Extract project settings
    const projectName = (yaml.title as string)?.toLowerCase().replace(/\s+/g, '-') || 'default';
    const project: Partial<PublishProject> = {
        name: projectName,
    };

    // Map common Jupyter Book config options
    if (yaml.title) project.sitemapTitle = yaml.title as string;
    if (yaml.author) project.withAuthor = true;

    // Source and output directories
    if (yaml.source_directory) project.baseDirectory = yaml.source_directory as string;
    if (yaml.publish_directory) project.publishingDirectory = yaml.publish_directory as string;

    // HTML options
    const html = yaml.html as Record<string, unknown> | undefined;
    if (html) {
        if (html.use_default_theme !== undefined) project.useDefaultTheme = html.use_default_theme as boolean;
        if (html.toc_depth !== undefined) project.withToc = html.toc_depth as number;
        if (html.css_files) project.cssFiles = html.css_files as string[];
        if (html.js_files) project.jsFiles = html.js_files as string[];
    }

    // Publish options
    const publish = yaml.publish as Record<string, unknown> | undefined;
    if (publish) {
        if (publish.base_directory) project.baseDirectory = publish.base_directory as string;
        if (publish.publishing_directory) project.publishingDirectory = publish.publishing_directory as string;
        if (publish.recursive !== undefined) project.recursive = publish.recursive as boolean;
        if (publish.exclude) project.exclude = publish.exclude as string;
        if (publish.auto_sitemap !== undefined) project.autoSitemap = publish.auto_sitemap as boolean;
        if (publish.sitemap_filename) project.sitemapFilename = publish.sitemap_filename as string;
    }

    // GitHub Pages
    if (yaml.github_pages !== undefined) config.githubPages = yaml.github_pages as boolean;
    if (yaml.custom_domain) config.customDomain = yaml.custom_domain as string;

    // Theme configuration
    const themeYaml = yaml.theme as Record<string, unknown> | undefined;
    if (themeYaml) {
        config.theme = parseThemeConfig(themeYaml);
    }

    // Set defaults if not provided
    if (!project.baseDirectory) project.baseDirectory = './';
    if (!project.publishingDirectory) project.publishingDirectory = './_build/html';

    config.projects[projectName] = project as PublishProject;
    config.defaultProject = projectName;

    return config;
}

/**
 * Parse theme configuration from YAML
 */
function parseThemeConfig(yaml: Record<string, unknown>): ThemeConfig {
    const theme: ThemeConfig = {
        name: (yaml.name as 'book' | 'default') || 'default',
    };

    // Layout options
    const layout = yaml.layout as Record<string, unknown> | undefined;
    if (layout) {
        theme.layout = {
            show_left_sidebar: layout.show_left_sidebar as boolean | undefined,
            show_right_sidebar: layout.show_right_sidebar as boolean | undefined,
            toc_depth: layout.toc_depth as number | undefined,
        };
    }

    // Header options
    const header = yaml.header as Record<string, unknown> | undefined;
    if (header) {
        theme.header = {
            logo: header.logo as string | undefined,
            title: header.title as string | undefined,
        };

        const navbarLinks = header.navbar_links as Array<Record<string, unknown>> | undefined;
        if (navbarLinks) {
            theme.header.navbar_links = navbarLinks.map(link => ({
                text: link.text as string,
                url: link.url as string,
            }));
        }
    }

    // Footer options
    const footer = yaml.footer as Record<string, unknown> | undefined;
    if (footer) {
        theme.footer = {
            copyright: footer.copyright as string | undefined,
        };

        const footerLinks = footer.links as Array<Record<string, unknown>> | undefined;
        if (footerLinks) {
            theme.footer.links = footerLinks.map(link => ({
                text: link.text as string,
                url: link.url as string,
            }));
        }
    }

    // Appearance options
    const appearance = yaml.appearance as Record<string, unknown> | undefined;
    if (appearance) {
        theme.appearance = {
            primary_color: appearance.primary_color as string | undefined,
            enable_dark_mode: appearance.enable_dark_mode as boolean | undefined,
            default_mode: appearance.default_mode as 'light' | 'dark' | 'auto' | undefined,
        };
    }

    // Search options
    const search = yaml.search as Record<string, unknown> | undefined;
    if (search) {
        theme.search = {
            enabled: search.enabled as boolean | undefined,
        };
    }

    // Custom CSS
    if (yaml.custom_css) {
        theme.custom_css = yaml.custom_css as string;
    }

    return theme;
}

/**
 * Generic YAML parser that returns a plain object
 */
function parseSimpleYamlGeneric(content: string): Record<string, unknown> {
    const lines = content.split('\n');
    const result: Record<string, unknown> = {};
    const stack: Array<{ obj: Record<string, unknown>; indent: number; key?: string }> = [
        { obj: result, indent: -1 }
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip empty lines and comments
        if (!line.trim() || line.trim().startsWith('#')) continue;

        const indent = line.search(/\S/);
        const trimmed = line.trim();

        // Pop stack to find correct parent
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }
        const parent = stack[stack.length - 1].obj;

        // Handle array items
        if (trimmed.startsWith('- ')) {
            const itemContent = trimmed.slice(2).trim();
            const parentKey = stack[stack.length - 1].key;

            if (parentKey && !Array.isArray(parent[parentKey])) {
                parent[parentKey] = [];
            }

            const arr = parentKey ? parent[parentKey] as unknown[] : [];

            if (itemContent.includes(':')) {
                // Object in array
                const colonIdx = itemContent.indexOf(':');
                const key = itemContent.slice(0, colonIdx).trim();
                const value = itemContent.slice(colonIdx + 1).trim();
                const itemObj: Record<string, unknown> = {};
                if (value) {
                    itemObj[key] = parseYamlValue(value);
                }
                arr.push(itemObj);
                stack.push({ obj: itemObj, indent, key });
            } else if (itemContent) {
                arr.push(parseYamlValue(itemContent));
            }
        } else if (trimmed.includes(':')) {
            // Key-value pair
            const colonIdx = trimmed.indexOf(':');
            const key = trimmed.slice(0, colonIdx).trim();
            const value = trimmed.slice(colonIdx + 1).trim();

            if (value === '' || value === null) {
                // Nested object or array - check next line
                const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
                if (nextLine.startsWith('- ')) {
                    parent[key] = [];
                    stack.push({ obj: parent, indent, key });
                } else {
                    const nested: Record<string, unknown> = {};
                    parent[key] = nested;
                    stack.push({ obj: nested, indent, key });
                }
            } else {
                parent[key] = parseYamlValue(value);
            }
        }
    }

    return result;
}

/**
 * Save publish configuration to file
 */
export async function saveConfig(
    workspaceRoot: string,
    config: PublishConfig
): Promise<void> {
    const configPath = path.join(workspaceRoot, CONFIG_FILENAME);
    const content = JSON.stringify(config, null, 2);
    await fs.promises.writeFile(configPath, content, 'utf-8');
}

/**
 * Save publish configuration as YAML
 */
export async function saveConfigYaml(
    workspaceRoot: string,
    config: PublishConfig
): Promise<void> {
    const configPath = path.join(workspaceRoot, CONFIG_YAML_FILENAME);
    const content = configToYaml(config);
    await fs.promises.writeFile(configPath, content, 'utf-8');
}

/**
 * Convert PublishConfig to YAML string
 */
function configToYaml(config: PublishConfig): string {
    const lines: string[] = [
        '# Scimax Publishing Configuration',
        '# Compatible with Jupyter Book format',
        '',
    ];

    // Get default project
    const projectName = config.defaultProject || Object.keys(config.projects)[0];
    const project = config.projects[projectName];

    if (project && !('components' in project)) {
        const p = project as PublishProject;

        if (p.sitemapTitle) lines.push(`title: "${p.sitemapTitle}"`);
        lines.push('');

        // Publish settings
        lines.push('publish:');
        lines.push(`  base_directory: "${p.baseDirectory}"`);
        lines.push(`  publishing_directory: "${p.publishingDirectory}"`);
        if (p.recursive !== undefined) lines.push(`  recursive: ${p.recursive}`);
        if (p.exclude) lines.push(`  exclude: "${p.exclude}"`);
        if (p.autoSitemap !== undefined) lines.push(`  auto_sitemap: ${p.autoSitemap}`);
        if (p.sitemapFilename) lines.push(`  sitemap_filename: "${p.sitemapFilename}"`);
        lines.push('');

        // HTML settings
        lines.push('html:');
        if (p.useDefaultTheme !== undefined) lines.push(`  use_default_theme: ${p.useDefaultTheme}`);
        if (p.withToc !== undefined) lines.push(`  toc_depth: ${typeof p.withToc === 'number' ? p.withToc : 3}`);
        if (p.cssFiles && p.cssFiles.length > 0) {
            lines.push('  css_files:');
            for (const css of p.cssFiles) {
                lines.push(`    - "${css}"`);
            }
        }
        lines.push('');
    }

    // Global settings
    if (config.githubPages !== undefined) lines.push(`github_pages: ${config.githubPages}`);
    if (config.customDomain) lines.push(`custom_domain: "${config.customDomain}"`);

    return lines.join('\n');
}

// =============================================================================
// TOC Loading
// =============================================================================

/**
 * Simple YAML parser for _toc.yml files
 * Handles the subset of YAML used by Jupyter Book TOC format
 */
function parseSimpleYaml(content: string): TocConfig {
    const lines = content.split('\n');
    let lineIndex = 0;

    function parseValue(startIndent: number): unknown {
        const result: Record<string, unknown> = {};

        while (lineIndex < lines.length) {
            const line = lines[lineIndex];

            // Skip empty lines and comments
            if (!line.trim() || line.trim().startsWith('#')) {
                lineIndex++;
                continue;
            }

            const indent = line.search(/\S/);

            // If we've dedented, return to parent
            if (indent < startIndent) {
                return result;
            }

            const trimmed = line.trim();
            lineIndex++;

            // Handle array items at this level
            if (trimmed.startsWith('- ')) {
                // This shouldn't happen at object level - go back
                lineIndex--;
                return result;
            }

            // Handle key: value
            if (trimmed.includes(':')) {
                const colonIdx = trimmed.indexOf(':');
                const key = trimmed.slice(0, colonIdx).trim();
                const valueStr = trimmed.slice(colonIdx + 1).trim();

                if (valueStr) {
                    // Inline value
                    result[key] = parseYamlValue(valueStr);
                } else {
                    // Check what follows
                    const nextNonEmpty = peekNextNonEmpty();
                    if (nextNonEmpty && nextNonEmpty.trimmed.startsWith('- ')) {
                        // It's an array
                        result[key] = parseArray(nextNonEmpty.indent);
                    } else if (nextNonEmpty && nextNonEmpty.indent > indent) {
                        // It's a nested object
                        result[key] = parseValue(nextNonEmpty.indent);
                    }
                }
            }
        }

        return result;
    }

    function parseArray(arrayIndent: number): unknown[] {
        const arr: unknown[] = [];

        while (lineIndex < lines.length) {
            const line = lines[lineIndex];

            // Skip empty lines and comments
            if (!line.trim() || line.trim().startsWith('#')) {
                lineIndex++;
                continue;
            }

            const indent = line.search(/\S/);
            const trimmed = line.trim();

            // If we've dedented past the array, return
            if (indent < arrayIndent) {
                return arr;
            }

            // Non-array item at same or greater indent - belongs to last array item
            if (!trimmed.startsWith('- ') && indent >= arrayIndent) {
                // This is a property of the last array item
                if (arr.length > 0 && typeof arr[arr.length - 1] === 'object') {
                    const lastItem = arr[arr.length - 1] as Record<string, unknown>;
                    // Parse this key-value into the last item
                    const colonIdx = trimmed.indexOf(':');
                    if (colonIdx > 0) {
                        const key = trimmed.slice(0, colonIdx).trim();
                        const valueStr = trimmed.slice(colonIdx + 1).trim();
                        lineIndex++;

                        if (valueStr) {
                            lastItem[key] = parseYamlValue(valueStr);
                        } else {
                            const nextNonEmpty = peekNextNonEmpty();
                            if (nextNonEmpty && nextNonEmpty.trimmed.startsWith('- ')) {
                                lastItem[key] = parseArray(nextNonEmpty.indent);
                            } else if (nextNonEmpty && nextNonEmpty.indent > indent) {
                                lastItem[key] = parseValue(nextNonEmpty.indent);
                            }
                        }
                        continue;
                    }
                }
                lineIndex++;
                continue;
            }

            if (!trimmed.startsWith('- ')) {
                return arr;
            }

            lineIndex++;
            const itemContent = trimmed.slice(2).trim();

            if (itemContent.includes(':')) {
                // Object starting on this line
                const colonIdx = itemContent.indexOf(':');
                const key = itemContent.slice(0, colonIdx).trim();
                const valueStr = itemContent.slice(colonIdx + 1).trim();

                const itemObj: Record<string, unknown> = {};
                if (valueStr) {
                    itemObj[key] = parseYamlValue(valueStr);
                } else {
                    // Check for nested content
                    const nextNonEmpty = peekNextNonEmpty();
                    if (nextNonEmpty && nextNonEmpty.trimmed.startsWith('- ')) {
                        itemObj[key] = parseArray(nextNonEmpty.indent);
                    } else if (nextNonEmpty && nextNonEmpty.indent > indent + 2) {
                        itemObj[key] = parseValue(nextNonEmpty.indent);
                    }
                }
                arr.push(itemObj);
            } else if (itemContent) {
                // Simple value
                arr.push(parseYamlValue(itemContent));
            } else {
                // Empty dash - next lines define the object
                const itemObj: Record<string, unknown> = {};
                arr.push(itemObj);
                // Parse properties into this object
                while (lineIndex < lines.length) {
                    const nextLine = lines[lineIndex];
                    if (!nextLine.trim() || nextLine.trim().startsWith('#')) {
                        lineIndex++;
                        continue;
                    }
                    const nextIndent = nextLine.search(/\S/);
                    if (nextIndent <= indent) break;

                    const nextTrimmed = nextLine.trim();
                    if (nextTrimmed.startsWith('- ')) break;

                    lineIndex++;
                    const nextColonIdx = nextTrimmed.indexOf(':');
                    if (nextColonIdx > 0) {
                        const nextKey = nextTrimmed.slice(0, nextColonIdx).trim();
                        const nextValue = nextTrimmed.slice(nextColonIdx + 1).trim();

                        if (nextValue) {
                            itemObj[nextKey] = parseYamlValue(nextValue);
                        } else {
                            const peek = peekNextNonEmpty();
                            if (peek && peek.trimmed.startsWith('- ')) {
                                itemObj[nextKey] = parseArray(peek.indent);
                            }
                        }
                    }
                }
            }
        }

        return arr;
    }

    function peekNextNonEmpty(): { indent: number; trimmed: string } | null {
        for (let i = lineIndex; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() && !line.trim().startsWith('#')) {
                return {
                    indent: line.search(/\S/),
                    trimmed: line.trim(),
                };
            }
        }
        return null;
    }

    const result = parseValue(0);
    return result as unknown as TocConfig;
}

/**
 * Parse a YAML value (string, number, boolean)
 */
function parseYamlValue(value: string): string | number | boolean {
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }

    // Check for boolean
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Check for number
    const num = Number(value);
    if (!isNaN(num) && value !== '') return num;

    return value;
}

/**
 * Load TOC configuration from _toc.yml file
 */
export async function loadToc(
    project: PublishProject,
    workspaceRoot: string
): Promise<TocConfig | null> {
    const baseDir = path.resolve(workspaceRoot, project.baseDirectory);
    const tocPath = path.join(baseDir, TOC_FILENAME);

    try {
        const content = await fs.promises.readFile(tocPath, 'utf-8');
        return parseSimpleYaml(content);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

// =============================================================================
// File Discovery
// =============================================================================

/**
 * Find all files to publish in a project
 */
export async function discoverFiles(
    project: PublishProject,
    workspaceRoot: string
): Promise<string[]> {
    const baseDir = path.resolve(workspaceRoot, project.baseDirectory);
    const extension = project.baseExtension || 'org';
    const files: string[] = [];

    async function scanDir(dir: string): Promise<void> {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(baseDir, fullPath);

            // Check exclusion pattern
            if (project.exclude) {
                if (minimatch(relativePath, project.exclude) ||
                    minimatch(entry.name, project.exclude)) {
                    continue;
                }
            }

            if (entry.isDirectory()) {
                if (project.recursive) {
                    await scanDir(fullPath);
                }
            } else if (entry.isFile()) {
                // Check extension
                const extPattern = new RegExp(`\\.(${extension})$`, 'i');
                if (extPattern.test(entry.name)) {
                    files.push(fullPath);
                }
            }
        }
    }

    // Check base directory exists
    try {
        await fs.promises.access(baseDir);
    } catch {
        throw new Error(`Base directory does not exist: ${baseDir}`);
    }

    await scanDir(baseDir);

    // Add explicit includes
    if (project.include) {
        for (const pattern of project.include) {
            const globPath = path.join(baseDir, pattern);
            // Simple glob handling - for now just check if file exists
            if (await fileExists(globPath)) {
                if (!files.includes(globPath)) {
                    files.push(globPath);
                }
            }
        }
    }

    return files;
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Recursively copy a directory
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
    await fs.promises.mkdir(dest, { recursive: true });

    const entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyDirectory(srcPath, destPath);
        } else {
            await fs.promises.copyFile(srcPath, destPath);
        }
    }
}

// =============================================================================
// File Publishing
// =============================================================================

/**
 * Extract metadata from an org document
 */
function extractMetadata(doc: OrgDocumentNode): { title?: string; date?: string } {
    return {
        title: doc.keywords['TITLE'],
        date: doc.keywords['DATE'],
    };
}

/**
 * Compute output path for a source file
 */
export function computeOutputPath(
    sourcePath: string,
    project: PublishProject,
    workspaceRoot: string
): string {
    const baseDir = path.resolve(workspaceRoot, project.baseDirectory);
    const outputDir = path.resolve(workspaceRoot, project.publishingDirectory);

    // Get relative path from base directory
    const relativePath = path.relative(baseDir, sourcePath);

    // Change extension to .html (supports .org, .md, .ipynb)
    const htmlPath = relativePath.replace(/\.(org|md|ipynb)$/i, '.html');

    return path.join(outputDir, htmlPath);
}

/**
 * Check if output file is up to date
 */
async function isUpToDate(sourcePath: string, outputPath: string): Promise<boolean> {
    try {
        const [sourceStat, outputStat] = await Promise.all([
            fs.promises.stat(sourcePath),
            fs.promises.stat(outputPath),
        ]);
        return outputStat.mtime > sourceStat.mtime;
    } catch {
        return false;
    }
}

/**
 * Load template content from file or return as-is if it's HTML
 */
async function loadTemplate(
    template: string | undefined,
    workspaceRoot: string
): Promise<string | undefined> {
    if (!template) {
        return undefined;
    }

    // Check if it looks like a file path
    if (template.startsWith('./') || template.startsWith('../') || template.startsWith('/')) {
        const templatePath = path.resolve(workspaceRoot, template);
        try {
            return await fs.promises.readFile(templatePath, 'utf-8');
        } catch {
            // Fall back to treating as literal HTML
            return template;
        }
    }

    return template;
}

/**
 * Publish a single org file to HTML
 */
export async function publishFile(
    sourcePath: string,
    project: PublishProject,
    workspaceRoot: string,
    options: PublishOptions = {},
    tocEntry?: FlatTocEntry | null
): Promise<PublishFileResult> {
    const outputPath = computeOutputPath(sourcePath, project, workspaceRoot);

    // Check if up to date (unless force)
    if (!options.force && await isUpToDate(sourcePath, outputPath)) {
        return {
            sourcePath,
            outputPath,
            success: true,
        };
    }

    try {
        // Read source file
        let content = await fs.promises.readFile(sourcePath, 'utf-8');

        // Process includes
        if (hasIncludes(content)) {
            content = processIncludes(content, {
                basePath: path.dirname(sourcePath),
                recursive: true,
                maxDepth: 10,
            });
        }

        // Parse the document
        const doc = parseOrgFast(content);
        const metadata = extractMetadata(doc);

        // Load templates
        let preambleContent = await loadTemplate(project.htmlPreamble, workspaceRoot);
        let postambleContent = await loadTemplate(project.htmlPostamble, workspaceRoot);

        // Add navigation links from TOC
        if (tocEntry) {
            const navHtml = generateNavigation(tocEntry);
            if (navHtml) {
                // Append navigation to postamble
                postambleContent = (postambleContent || '') + navHtml;
            }
        }

        // Build HTML export options
        const htmlOptions: Partial<HtmlExportOptions> = {
            ...toHtmlExportOptions(project),
            preambleContent,
            postambleContent,
        };

        // Export to HTML
        const html = exportToHtml(doc, htmlOptions);

        if (!options.dryRun) {
            // Ensure output directory exists
            const outputDir = path.dirname(outputPath);
            await fs.promises.mkdir(outputDir, { recursive: true });

            // Write output file
            await fs.promises.writeFile(outputPath, html, 'utf-8');
        }

        return {
            sourcePath,
            outputPath,
            success: true,
            title: metadata.title,
            date: metadata.date ? new Date(metadata.date) : undefined,
        };
    } catch (error) {
        return {
            sourcePath,
            outputPath,
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Generate navigation HTML from TOC entry
 */
function generateNavigation(tocEntry: FlatTocEntry): string {
    if (!tocEntry.prev && !tocEntry.next) {
        return '';
    }

    const parts: string[] = ['<nav class="page-navigation">'];

    if (tocEntry.prev) {
        const prevHtml = `${tocEntry.prev}.html`;
        parts.push(`  <a href="${prevHtml}" class="nav-prev">← Previous</a>`);
    } else {
        parts.push('  <span class="nav-prev"></span>');
    }

    if (tocEntry.next) {
        const nextHtml = `${tocEntry.next}.html`;
        parts.push(`  <a href="${nextHtml}" class="nav-next">Next →</a>`);
    } else {
        parts.push('  <span class="nav-next"></span>');
    }

    parts.push('</nav>');

    return parts.join('\n');
}

// =============================================================================
// Theme-based Publishing
// =============================================================================

/**
 * Extended publish result with content for search indexing
 */
interface PublishFileResultWithContent extends PublishFileResult {
    /** Plain text content for search indexing */
    plainContent?: string;
    /** Page headings for search indexing */
    headings?: Array<{ id: string; text: string }>;
}

/**
 * Publish a file using the theme system
 */
export async function publishFileWithTheme(
    sourcePath: string,
    project: PublishProject,
    workspaceRoot: string,
    options: PublishOptions,
    theme: Theme,
    projectContext: ProjectContext,
    tocEntry?: FlatTocEntry | null
): Promise<PublishFileResultWithContent> {
    const outputPath = computeOutputPath(sourcePath, project, workspaceRoot);
    const baseDir = path.resolve(workspaceRoot, project.baseDirectory);
    const relativePath = path.relative(baseDir, sourcePath);
    const relativeHtmlPath = relativePath.replace(/\.(org|md|ipynb)$/i, '.html');

    // Check if up to date (unless force)
    if (!options.force && await isUpToDate(sourcePath, outputPath)) {
        return {
            sourcePath,
            outputPath,
            success: true,
        };
    }

    try {
        // Read source file
        let content = await fs.promises.readFile(sourcePath, 'utf-8');

        // Process includes
        if (hasIncludes(content)) {
            content = processIncludes(content, {
                basePath: path.dirname(sourcePath),
                recursive: true,
                maxDepth: 10,
            });
        }

        // Parse the document
        const doc = parseOrgFast(content);
        const metadata = extractMetadata(doc);
        const title = metadata.title || path.basename(sourcePath, path.extname(sourcePath));

        // Export to HTML (body only - no document wrapper)
        const htmlOptions: Partial<HtmlExportOptions> = {
            ...toHtmlExportOptions(project),
            bodyOnly: true,
        };
        const bodyContent = exportToHtml(doc, htmlOptions);

        // Extract headings for right sidebar TOC
        const tocDepth = projectContext.config.layout?.toc_depth || 3;
        const pageHeadings = extractPageHeadings(bodyContent, tocDepth);

        // Create page context
        const pageContext: PageContext = {
            title,
            content: bodyContent,
            tocEntry: tocEntry || undefined,
            pageHeadings,
            relativePath: relativeHtmlPath,
            sourcePath,
        };

        // Render with theme
        const html = theme.renderPage(bodyContent, pageContext, projectContext);

        if (!options.dryRun) {
            // Ensure output directory exists
            const outputDir = path.dirname(outputPath);
            await fs.promises.mkdir(outputDir, { recursive: true });

            // Write output file
            await fs.promises.writeFile(outputPath, html, 'utf-8');
        }

        // Extract plain text for search indexing
        const plainContent = stripHtmlTags(bodyContent);

        return {
            sourcePath,
            outputPath,
            success: true,
            title,
            date: metadata.date ? new Date(metadata.date) : undefined,
            plainContent,
            headings: pageHeadings.map(h => ({ id: h.id, text: h.text })),
        };
    } catch (error) {
        return {
            sourcePath,
            outputPath,
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Strip HTML tags from content (for search indexing)
 */
function stripHtmlTags(html: string): string {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

/**
 * Publish a project with theme support
 */
export async function publishProjectWithTheme(
    project: PublishProject,
    workspaceRoot: string,
    options: PublishOptions,
    themeConfig: ThemeConfig
): Promise<PublishProjectResult> {
    const startTime = Date.now();
    const results: PublishFileResultWithContent[] = [];
    const baseDir = path.resolve(workspaceRoot, project.baseDirectory);
    const outputDir = path.resolve(workspaceRoot, project.publishingDirectory);

    // Load TOC
    const toc = await loadToc(project, workspaceRoot);
    if (!toc) {
        // Theme requires a TOC for navigation
        throw new Error('Theme-based publishing requires a _toc.yml file');
    }

    const flatToc = flattenToc(toc);

    // Get theme
    const theme = getThemeForConfig(themeConfig);

    // Create project context
    const projectContext: ProjectContext = {
        config: themeConfig,
        flatToc,
        tocConfig: toc,
        parts: toc.parts,
        outputDir,
        baseDir,
        workspaceRoot,
    };

    // Copy theme assets first
    if (!options.dryRun) {
        await theme.copyAssets(outputDir);

        // Copy user's _static folder if it exists
        const sourceStaticDir = path.join(baseDir, '_static');
        const outputStaticDir = path.join(outputDir, '_static');
        if (await fileExists(sourceStaticDir)) {
            await copyDirectory(sourceStaticDir, outputStaticDir);
        }
    }

    // Discover files from TOC
    const files = await resolveFilesFromToc(flatToc, project, workspaceRoot);

    // Publish each file
    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (options.onProgress) {
            options.onProgress(i + 1, files.length, path.basename(file));
        }

        const relativePath = path.relative(baseDir, file);
        const tocEntry = findTocEntryByPath(flatToc, relativePath);

        // Determine file type
        const ext = path.extname(file).toLowerCase();

        let result: PublishFileResultWithContent;

        if (ext === '.org') {
            result = await publishFileWithTheme(
                file, project, workspaceRoot, options,
                theme, projectContext, tocEntry
            );
        } else {
            // For non-org files, use standard publishing (no theme)
            const pubFunc = getPublishFunction(file, project);
            switch (pubFunc) {
                case 'md':
                    result = await publishMarkdownFile(file, project, workspaceRoot, options, tocEntry);
                    break;
                case 'ipynb':
                    result = await publishNotebookFile(file, project, workspaceRoot, options, tocEntry);
                    break;
                case 'copy':
                default:
                    result = await copyStaticFile(file, project, workspaceRoot, options);
                    break;
            }
        }

        results.push(result);
    }

    // Generate search index if enabled
    if (themeConfig.search?.enabled !== false && theme.generateSearchIndex && !options.dryRun) {
        const pageInfos: PageInfo[] = results
            .filter(r => r.success && r.plainContent)
            .map(r => ({
                title: r.title || path.basename(r.outputPath, '.html'),
                path: path.relative(outputDir, r.outputPath),
                content: r.plainContent || '',
                headings: r.headings || [],
            }));

        await theme.generateSearchIndex(pageInfos, outputDir);
    }

    const duration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;

    return {
        projectName: project.name,
        files: results,
        totalFiles: results.length,
        successCount,
        errorCount,
        duration,
    };
}

/**
 * Copy a static file
 */
export async function copyStaticFile(
    sourcePath: string,
    project: PublishProject,
    workspaceRoot: string,
    options: PublishOptions = {}
): Promise<PublishFileResult> {
    const baseDir = path.resolve(workspaceRoot, project.baseDirectory);
    const outputDir = path.resolve(workspaceRoot, project.publishingDirectory);
    const relativePath = path.relative(baseDir, sourcePath);
    const outputPath = path.join(outputDir, relativePath);

    // Check if up to date
    if (!options.force && await isUpToDate(sourcePath, outputPath)) {
        return {
            sourcePath,
            outputPath,
            success: true,
        };
    }

    try {
        if (!options.dryRun) {
            // Ensure output directory exists
            const outputDirPath = path.dirname(outputPath);
            await fs.promises.mkdir(outputDirPath, { recursive: true });

            // Copy file
            await fs.promises.copyFile(sourcePath, outputPath);
        }

        return {
            sourcePath,
            outputPath,
            success: true,
        };
    } catch (error) {
        return {
            sourcePath,
            outputPath,
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Publish a Markdown file to HTML
 */
export async function publishMarkdownFile(
    sourcePath: string,
    project: PublishProject,
    workspaceRoot: string,
    options: PublishOptions = {},
    tocEntry?: FlatTocEntry | null
): Promise<PublishFileResult> {
    const outputPath = computeOutputPath(sourcePath, project, workspaceRoot);

    // Check if up to date (unless force)
    if (!options.force && await isUpToDate(sourcePath, outputPath)) {
        return { sourcePath, outputPath, success: true };
    }

    try {
        const content = await fs.promises.readFile(sourcePath, 'utf-8');

        // Extract title from first # heading or filename
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1] : path.basename(sourcePath, '.md');

        // Simple Markdown to HTML conversion
        let html = convertMarkdownToHtml(content, title, project);

        // Add navigation from TOC
        if (tocEntry) {
            const navHtml = generateNavigation(tocEntry);
            if (navHtml) {
                // Insert before closing </main>
                html = html.replace('</main>', `${navHtml}\n</main>`);
            }
        }

        if (!options.dryRun) {
            const outputDir = path.dirname(outputPath);
            await fs.promises.mkdir(outputDir, { recursive: true });
            await fs.promises.writeFile(outputPath, html, 'utf-8');
        }

        return {
            sourcePath,
            outputPath,
            success: true,
            title,
        };
    } catch (error) {
        return {
            sourcePath,
            outputPath,
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Simple Markdown to HTML converter
 */
function convertMarkdownToHtml(content: string, title: string, project: PublishProject): string {
    let html = content;

    // Convert headers
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // Convert code blocks
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
        const langClass = lang ? ` class="language-${lang}"` : '';
        return `<pre><code${langClass}>${escapeHtml(code.trim())}</code></pre>`;
    });

    // Convert inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Convert bold and italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Convert links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
        // Convert .md links to .html
        const href = url.replace(/\.md$/i, '.html');
        return `<a href="${href}">${text}</a>`;
    });

    // Convert images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');

    // Convert unordered lists
    html = html.replace(/^(\s*)-\s+(.+)$/gm, '$1<li>$2</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>\n$&</ul>\n');

    // Convert paragraphs (lines not already in tags)
    html = html.split('\n\n').map(block => {
        if (block.trim() && !block.match(/^<[a-z]/i)) {
            return `<p>${block.trim()}</p>`;
        }
        return block;
    }).join('\n\n');

    // Wrap in HTML document
    return wrapInHtmlDoc(html, title, project);
}

/**
 * Publish a Jupyter notebook to HTML
 */
export async function publishNotebookFile(
    sourcePath: string,
    project: PublishProject,
    workspaceRoot: string,
    options: PublishOptions = {},
    tocEntry?: FlatTocEntry | null
): Promise<PublishFileResult> {
    const outputPath = computeOutputPath(sourcePath, project, workspaceRoot);

    // Check if up to date (unless force)
    if (!options.force && await isUpToDate(sourcePath, outputPath)) {
        return { sourcePath, outputPath, success: true };
    }

    try {
        const content = await fs.promises.readFile(sourcePath, 'utf-8');
        const notebook = parseNotebook(content);

        // Get title from metadata or first markdown heading
        let title = notebook.metadata.title || path.basename(sourcePath, '.ipynb');
        if (notebook.headings.length > 0) {
            title = notebook.headings[0].title;
        }

        // Convert notebook to HTML
        let html = convertNotebookToHtml(notebook, title, project);

        // Add navigation from TOC
        if (tocEntry) {
            const navHtml = generateNavigation(tocEntry);
            if (navHtml) {
                // Insert before closing </main>
                html = html.replace('</main>', `${navHtml}\n</main>`);
            }
        }

        if (!options.dryRun) {
            const outputDir = path.dirname(outputPath);
            await fs.promises.mkdir(outputDir, { recursive: true });
            await fs.promises.writeFile(outputPath, html, 'utf-8');
        }

        return {
            sourcePath,
            outputPath,
            success: true,
            title,
        };
    } catch (error) {
        return {
            sourcePath,
            outputPath,
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Convert Jupyter notebook to HTML
 */
function convertNotebookToHtml(
    notebook: ReturnType<typeof parseNotebook>,
    title: string,
    project: PublishProject
): string {
    const parts: string[] = [];

    for (const cell of notebook.cells) {
        if (cell.cellType === 'markdown') {
            // Convert markdown cell
            let html = cell.source;
            // Simple markdown conversions
            html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
            html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
            html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
            html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
            html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
            html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
            parts.push(`<div class="cell markdown-cell">${html}</div>`);
        } else if (cell.cellType === 'code') {
            const lang = cell.language || notebook.metadata.language || 'python';
            parts.push(`<div class="cell code-cell">
<pre class="src src-${lang}"><code class="language-${lang}">${escapeHtml(cell.source)}</code></pre>
</div>`);
        }
    }

    const body = parts.join('\n');
    return wrapInHtmlDoc(body, title, project);
}

/**
 * Wrap content in HTML document structure
 */
function wrapInHtmlDoc(content: string, title: string, project: PublishProject): string {
    const cssFiles = project.cssFiles?.map(f => `<link rel="stylesheet" href="${f}" />`).join('\n') || '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
${cssFiles}
<style>
.org-content { max-width: 800px; margin: 0 auto; padding: 2rem; font-family: system-ui, sans-serif; line-height: 1.6; }
.cell { margin: 1rem 0; }
.code-cell pre { background: #f8f9fa; padding: 1rem; border-radius: 4px; overflow-x: auto; }
.markdown-cell { margin: 1rem 0; }
pre code { font-family: monospace; }
</style>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/default.min.css" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script>hljs.highlightAll();</script>
</head>
<body>
<main class="org-content">
<header id="title-block">
<h1 class="title">${escapeHtml(title)}</h1>
</header>
${content}
</main>
</body>
</html>`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Determine which publish function to use based on file extension
 */
function getPublishFunction(
    sourcePath: string,
    project: PublishProject
): 'org' | 'md' | 'ipynb' | 'copy' {
    const ext = path.extname(sourcePath).toLowerCase();
    const pubFunc = project.publishingFunction || 'auto';

    if (pubFunc === 'copy') {
        return 'copy';
    }

    if (pubFunc === 'auto' || pubFunc === 'org-html-publish-to-html') {
        if (ext === '.org') return 'org';
        if (ext === '.md') return 'md';
        if (ext === '.ipynb') return 'ipynb';
    }

    if (pubFunc === 'md-html-publish-to-html') return 'md';
    if (pubFunc === 'ipynb-html-publish-to-html') return 'ipynb';

    // Default based on extension
    if (ext === '.org') return 'org';
    if (ext === '.md') return 'md';
    if (ext === '.ipynb') return 'ipynb';

    return 'copy';
}

// =============================================================================
// Sitemap Generation
// =============================================================================

/**
 * Sitemap entry
 */
interface SitemapEntry {
    file: string;
    relativePath: string;
    title: string;
    date?: Date;
}

/**
 * Generate sitemap content (as org-mode)
 */
export function generateSitemapOrg(
    entries: SitemapEntry[],
    project: PublishProject
): string {
    const title = project.sitemapTitle || 'Site Map';
    const sortOrder = project.sitemapSortFiles || 'alphabetically';

    // Sort entries
    const sorted = [...entries].sort((a, b) => {
        switch (sortOrder) {
            case 'chronologically':
                return (a.date?.getTime() || 0) - (b.date?.getTime() || 0);
            case 'anti-chronologically':
                return (b.date?.getTime() || 0) - (a.date?.getTime() || 0);
            default:
                return a.title.localeCompare(b.title);
        }
    });

    const lines: string[] = [
        `#+TITLE: ${title}`,
        `#+DATE: ${new Date().toISOString().split('T')[0]}`,
        '',
    ];

    if (project.sitemapStyle === 'tree') {
        // Tree-style sitemap (organized by directory)
        const byDir = new Map<string, SitemapEntry[]>();

        for (const entry of sorted) {
            const dir = path.dirname(entry.relativePath);
            if (!byDir.has(dir)) {
                byDir.set(dir, []);
            }
            byDir.get(dir)!.push(entry);
        }

        for (const [dir, dirEntries] of byDir) {
            if (dir !== '.') {
                lines.push(`* ${dir}`);
            }
            for (const entry of dirEntries) {
                const htmlPath = entry.relativePath.replace(/\.(org|md|ipynb)$/i, '.html');
                const dateStr = entry.date ? ` (${entry.date.toISOString().split('T')[0]})` : '';
                lines.push(`- [[file:${htmlPath}][${entry.title}]]${dateStr}`);
            }
            lines.push('');
        }
    } else {
        // List-style sitemap
        for (const entry of sorted) {
            const htmlPath = entry.relativePath.replace(/\.(org|md|ipynb)$/i, '.html');
            const dateStr = entry.date ? ` (${entry.date.toISOString().split('T')[0]})` : '';
            lines.push(`- [[file:${htmlPath}][${entry.title}]]${dateStr}`);
        }
    }

    return lines.join('\n');
}

// =============================================================================
// Project Publishing
// =============================================================================

/**
 * Publish a single project
 */
export async function publishProject(
    project: PublishProject,
    workspaceRoot: string,
    options: PublishOptions = {}
): Promise<PublishProjectResult> {
    const startTime = Date.now();
    const results: PublishFileResult[] = [];
    const baseDir = path.resolve(workspaceRoot, project.baseDirectory);

    // Try to load explicit TOC
    const toc = await loadToc(project, workspaceRoot);
    let flatToc: FlatTocEntry[] | null = null;

    // Discover files - use TOC if available, otherwise discover
    let files: string[];
    if (toc) {
        // Use TOC to determine file order
        flatToc = flattenToc(toc);
        files = await resolveFilesFromToc(flatToc, project, workspaceRoot);
    } else {
        // Fall back to directory discovery
        files = await discoverFiles(project, workspaceRoot);
    }

    // Publish each file
    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (options.onProgress) {
            options.onProgress(i + 1, files.length, path.basename(file));
        }

        let result: PublishFileResult;
        const pubFunc = getPublishFunction(file, project);

        // Get TOC entry for navigation
        const relativePath = path.relative(baseDir, file);
        const tocEntry = flatToc ? findTocEntryByPath(flatToc, relativePath) : null;

        switch (pubFunc) {
            case 'copy':
                result = await copyStaticFile(file, project, workspaceRoot, options);
                break;
            case 'md':
                result = await publishMarkdownFile(file, project, workspaceRoot, options, tocEntry);
                break;
            case 'ipynb':
                result = await publishNotebookFile(file, project, workspaceRoot, options, tocEntry);
                break;
            case 'org':
            default:
                result = await publishFile(file, project, workspaceRoot, options, tocEntry);
                break;
        }

        results.push(result);
    }

    // Generate sitemap/index
    if (project.autoSitemap && project.publishingFunction !== 'copy') {
        if (toc && flatToc) {
            // Generate index from explicit TOC
            const indexOrg = generateIndexFromToc(toc, flatToc, results, project);

            // Write index.org
            const indexFilename = project.sitemapFilename || 'index.org';
            const indexOrgPath = path.join(baseDir, indexFilename);

            if (!options.dryRun) {
                await fs.promises.writeFile(indexOrgPath, indexOrg, 'utf-8');
            }

            // Publish index
            const indexResult = await publishFile(
                indexOrgPath,
                project,
                workspaceRoot,
                { ...options, force: true }
            );
            results.push(indexResult);
        } else {
            // Fall back to auto-generated sitemap
            const sitemapEntries: SitemapEntry[] = results
                .filter(r => r.success)
                .map(r => {
                    const ext = path.extname(r.sourcePath);
                    return {
                        file: r.sourcePath,
                        relativePath: path.relative(baseDir, r.sourcePath),
                        title: r.title || path.basename(r.sourcePath, ext),
                        date: r.date,
                    };
                });

            if (sitemapEntries.length > 0) {
                // Generate sitemap org content
                const sitemapOrg = generateSitemapOrg(sitemapEntries, project);

                // Write sitemap.org
                const sitemapFilename = project.sitemapFilename || 'sitemap.org';
                const sitemapOrgPath = path.join(baseDir, sitemapFilename);

                if (!options.dryRun) {
                    await fs.promises.writeFile(sitemapOrgPath, sitemapOrg, 'utf-8');
                }

                // Publish sitemap
                const sitemapResult = await publishFile(
                    sitemapOrgPath,
                    project,
                    workspaceRoot,
                    { ...options, force: true }
                );
                results.push(sitemapResult);
            }
        }
    }

    const duration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;

    return {
        projectName: project.name,
        files: results,
        totalFiles: results.length,
        successCount,
        errorCount,
        duration,
    };
}

/**
 * Resolve file paths from TOC entries
 */
async function resolveFilesFromToc(
    flatToc: FlatTocEntry[],
    project: PublishProject,
    workspaceRoot: string
): Promise<string[]> {
    const baseDir = path.resolve(workspaceRoot, project.baseDirectory);
    const files: string[] = [];

    for (const entry of flatToc) {
        // Try common extensions
        const extensions = ['org', 'md', 'ipynb'];
        let found = false;

        for (const ext of extensions) {
            const filePath = path.join(baseDir, `${entry.file}.${ext}`);
            if (await fileExists(filePath)) {
                files.push(filePath);
                found = true;
                break;
            }
        }

        // Also try exact path (if extension already included)
        if (!found) {
            const exactPath = path.join(baseDir, entry.file);
            if (await fileExists(exactPath)) {
                files.push(exactPath);
            }
        }
    }

    return files;
}

/**
 * Find TOC entry by file path
 */
function findTocEntryByPath(flatToc: FlatTocEntry[], relativePath: string): FlatTocEntry | null {
    // Normalize path (remove extension for comparison)
    const normalized = relativePath.replace(/\.(org|md|ipynb)$/i, '');

    for (const entry of flatToc) {
        if (entry.file === normalized || entry.file === relativePath) {
            return entry;
        }
    }
    return null;
}

/**
 * Generate index page from explicit TOC
 */
function generateIndexFromToc(
    toc: TocConfig,
    flatToc: FlatTocEntry[],
    results: PublishFileResult[],
    project: PublishProject
): string {
    const title = project.sitemapTitle || 'Table of Contents';
    const lines: string[] = [
        `#+TITLE: ${title}`,
        '',
    ];

    // Create a map of file paths to titles
    const titleMap = new Map<string, string>();
    for (const result of results) {
        if (result.success && result.title) {
            const relativePath = path.relative(
                path.resolve('.', project.baseDirectory),
                result.sourcePath
            ).replace(/\.(org|md|ipynb)$/i, '');
            titleMap.set(relativePath, result.title);
        }
    }

    // Generate structure based on TOC
    if (toc.parts) {
        for (const part of toc.parts) {
            lines.push(`* ${part.caption}`);
            lines.push('');

            if (part.chapters) {
                generateTocSection(part.chapters, lines, titleMap, 0);
            }
        }
    } else if (toc.chapters) {
        generateTocSection(toc.chapters, lines, titleMap, 0);
    }

    return lines.join('\n');
}

/**
 * Generate TOC section recursively
 */
function generateTocSection(
    entries: Array<{ file?: string; title?: string; sections?: unknown[]; url?: string }>,
    lines: string[],
    titleMap: Map<string, string>,
    level: number
): void {
    const indent = '  '.repeat(level);

    for (const entry of entries) {
        if (entry.file) {
            const htmlPath = entry.file.replace(/\.(org|md|ipynb)$/i, '') + '.html';
            const displayTitle = entry.title || titleMap.get(entry.file) || entry.file;
            lines.push(`${indent}- [[file:${htmlPath}][${displayTitle}]]`);

            // Handle nested sections
            if (entry.sections && Array.isArray(entry.sections)) {
                generateTocSection(
                    entry.sections as Array<{ file?: string; title?: string; sections?: unknown[] }>,
                    lines,
                    titleMap,
                    level + 1
                );
            }
        } else if (entry.url) {
            const displayTitle = entry.title || entry.url;
            lines.push(`${indent}- [[${entry.url}][${displayTitle}]]`);
        }
    }
}

/**
 * Publish all projects in a configuration
 */
export async function publishAll(
    config: PublishConfig,
    workspaceRoot: string,
    options: PublishOptions = {}
): Promise<PublishProjectResult[]> {
    const results: PublishProjectResult[] = [];

    // Get project order (handle components)
    const projectOrder = getPublishOrder(config);

    for (const projectName of projectOrder) {
        const projectConfig = config.projects[projectName];

        if (isPublishProject(projectConfig)) {
            const project = mergeWithDefaults({ ...projectConfig, name: projectName });

            // Use theme-based publishing if theme is configured
            if (config.theme && config.theme.name !== 'default') {
                const result = await publishProjectWithTheme(
                    project, workspaceRoot, options, config.theme
                );
                results.push(result);
            } else {
                const result = await publishProject(project, workspaceRoot, options);
                results.push(result);
            }
        }
    }

    // Handle GitHub Pages specific files
    if (config.githubPages) {
        await setupGitHubPages(config, workspaceRoot, options);
    }

    return results;
}

/**
 * Get the order to publish projects (respecting component dependencies)
 */
function getPublishOrder(config: PublishConfig): string[] {
    const order: string[] = [];
    const visited = new Set<string>();

    function visit(name: string): void {
        if (visited.has(name)) return;
        visited.add(name);

        const project = config.projects[name];
        if (!project) return;

        if (isComponentProject(project)) {
            // Visit components first
            for (const componentName of project.components) {
                visit(componentName);
            }
        } else {
            order.push(name);
        }
    }

    // Visit all projects
    for (const name of Object.keys(config.projects)) {
        visit(name);
    }

    return order;
}

// =============================================================================
// GitHub Pages Support
// =============================================================================

/**
 * Set up GitHub Pages specific files
 */
async function setupGitHubPages(
    config: PublishConfig,
    workspaceRoot: string,
    options: PublishOptions = {}
): Promise<void> {
    // Find the output directory from first project
    const firstProjectName = Object.keys(config.projects)[0];
    const firstProject = config.projects[firstProjectName];

    if (!firstProject || !isPublishProject(firstProject)) {
        return;
    }

    const outputDir = path.resolve(workspaceRoot, firstProject.publishingDirectory);

    if (options.dryRun) {
        return;
    }

    // Ensure output directory exists
    await fs.promises.mkdir(outputDir, { recursive: true });

    // Create .nojekyll file
    const nojekyllPath = path.join(outputDir, '.nojekyll');
    await fs.promises.writeFile(nojekyllPath, '', 'utf-8');

    // Create CNAME file if custom domain specified
    if (config.customDomain) {
        const cnamePath = path.join(outputDir, 'CNAME');
        await fs.promises.writeFile(cnamePath, config.customDomain, 'utf-8');
    }
}

// =============================================================================
// Quick Initialization
// =============================================================================

/**
 * Create a new project configuration with wizard inputs
 */
export function createProjectConfig(
    name: string,
    baseDirectory: string,
    publishingDirectory: string,
    useGitHubPages: boolean = true,
    generateSitemap: boolean = true
): PublishConfig {
    const preset = useGitHubPages ? GITHUB_PAGES_PRESET : {};

    const project: PublishProject = {
        name,
        baseDirectory,
        publishingDirectory,
        recursive: true,
        autoSitemap: generateSitemap,
        sitemapFilename: useGitHubPages ? 'index.org' : 'sitemap.org',
        sitemapTitle: useGitHubPages ? 'Home' : 'Site Map',
        useDefaultTheme: true,
        withToc: true,
        sectionNumbers: false,
        ...preset,
    };

    return {
        projects: {
            [name]: project,
        },
        githubPages: useGitHubPages,
    };
}
