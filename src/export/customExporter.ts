/**
 * Custom Exporter System
 *
 * Allows users to define custom export backends via templates and manifests.
 * Uses the same template syntax as the existing template system for consistency:
 * - {{variable}} for simple substitution
 * - {{#if variable}}...{{/if}} for conditionals
 * - {{#each items}}...{{/each}} for iteration
 *
 * Directory structure:
 *   ~/.scimax/exporters/
 *   ├── cmu-memo/
 *   │   ├── manifest.json
 *   │   └── template.tex
 *   └── journal-article/
 *       ├── manifest.json
 *       └── template.tex
 */

import * as fs from 'fs';
import * as path from 'path';
import type { OrgDocumentNode } from '../parser/orgElementTypes';
import { parseOrgFast } from '../parser/orgExportParser';
import { exportToLatex, LatexExportOptions } from '../parser/orgExportLatex';
import { exportToHtml, HtmlExportOptions } from '../parser/orgExportHtml';
import { escapeString } from '../parser/orgExport';

// =============================================================================
// Types
// =============================================================================

/**
 * Keyword definition in manifest
 */
export interface KeywordDefinition {
    /** Default value if not specified in document */
    default?: string;
    /** Whether this keyword is required */
    required?: boolean;
    /** Type of the value */
    type?: 'string' | 'boolean' | 'number';
    /** Description for documentation */
    description?: string;
}

/**
 * Custom exporter manifest (manifest.json)
 */
export interface ExporterManifest {
    /** Unique identifier (e.g., "cmu-memo") */
    id: string;
    /** Display name (e.g., "CMU Memo") */
    name: string;
    /** Description */
    description?: string;
    /** Parent backend to derive from */
    parent: 'latex' | 'html' | 'markdown';
    /** Output format */
    outputFormat: 'tex' | 'pdf' | 'html' | 'md';

    /** Custom keyword definitions */
    keywords?: Record<string, KeywordDefinition>;

    /** Path to template file (relative to manifest) */
    template: string;
    /** Optional path to preamble file (LaTeX only) */
    preamble?: string;

    /** LaTeX-specific options */
    latexOptions?: {
        documentClass?: string;
        classOptions?: string[];
        packages?: string[];
    };
}

/**
 * Loaded custom exporter with resolved paths
 */
export interface CustomExporter extends ExporterManifest {
    /** Absolute path to the exporter directory */
    basePath: string;
    /** Raw template content */
    templateContent: string;
    /** Preamble content (if any) */
    preambleContent?: string;
}

/**
 * Template context passed to the template engine
 */
export interface TemplateContext {
    // Standard org fields
    title: string;
    author: string;
    date: string;
    language: string;

    // The exported body content
    body: string;

    // LaTeX-specific
    preamble?: string;
    documentClass?: string;
    classOptions?: string;

    // Custom keywords from document
    [key: string]: string | boolean | number | string[] | undefined;
}

// =============================================================================
// Template Engine (matches existing {{variable}} syntax)
// =============================================================================

/**
 * Simple template engine matching the existing template system syntax
 *
 * Supported syntax:
 * - {{variable}} - Simple substitution
 * - {{#if variable}}...{{/if}} - Conditional (truthy check)
 * - {{#unless variable}}...{{/unless}} - Inverse conditional
 * - {{#each items}}{{this}}{{/each}} - Iteration over arrays
 * - {{latex variable}} - Escape for LaTeX
 * - {{html variable}} - Escape for HTML
 * - {{default variable "fallback"}} - Default value
 */
export function renderTemplate(template: string, context: TemplateContext): string {
    let result = template;

    // Process {{#each items}}...{{/each}} blocks first
    result = processEachBlocks(result, context);

    // Process {{#if variable}}...{{/if}} blocks
    result = processIfBlocks(result, context);

    // Process {{#unless variable}}...{{/unless}} blocks
    result = processUnlessBlocks(result, context);

    // Process {{default variable "fallback"}} helpers
    result = processDefaultHelpers(result, context);

    // Process {{latex variable}} and {{html variable}} helpers
    result = processEscapeHelpers(result, context);

    // Process simple {{variable}} substitutions last
    result = processSimpleSubstitutions(result, context);

    return result;
}

/**
 * Process {{#each items}}...{{/each}} blocks
 */
function processEachBlocks(template: string, context: TemplateContext): string {
    const eachPattern = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;

    return template.replace(eachPattern, (_, varName, content) => {
        const value = context[varName];
        if (!Array.isArray(value) || value.length === 0) {
            return '';
        }

        return value
            .map(item => {
                // Replace {{this}} with the current item
                let itemContent = content.replace(/\{\{this\}\}/g, String(item));
                // Also support {{.}} as alias for {{this}}
                itemContent = itemContent.replace(/\{\{\.\}\}/g, String(item));
                return itemContent;
            })
            .join('');
    });
}

