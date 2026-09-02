/**
 * Custom Exporter System
 *
 * Allows users to define custom export backends via templates and manifests.
 * Uses Handlebars for template rendering with custom helpers.
 *
 * Directory structure (uses scimax.directory setting, defaults to ~/scimax):
 *   ~/scimax/exporters/  (or ~/.scimax/exporters/)
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
import { getScimaxDirectory } from '../utils/pathResolver';

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
    /**
     * Optional org skeleton for documents that use this exporter (relative to
     * the manifest), e.g. "template.org". It is offered in the template pickers
     * so the keywords the exporter needs can be inserted rather than
     * remembered. Without it, a header is generated from `keywords`.
     */
    orgTemplate?: string;
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
 * A problem found while loading exporters. Collected rather than thrown so one
 * bad manifest cannot hide the exporters that did load - and so the UI can tell
 * the user *why* an exporter is missing from the list instead of silently
 * showing nothing.
 */
export interface ExporterLoadIssue {
    /** Directory (or file) the problem is in */
    path: string;
    /** Human-readable explanation */
    message: string;
    /** 'error' - the exporter was not loaded; 'warning' - loaded, but something is off */
    severity: 'error' | 'warning';
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
    /** Contents of `orgTemplate`, when the manifest names one */
    orgTemplateContent?: string;
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
// Manifest Parsing
// =============================================================================

/**
 * Strip line and block comments and trailing commas from JSON text.
 *
 * VS Code's own configuration files are JSON-with-comments, so a manifest.json
 * written by hand very often has a trailing comma or a comment in it. Rather
 * than rejecting the exporter outright (and, historically, saying nothing at
 * all about why it vanished), we retry the parse on a cleaned-up copy and
 * report a warning. Characters are only removed outside of string literals.
 */
export function stripJsonExtras(text: string): string {
    const out: string[] = [];
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    /** Drop a comma that only whitespace separates from this closing bracket. */
    const dropTrailingComma = () => {
        let j = out.length - 1;
        while (j >= 0 && /\s/.test(out[j])) j--;
        if (j >= 0 && out[j] === ',') {
            out.splice(j, 1);
        }
    };

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];

        if (inLineComment) {
            if (ch === '\n') {
                inLineComment = false;
                out.push(ch);
            }
            continue;
        }
        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }
        if (inString) {
            out.push(ch);
            if (ch === '\\') {
                // Copy the escaped character verbatim so \" does not end the string
                if (next !== undefined) {
                    out.push(next);
                    i++;
                }
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            out.push(ch);
            continue;
        }
        if (ch === '/' && next === '/') {
            inLineComment = true;
            i++;
            continue;
        }
        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i++;
            continue;
        }
        if (ch === '}' || ch === ']') {
            dropTrailingComma();
        }
        out.push(ch);
    }

    return out.join('');
}

/**
 * Parse a manifest, tolerating comments and trailing commas.
 *
 * Returns the manifest plus a warning when the text was not strict JSON, or
 * throws an Error naming the file and the JSON complaint when it cannot be
 * parsed at all.
 */
