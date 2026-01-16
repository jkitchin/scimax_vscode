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
    GITHUB_PAGES_PRESET,
} from './publishProject';

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
 */
export async function loadConfig(workspaceRoot: string): Promise<PublishConfig | null> {
    const configPath = path.join(workspaceRoot, CONFIG_FILENAME);

    try {
        const content = await fs.promises.readFile(configPath, 'utf-8');
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
    options: PublishOptions = {}
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
        const preambleContent = await loadTemplate(project.htmlPreamble, workspaceRoot);
        const postambleContent = await loadTemplate(project.htmlPostamble, workspaceRoot);

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
    options: PublishOptions = {}
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
        const html = convertMarkdownToHtml(content, title, project);

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
    options: PublishOptions = {}
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
        const html = convertNotebookToHtml(notebook, title, project);

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

    // Discover files
    const files = await discoverFiles(project, workspaceRoot);

    // Publish each file
    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (options.onProgress) {
            options.onProgress(i + 1, files.length, path.basename(file));
        }

        let result: PublishFileResult;
        const pubFunc = getPublishFunction(file, project);

        switch (pubFunc) {
            case 'copy':
                result = await copyStaticFile(file, project, workspaceRoot, options);
                break;
            case 'md':
                result = await publishMarkdownFile(file, project, workspaceRoot, options);
                break;
            case 'ipynb':
                result = await publishNotebookFile(file, project, workspaceRoot, options);
                break;
            case 'org':
            default:
                result = await publishFile(file, project, workspaceRoot, options);
                break;
        }

        results.push(result);
    }

    // Generate sitemap if enabled
    if (project.autoSitemap && project.publishingFunction !== 'copy') {
        const sitemapEntries: SitemapEntry[] = results
            .filter(r => r.success)
            .map(r => {
                const baseDir = path.resolve(workspaceRoot, project.baseDirectory);
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
            const sitemapOrgPath = path.join(
                workspaceRoot,
                project.baseDirectory,
                sitemapFilename
            );

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
            const result = await publishProject(project, workspaceRoot, options);
            results.push(result);
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