/**
 * Process {{#if variable}}...{{/if}} blocks (with optional {{else}})
 */
function processIfBlocks(template: string, context: TemplateContext): string {
    // Pattern with optional else clause
    const ifElsePattern = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g;
    let result = template.replace(ifElsePattern, (_, varName, ifContent, elseContent) => {
        const value = context[varName];
        return isTruthy(value) ? ifContent : elseContent;
    });

    // Pattern without else clause
    const ifPattern = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
    result = result.replace(ifPattern, (_, varName, content) => {
        const value = context[varName];
        return isTruthy(value) ? content : '';
    });

    return result;
}

/**
 * Process {{#unless variable}}...{{/unless}} blocks
 */
function processUnlessBlocks(template: string, context: TemplateContext): string {
    const unlessPattern = /\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g;

    return template.replace(unlessPattern, (_, varName, content) => {
        const value = context[varName];
        return isTruthy(value) ? '' : content;
    });
}

/**
 * Process {{default variable "fallback"}} helpers
 */
function processDefaultHelpers(template: string, context: TemplateContext): string {
    const defaultPattern = /\{\{default\s+(\w+)\s+"([^"]*)"\}\}/g;

    return template.replace(defaultPattern, (_, varName, fallback) => {
        const value = context[varName];
        if (value === undefined || value === null || value === '') {
            return fallback;
        }
        return String(value);
    });
}

/**
 * Process {{latex variable}} and {{html variable}} escape helpers
 */
function processEscapeHelpers(template: string, context: TemplateContext): string {
    // {{latex variable}} - escape for LaTeX
    const latexPattern = /\{\{latex\s+(\w+)\}\}/g;
    let result = template.replace(latexPattern, (_, varName) => {
        const value = context[varName];
        if (value === undefined || value === null) {
            return '';
        }
        return escapeString(String(value), 'latex');
    });

    // {{html variable}} - escape for HTML
    const htmlPattern = /\{\{html\s+(\w+)\}\}/g;
    result = result.replace(htmlPattern, (_, varName) => {
        const value = context[varName];
        if (value === undefined || value === null) {
            return '';
        }
        return escapeString(String(value), 'html');
    });

    return result;
}

/**
 * Process simple {{variable}} substitutions
 */
function processSimpleSubstitutions(template: string, context: TemplateContext): string {
    const simplePattern = /\{\{(\w+)\}\}/g;

    return template.replace(simplePattern, (match, varName) => {
        const value = context[varName];
        if (value === undefined || value === null) {
            // Return placeholder for missing values
            return `[NOT FOUND: ${varName}]`;
        }
        if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
        }
        if (Array.isArray(value)) {
            return value.join(', ');
        }
        return String(value);
    });
}

/**
 * Check if a value is truthy for template conditionals
 */