export function parseManifest(
    content: string,
    manifestPath: string
): { manifest: ExporterManifest; warning?: string } {
    try {
        return { manifest: JSON.parse(content) as ExporterManifest };
    } catch (strictError) {
        try {
            const manifest = JSON.parse(stripJsonExtras(content)) as ExporterManifest;
            return {
                manifest,
                warning: `${manifestPath} is not valid JSON (${(strictError as Error).message}). ` +
                    'It was read anyway by ignoring comments and trailing commas, but other tools will reject it.',
            };
        } catch {
            throw new Error(
                `${manifestPath} is not valid JSON: ${(strictError as Error).message}`
            );
        }
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
    private issues: ExporterLoadIssue[] = [];
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
                // Skip dotted directories (.git, .DS_Store, ...) - they are not exporters
                if (!entry.isDirectory() || entry.name.startsWith('.')) {
                    continue;
                }

                const exporterPath = path.join(dirPath, entry.name);
                try {
                    const { exporter, warning } = await this.loadExporter(exporterPath);
                    this.exporters.set(exporter.id, exporter);
                    if (warning) {
                        this.issues.push({ path: exporterPath, message: warning, severity: 'warning' });
                    }
                } catch (error) {
                    const missingManifest =
                        (error as NodeJS.ErrnoException).code === 'ENOENT' &&
                        String((error as NodeJS.ErrnoException).path || '').endsWith('manifest.json');
                    this.issues.push({
                        path: exporterPath,
                        message: missingManifest
                            ? 'No manifest.json in this directory'
                            : (error as Error).message,
                        severity: missingManifest ? 'warning' : 'error',
                    });
                }
            }
        } catch (error) {
            // Directory doesn't exist - that is normal, most search paths do not
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                this.issues.push({
                    path: dirPath,
                    message: `Could not read exporter directory: ${(error as Error).message}`,
                    severity: 'error',
                });
            }
        }
    }

    /**
     * Problems found by the last load: a manifest that would not parse, a
     * missing template, and so on. The UI reports these so an exporter that
     * fails to load does not just silently go missing.
     */
    getLoadIssues(): ExporterLoadIssue[] {
        return [...this.issues];
    }

    /** Only the issues that kept an exporter from loading. */
    getLoadErrors(): ExporterLoadIssue[] {
        return this.issues.filter(i => i.severity === 'error');
    }

    /**
     * Load a single exporter from a directory
     */
    async loadExporter(exporterPath: string): Promise<{ exporter: CustomExporter; warning?: string }> {
        const manifestPath = path.join(exporterPath, 'manifest.json');

        // Read and parse manifest
        const manifestContent = await fs.promises.readFile(manifestPath, 'utf-8');
        const { manifest, warning } = parseManifest(manifestContent, manifestPath);

        // Validate required fields
        for (const field of ['id', 'name', 'parent', 'outputFormat', 'template'] as const) {
            if (!manifest[field]) {
                throw new Error(`${manifestPath} is missing the required field: ${field}`);
            }
        }

        // Load template
        const templatePath = path.join(exporterPath, manifest.template);
        let templateContent: string;
        try {
            templateContent = await fs.promises.readFile(templatePath, 'utf-8');
        } catch {
            throw new Error(`Template file not found: ${templatePath} (manifest "template": "${manifest.template}")`);
        }
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

        // Load the org skeleton if specified
        let orgTemplateContent: string | undefined;
        if (manifest.orgTemplate) {
            const orgTemplatePath = path.join(exporterPath, manifest.orgTemplate);
            try {
                orgTemplateContent = await fs.promises.readFile(orgTemplatePath, 'utf-8');
            } catch {
                throw new Error(
                    `Org template not found: ${orgTemplatePath} (manifest "orgTemplate": "${manifest.orgTemplate}")`
                );
            }
        }

        // Load partials if directory specified
        if (manifest.partialsDir) {
            const partialsPath = path.join(exporterPath, manifest.partialsDir);
            await this.loadPartials(partialsPath, manifest.id);
        }

        return {
            exporter: {
                ...manifest,
                basePath: exporterPath,
                compiledTemplate,
                preambleContent,
                orgTemplateContent,
            },
            warning,
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
        this.issues = [];
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

    // Extract exclude/select tags (default noexport is always excluded)
    const excludeTagsRaw = doc.keywords?.EXCLUDE_TAGS || '';
    const excludeTags = excludeTagsRaw
        ? excludeTagsRaw.split(/\s+/).filter(Boolean)
        : ['noexport']; // Default to excluding 'noexport' tagged sections

    const selectTagsRaw = doc.keywords?.SELECT_TAGS || '';
    const selectTags = selectTagsRaw
        ? selectTagsRaw.split(/\s+/).filter(Boolean)
        : undefined;

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
                excludeTags,
                selectTags,
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
                excludeTags,
                selectTags,
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
// Automatic Routing (LaTeX class -> custom exporter)
// =============================================================================

/**
 * Result of deciding which custom exporter (if any) should handle a document.
 */
export interface ExporterRoute {
    /** Exporter to use, when one was resolved */
    exporterId?: string;
    /** How the decision was reached */
    reason: 'keyword' | 'latex-class' | 'opt-out' | 'unknown-exporter' | 'none';
    /** Exporter id that was asked for but is not registered */
    requested?: string;
    /** The `#+LATEX_CLASS` value that participated in the decision */
    latexClass?: string;
}

/** Values that explicitly disable routing to a custom exporter */
const ROUTE_OPT_OUT = new Set(['none', 'nil', 'default', 'off', 'no']);

/**
 * Decide which custom exporter should handle a document.
 *
 * Resolution order:
 *   1. `#+EXPORTER: <id>` in the document (use `none` to force the built-in backend)
 *   2. `#+LATEX_CLASS: <class>` looked up in `classMap` (case-insensitive)
 *
 * Returns a route with no `exporterId` when the built-in backend should be used.
 */
export function resolveCustomExporterRoute(
    keywords: Record<string, string> | undefined,
    classMap: Record<string, string> | undefined,
    isRegistered: (id: string) => boolean = (id) => ExporterRegistry.getInstance().has(id)
): ExporterRoute {
    const explicit = keywords?.EXPORTER?.trim();
    if (explicit) {
        if (ROUTE_OPT_OUT.has(explicit.toLowerCase())) {
            return { reason: 'opt-out', requested: explicit };
        }
        return isRegistered(explicit)
            ? { exporterId: explicit, reason: 'keyword' }
            : { reason: 'unknown-exporter', requested: explicit };
    }

    const latexClass = keywords?.LATEX_CLASS?.trim();
    if (!latexClass || !classMap) {
        return { reason: 'none' };
    }

    const matchedKey = Object.keys(classMap).find(
        key => key.trim().toLowerCase() === latexClass.toLowerCase()
    );
    if (matchedKey === undefined) {
        return { reason: 'none' };
    }

    const mapped = (classMap[matchedKey] || '').trim();
    if (!mapped || ROUTE_OPT_OUT.has(mapped.toLowerCase())) {
        return { reason: 'opt-out', latexClass };
    }

    return isRegistered(mapped)
        ? { exporterId: mapped, reason: 'latex-class', latexClass }
        : { reason: 'unknown-exporter', requested: mapped, latexClass };
}

/**
 * Convenience wrapper around {@link resolveCustomExporterRoute} that parses
 * the document keywords out of raw org content.
 */
export function resolveCustomExporterRouteForContent(
    content: string,
    classMap: Record<string, string> | undefined,
    isRegistered?: (id: string) => boolean
): ExporterRoute {
    try {
        const doc = parseOrgFast(content);
        return resolveCustomExporterRoute(doc.keywords, classMap, isRegistered);
    } catch {
        // Unparseable content - fall back to the built-in backend
        return { reason: 'none' };
    }
}

// =============================================================================
// Org Skeletons
// =============================================================================

/**
 * The org header a document needs to export through this exporter.
 *
 * If the exporter ships an `orgTemplate` (see the manifest field), that text is
 * used verbatim. Otherwise a header is generated from the manifest's keyword
 * definitions: defaults are filled in, and a required keyword with no default
 * becomes a <<<PLACEHOLDER>>> so it is obvious what still has to be written.
 *
 * The result uses the template system's conventions ({{author}}, {{date}},
 * ${1:...} tab stops), so it can be handed straight to TemplateManager.
 */
export function buildExporterOrgTemplate(
    exporter: CustomExporter,
    options: { latexClass?: string } = {}
): string {
    if (exporter.orgTemplateContent) {
        return exporter.orgTemplateContent;
    }

    const lines = [
        '#+TITLE: ${1:Title}',
        '#+AUTHOR: {{author}}',
        '#+DATE: {{date}}',
    ];

    // With a class mapping in place, the ordinary LaTeX/PDF exports route to
    // this exporter, so the document is self-describing.
    if (options.latexClass) {
        lines.push(`#+LATEX_CLASS: ${options.latexClass}`);
    }

    for (const [key, def] of Object.entries(exporter.keywords || {})) {
        const name = key.toUpperCase();
        if (def.default !== undefined && def.default !== '') {
            lines.push(`#+${name}: ${def.default}`);
        } else if (def.required) {
            lines.push(`#+${name}: <<<${name}>>>`);
        } else {
            lines.push(`#+${name}: `);
        }
    }

    lines.push('', '$0', '');
    return lines.join('\n');
}

/**
 * Required keywords the document does not set.
 *
 * These export as "[NOT FOUND: to]" placeholders, so it is worth saying so
 * before someone mails out a memo addressed to nobody.
 */
export function findMissingRequiredKeywords(exporter: CustomExporter, content: string): string[] {
    if (!exporter.keywords) return [];

    const doc = parseOrgFast(content);
    const present = extractCustomKeywords(doc, exporter.keywords);

    return Object.entries(exporter.keywords)
        .filter(([key, def]) => def.required && String(present[key] ?? '').startsWith('[NOT FOUND:'))
        .map(([key]) => key.toUpperCase());
}

// =============================================================================
// Discovery Paths
// =============================================================================

/**
 * Get the default exporter discovery paths
 */
export function getDefaultExporterPaths(): string[] {
    const paths: string[] = [];

    // First check scimax.directory setting (highest priority)
    const scimaxDir = getScimaxDirectory();
    paths.push(path.join(scimaxDir, 'exporters'));

    // User home directory (~/.scimax/exporters)
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (homeDir) {
        const dotScimaxPath = path.join(homeDir, '.scimax', 'exporters');
        // Avoid duplicates if scimax.directory points to ~/.scimax
        if (dotScimaxPath !== path.join(scimaxDir, 'exporters')) {
            paths.push(dotScimaxPath);
        }
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
    orgTemplate: 'template.org',

    latexOptions: {
        documentClass: 'letter',
        classOptions: ['12pt'],
    },
};

/**
 * Org skeleton for a CMU memo - the header the exporter needs, plus a body to
 * start writing in. Offered by the template pickers as "CMU Memo".
 */
export const EXAMPLE_CMU_MEMO_ORG_TEMPLATE = `#+TITLE: \${1:Memo subject}
#+AUTHOR: {{author}}
#+DATE: {{date}}
#+LATEX_CLASS: cmu-memo

#+DEPARTMENT: Department of Chemical Engineering
#+TO: <<<TO>>>
#+FROM: {{author}}
#+SUBJECT: \${1:Memo subject}
#+CC:
#+SIGNATURELINES: true

$0

# Export with C-c C-e and pick "CMU Memo", or map the class once with
# "scimax.export.latexClassExporters": { "cmu-memo": "cmu-memo" } and use C-c C-e l o.
`;

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
