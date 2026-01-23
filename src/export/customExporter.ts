/**
 * Custom Exporter System
 *
 * Allows users to define custom export backends via templates and manifests.
 * Uses Handlebars for template rendering with custom helpers.
 *
 * Directory structure:
 *   ~/.scimax/exporters/
 *   ├── cmu-memo/
 *   │   ├── manifest.json
 *   │   └── template.tex
 *   └── journal-article/
 *       ├── manifest.json
 *       ├── template.tex
 *       └── partials/
 *           └── preamble.tex
 */

import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
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
    /** Optional directory containing partial templates */
    partialsDir?: string;

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
    /** Compiled Handlebars template */
    compiledTemplate: Handlebars.TemplateDelegate;
    /** Preamble content (if any) */
    preambleContent?: string;
}

/**
 * Template context passed to Handlebars
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
// Handlebars Setup
// =============================================================================

/**
 * Create a new Handlebars instance with custom helpers
 * Using a factory function allows each exporter to have isolated partials
 */
function createHandlebarsInstance(): typeof Handlebars {
    const hbs = Handlebars.create();

    // Escape for LaTeX: {{latex value}}
    hbs.registerHelper('latex', (text: unknown) => {
        if (text === undefined || text === null) return '';
        return new hbs.SafeString(escapeString(String(text), 'latex'));
    });

    // Escape for HTML: {{html value}}
    hbs.registerHelper('html', (text: unknown) => {
        if (text === undefined || text === null) return '';
        return new hbs.SafeString(escapeString(String(text), 'html'));
    });

    // Default value helper: {{default field "fallback"}}
    hbs.registerHelper('default', (value: unknown, defaultValue: string) => {
        if (value === undefined || value === null || value === '') {
            return defaultValue;
        }
        return value;
    });

    // NOT FOUND placeholder for missing required fields: {{required field "fieldName"}}
    hbs.registerHelper('required', (value: unknown, fieldName: string) => {
        if (value === undefined || value === null || value === '') {
            return `[NOT FOUND: ${fieldName}]`;
        }
        return value;
    });

    // Join array with separator: {{join items ", "}}
    hbs.registerHelper('join', (array: unknown, separator: string) => {
        if (!Array.isArray(array)) return '';
        return array.join(typeof separator === 'string' ? separator : ', ');
    });

    // Equality comparison: {{#ifeq a b}}...{{/ifeq}}
    hbs.registerHelper('ifeq', function(this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
        return a === b ? options.fn(this) : options.inverse(this);
    });

    // Not equal comparison: {{#ifne a b}}...{{/ifne}}
    hbs.registerHelper('ifne', function(this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
        return a !== b ? options.fn(this) : options.inverse(this);
    });

    // Current date: {{today}}
    hbs.registerHelper('today', () => {
        return new Date().toISOString().split('T')[0];
    });

    // Current year: {{year}}
    hbs.registerHelper('year', () => {
        return new Date().getFullYear();
    });

    // Uppercase: {{upper text}}
    hbs.registerHelper('upper', (text: unknown) => {
        if (text === undefined || text === null) return '';
        return String(text).toUpperCase();
    });

    // Lowercase: {{lower text}}
    hbs.registerHelper('lower', (text: unknown) => {
        if (text === undefined || text === null) return '';
        return String(text).toLowerCase();
    });

    // Raw/unescaped output (for body content): {{{raw body}}}
    // Note: Triple braces already do this in Handlebars, but this is explicit
    hbs.registerHelper('raw', (text: unknown) => {
        if (text === undefined || text === null) return '';
        return new hbs.SafeString(String(text));
    });

    return hbs;
}

// Global Handlebars instance with helpers registered
const handlebars = createHandlebarsInstance();

/**
 * Compile a Handlebars template
 */
export function compileTemplate(templateSource: string): Handlebars.TemplateDelegate {
    return handlebars.compile(templateSource, {
        strict: false, // Don't throw on missing fields
        noEscape: true, // Don't auto-escape (templates handle their own escaping)
    });
}

/**
 * Register a partial template
 */
export function registerPartial(name: string, content: string): void {
    handlebars.registerPartial(name, content);
}

/**
 * Render a template with context
 */
export function renderTemplate(
    template: Handlebars.TemplateDelegate,
    context: TemplateContext
): string {
    return template(context);
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
        const compiledTemplate = compileTemplate(templateContent);

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

        // Load partials if directory specified
        if (manifest.partialsDir) {
            const partialsPath = path.join(exporterPath, manifest.partialsDir);
            await this.loadPartials(partialsPath, manifest.id);
        }

        return {
            ...manifest,
            basePath: exporterPath,
            compiledTemplate,
            preambleContent,
        };
    }

    /**
     * Load partial templates from a directory
     */
    private async loadPartials(partialsPath: string, exporterId: string): Promise<void> {
        try {
            const entries = await fs.promises.readdir(partialsPath);
            for (const entry of entries) {
                const ext = path.extname(entry);
                if (['.tex', '.html', '.hbs', '.partial'].includes(ext)) {
                    const partialName = `${exporterId}/${path.basename(entry, ext)}`;
                    const content = await fs.promises.readFile(
                        path.join(partialsPath, entry),
                        'utf-8'
                    );
                    registerPartial(partialName, content);
                }
            }
        } catch {
            // Partials directory doesn't exist - ignore
        }
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
    _options?: {
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
    return renderTemplate(exporter.compiledTemplate, context);
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
// Example Templates
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
 * Example template for CMU Memo (Handlebars syntax)
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

\\memodept{ {{department}} }
\\memoto{ {{to}} }
\\memofrom{ {{from}} }
\\memosubject{ {{subject}} }
{{#if cc}}
\\memocc{ {{cc}} }
{{/if}}

\\vspace{1em}
\\hrule
\\vspace{1em}

{{{body}}}

{{#if signatureLines}}
\\signaturelines
{{/if}}

\\end{letter}
\\end{document}
`;

/**
 * Example manifest for CMU Dissertation exporter
 */
export const EXAMPLE_CMU_DISSERTATION_MANIFEST: ExporterManifest = {
    id: 'cmu-dissertation',
    name: 'CMU Dissertation',
    description: 'Carnegie Mellon University PhD dissertation format',
    parent: 'latex',
    outputFormat: 'pdf',

    keywords: {
        degree: {
            default: 'Doctor of Philosophy',
            description: 'Degree being awarded',
        },
        department: {
            default: 'Department of Chemical Engineering',
            description: 'Academic department',
        },
        priordegree: {
            description: 'Prior degrees held',
        },
        abstract: {
            required: true,
            description: 'Dissertation abstract',
        },
        acknowledgements: {
            description: 'Acknowledgements section',
        },
        dedication: {
            description: 'Dedication text',
        },
        committee: {
            description: 'Committee members (comma-separated)',
        },
    },

    template: 'template.tex',
    preamble: 'preamble.tex',
    partialsDir: 'partials',

    latexOptions: {
        documentClass: 'report',
        classOptions: ['12pt', 'letterpaper'],
        packages: ['setspace', 'tocloft', 'titlesec'],
    },
};