function isTruthy(value: unknown): boolean {
    if (value === undefined || value === null) {
        return false;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        return value.length > 0;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    return true;
}

// =============================================================================
// Keyword Extraction
// =============================================================================

/**
 * Extract custom keywords from an org document
 */
export function extractCustomKeywords(
    doc: OrgDocumentNode,
    keywordDefs: Record<string, KeywordDefinition>
): Record<string, string | boolean | number> {
    const result: Record<string, string | boolean | number> = {};

    for (const [key, def] of Object.entries(keywordDefs)) {
        const upperKey = key.toUpperCase();
        let value: string | undefined;

        // Check document keywords map first
        if (doc.keywords?.[upperKey]) {
            value = doc.keywords[upperKey];
        }

        // Also check section keywords (preamble)
        if (!value && doc.section?.children) {
            for (const elem of doc.section.children) {
                if (elem.type === 'keyword') {
                    const kwKey = (elem as any).properties?.key?.toUpperCase();
                    const kwValue = (elem as any).properties?.value;
                    if (kwKey === upperKey && kwValue) {
                        value = kwValue;
                        break;
                    }
                }
            }
        }

        // Parse value according to type
        if (value !== undefined) {
            result[key] = parseKeywordValue(value, def.type);
        } else if (def.default !== undefined) {
            result[key] = parseKeywordValue(def.default, def.type);
        } else if (def.required) {
            // Insert NOT FOUND placeholder for required missing fields
            result[key] = `[NOT FOUND: ${key}]`;
        }
    }

    return result;
}

/**
 * Parse a keyword value to the appropriate type
 */
function parseKeywordValue(
    value: string,
    type?: 'string' | 'boolean' | 'number'
): string | boolean | number {
    switch (type) {
        case 'boolean':
            return value.toLowerCase() === 'true' ||
                   value.toLowerCase() === 'yes' ||
                   value.toLowerCase() === 't' ||
                   value === '1';
        case 'number':
            const num = parseFloat(value);
            return isNaN(num) ? 0 : num;
        default:
            return value;
    }
}

// =============================================================================
// Exporter Registry
// =============================================================================

/**
 * Registry of loaded custom exporters
 */
class ExporterRegistry {
    private exporters: Map<string, CustomExporter> = new Map();
    private static instance: ExporterRegistry;

    private constructor() {}

    static getInstance(): ExporterRegistry {
        if (!ExporterRegistry.instance) {
            ExporterRegistry.instance = new ExporterRegistry();
        }
        return ExporterRegistry.instance;
    }

    /**
     * Load exporters from a directory
     */
    async loadFromDirectory(dirPath: string): Promise<void> {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const exporterPath = path.join(dirPath, entry.name);
                    try {
                        const exporter = await this.loadExporter(exporterPath);
                        this.exporters.set(exporter.id, exporter);
                    } catch (error) {
                        console.warn(`Failed to load exporter from ${exporterPath}:`, error);
                    }
                }
            }
        } catch (error) {
            // Directory doesn't exist or can't be read - skip silently
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn(`Failed to read exporter directory ${dirPath}:`, error);
            }
        }
    }

    /**
     * Load a single exporter from a directory
     */
    async loadExporter(exporterPath: string): Promise<CustomExporter> {
        const manifestPath = path.join(exporterPath, 'manifest.json');

        // Read and parse manifest
        const manifestContent = await fs.promises.readFile(manifestPath, 'utf-8');
        const manifest: ExporterManifest = JSON.parse(manifestContent);

        // Validate required fields
        if (!manifest.id) throw new Error('Manifest missing required field: id');
        if (!manifest.name) throw new Error('Manifest missing required field: name');
        if (!manifest.parent) throw new Error('Manifest missing required field: parent');
        if (!manifest.outputFormat) throw new Error('Manifest missing required field: outputFormat');
        if (!manifest.template) throw new Error('Manifest missing required field: template');

        // Load template
        const templatePath = path.join(exporterPath, manifest.template);
        const templateContent = await fs.promises.readFile(templatePath, 'utf-8');

        // Load preamble if specified
        let preambleContent: string | undefined;
        if (manifest.preamble) {
            const preamblePath = path.join(exporterPath, manifest.preamble);
            try {
                preambleContent = await fs.promises.readFile(preamblePath, 'utf-8');
            } catch {
                // Preamble file doesn't exist - ignore
            }
        }

        return {
            ...manifest,
            basePath: exporterPath,
            templateContent,
            preambleContent,
        };
    }

    /**
     * Register an exporter directly
     */
    register(exporter: CustomExporter): void {
        this.exporters.set(exporter.id, exporter);
    }

    /**
     * Get an exporter by ID
     */
    get(id: string): CustomExporter | undefined {
        return this.exporters.get(id);
    }

    /**
     * Get all registered exporters
     */
    getAll(): CustomExporter[] {
        return Array.from(this.exporters.values());
    }

    /**
     * Check if an exporter exists
     */
    has(id: string): boolean {
        return this.exporters.has(id);
    }

    /**
     * Clear all exporters (useful for reloading)
     */
    clear(): void {
        this.exporters.clear();
    }
}

export { ExporterRegistry };

// =============================================================================
// Export Execution
// =============================================================================

/**
 * Execute a custom export
 */
export async function executeCustomExport(
    exporterId: string,
    content: string,
    options?: {
        bodyOnly?: boolean;
    }
): Promise<string> {
    const registry = ExporterRegistry.getInstance();
    const exporter = registry.get(exporterId);

    if (!exporter) {
        throw new Error(`Custom exporter not found: ${exporterId}`);
    }

    // Parse the org document
    const doc = parseOrgFast(content);

    // Extract standard metadata
    const title = doc.keywords?.TITLE || '';
    const author = doc.keywords?.AUTHOR || '';
    const date = doc.keywords?.DATE || new Date().toISOString().split('T')[0];
    const language = doc.keywords?.LANGUAGE || 'en';

    // Extract custom keywords
    const customKeywords = exporter.keywords
        ? extractCustomKeywords(doc, exporter.keywords)
        : {};

    // Generate the body using the parent backend
    let body: string;
    switch (exporter.parent) {
        case 'latex': {
            const latexOpts: Partial<LatexExportOptions> = {
                title,
                author,
                date,
                language,
                bodyOnly: true, // Always get just the body for templates
                documentClass: exporter.latexOptions?.documentClass,
                classOptions: exporter.latexOptions?.classOptions,
            };
            body = exportToLatex(doc, latexOpts);
            break;
        }
        case 'html': {
            const htmlOpts: Partial<HtmlExportOptions> = {
                title,
                author,
                date,
                language,
                bodyOnly: true,
            };
            body = exportToHtml(doc, htmlOpts);
            break;
        }
        case 'markdown':
            // For markdown, we'd need a markdown exporter
            // For now, just use the raw content after removing keywords
            body = content.replace(/^#\+[A-Z_]+:.*$/gm, '').trim();
            break;
        default:
            throw new Error(`Unknown parent backend: ${exporter.parent}`);
    }

    // Build template context
    const context: TemplateContext = {
        title,
        author,
        date,
        language,
        body,
        preamble: exporter.preambleContent,
        documentClass: exporter.latexOptions?.documentClass,
        classOptions: exporter.latexOptions?.classOptions?.join(', '),
        ...customKeywords,
    };

    // Render the template
    return renderTemplate(exporter.templateContent, context);
}

// =============================================================================
// Discovery Paths
// =============================================================================

/**
 * Get the default exporter discovery paths
 */
export function getDefaultExporterPaths(): string[] {
    const paths: string[] = [];

    // User home directory
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (homeDir) {
        paths.push(path.join(homeDir, '.scimax', 'exporters'));
    }

    // XDG config directory
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    if (xdgConfig) {
        paths.push(path.join(xdgConfig, 'scimax', 'exporters'));
    }

    return paths;
}

/**
 * Initialize the exporter registry with default paths
 */
export async function initializeExporterRegistry(
    additionalPaths?: string[]
): Promise<ExporterRegistry> {
    const registry = ExporterRegistry.getInstance();
    registry.clear();

    const paths = [...getDefaultExporterPaths(), ...(additionalPaths || [])];

    for (const searchPath of paths) {
        await registry.loadFromDirectory(searchPath);
    }

    return registry;
}

// =============================================================================
// Utility: Create example exporter structure
// =============================================================================

/**
 * Example manifest for CMU Memo exporter
 */
export const EXAMPLE_CMU_MEMO_MANIFEST: ExporterManifest = {
    id: 'cmu-memo',
    name: 'CMU Memo',
    description: 'Carnegie Mellon University internal memo format',
    parent: 'latex',
    outputFormat: 'pdf',

    keywords: {
        department: {
            default: 'Department of Chemical Engineering',
            description: 'Originating department',
        },
        to: {
            required: true,
            description: 'Memo recipient',
        },
        from: {
            required: true,
            description: 'Memo sender',
        },
        subject: {
            required: true,
            description: 'Memo subject',
        },
        cc: {
            default: '',
            description: 'Carbon copy recipients',
        },
        signatureLines: {
            type: 'boolean',
            default: 'true',
            description: 'Include signature lines',
        },
    },

    template: 'template.tex',

    latexOptions: {
        documentClass: 'letter',
        classOptions: ['12pt'],
    },
};

/**
 * Example template for CMU Memo
 */
export const EXAMPLE_CMU_MEMO_TEMPLATE = `% CMU Memo Template
\\documentclass[{{default classOptions "12pt"}}]{letter}
\\usepackage[utf8]{inputenc}
\\usepackage{geometry}
\\geometry{margin=1in}

% Custom memo commands
\\newcommand{\\memoto}[1]{\\textbf{TO:} #1\\\\}
\\newcommand{\\memofrom}[1]{\\textbf{FROM:} #1\\\\}
\\newcommand{\\memosubject}[1]{\\textbf{SUBJECT:} #1\\\\}
\\newcommand{\\memodept}[1]{\\textbf{DEPARTMENT:} #1\\\\}
\\newcommand{\\memocc}[1]{\\textbf{CC:} #1\\\\}
\\newcommand{\\signaturelines}{%
  \\vspace{2em}
  \\rule{3in}{0.4pt}\\\\
  Signature
}

\\begin{document}

\\begin{letter}{ }

\\memodept{{{department}}}
\\memoto{{{to}}}
\\memofrom{{{from}}}
\\memosubject{{{subject}}}
{{#if cc}}
\\memocc{{{cc}}}
{{/if}}

\\vspace{1em}
\\hrule
\\vspace{1em}

{{body}}

{{#if signatureLines}}
\\signaturelines
{{/if}}

\\end{letter}
\\end{document}
`;
