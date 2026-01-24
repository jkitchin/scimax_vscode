/**
 * DOCX export backend for org-mode documents
 * Uses pandoc for high-quality Word document generation with native equation support
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as os from 'os';
import * as crypto from 'crypto';

import type { OrgDocumentNode } from './orgElementTypes';
import { parseOptionsKeyword, ExportOptions, DEFAULT_EXPORT_OPTIONS } from './orgExport';

// =============================================================================
// Pandoc Availability Check
// =============================================================================

let pandocAvailable: boolean | null = null;
let pandocVersion: string | null = null;

/**
 * Check if pandoc is available on the system
 */
function checkPandoc(): { available: boolean; version: string | null } {
    if (pandocAvailable !== null) {
        return { available: pandocAvailable, version: pandocVersion };
    }
    try {
        const result = execSync('pandoc --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        const match = result.match(/pandoc\s+([\d.]+)/);
        pandocVersion = match ? match[1] : 'unknown';
        pandocAvailable = true;
    } catch {
        pandocAvailable = false;
        pandocVersion = null;
    }
    return { available: pandocAvailable, version: pandocVersion };
}

// =============================================================================
// DOCX Export Options
// =============================================================================

/**
 * Options specific to DOCX export via pandoc
 */
export interface DocxExportOptions extends ExportOptions {
    /** Document title (from #+TITLE) */
    title?: string;
    /** Document author (from #+AUTHOR) */
    author?: string;
    /** Document date (from #+DATE) */
    date?: string;
    /** Path to reference docx for styling */
    referenceDoc?: string;
    /** Enable table of contents (can be boolean or number for depth) */
    toc?: boolean | number;
    /** TOC depth (default: 3) */
    tocDepth?: number;
    /** Enable section numbering */
    sectionNumbers?: boolean;
    /** Base path for resolving relative paths */
    basePath?: string;
    /** Additional pandoc arguments */
    pandocArgs?: string[];
    /** Raw org content to pass directly to pandoc (bypasses AST serialization) */
    rawContent?: string;
}

const DEFAULT_DOCX_OPTIONS: DocxExportOptions = {
    ...DEFAULT_EXPORT_OPTIONS,
    backend: 'docx',
    toc: false,
    tocDepth: 3,
    sectionNumbers: true,
};

// =============================================================================
// Org Content Preprocessing
// =============================================================================

/**
 * Preprocess org content for export, applying export options
 * This transforms the raw org text while respecting export settings
 */
function preprocessOrgForExport(content: string, opts: DocxExportOptions): string {
    let result = content;

    // Remove statistics cookies [1/3] [50%] when includePlanning is false
    if (opts.includePlanning === false) {
        // Match statistics cookies in headlines - they appear after the title text
        result = result.replace(/\s*\[(\d+\/\d+|\d+%)\]/g, '');
    }

    // Remove planning lines (SCHEDULED:, DEADLINE:, CLOSED:) when includePlanning is false
    if (opts.includePlanning === false) {
        // Planning lines appear right after headlines, starting with SCHEDULED/DEADLINE/CLOSED
        result = result.replace(/^[ \t]*(SCHEDULED|DEADLINE|CLOSED):.*$/gm, '');
        // Clean up any resulting blank lines
        result = result.replace(/\n{3,}/g, '\n\n');
    }

    // Remove CLOCK entries when includeClocks is false
    if (opts.includeClocks === false) {
        result = result.replace(/^[ \t]*CLOCK:.*$/gm, '');
        result = result.replace(/\n{3,}/g, '\n\n');
    }

    // Remove TODO keywords when includeTodo is false
    if (opts.includeTodo === false) {
        // Match headline with TODO/DONE keywords
        // Standard keywords: TODO, DONE, NEXT, WAITING, CANCELLED, etc.
        const todoKeywords = ['TODO', 'DONE', 'NEXT', 'WAITING', 'CANCELLED', 'CANCELED', 'HOLD', 'SOMEDAY'];
        if (opts.todoKeywords) {
            todoKeywords.push(...opts.todoKeywords.todo, ...opts.todoKeywords.done);
        }
        const todoPattern = new RegExp(`^(\\*+)\\s+(${todoKeywords.join('|')})\\s+`, 'gm');
        result = result.replace(todoPattern, '$1 ');
    }

    // Remove priority cookies [#A] when includePriority is false
    if (opts.includePriority === false) {
        result = result.replace(/\s*\[#[A-Z]\]/g, '');
    }

    // Remove tags from headlines when includeTags is false
    if (opts.includeTags === false) {
        // Tags appear at end of headline: :tag1:tag2:
        result = result.replace(/^(\*+\s+.*?)\s+:[\w@#%\-:]+:[ \t]*$/gm, '$1');
    }

    // Remove drawers when includeDrawers is false
    if (opts.includeDrawers === false) {
        // Match drawer blocks: :DRAWERNAME: ... :END:
        // Use a safer approach that processes line by line to avoid matching across headings
        const lines = result.split('\n');
        const outputLines: string[] = [];
        let inDrawer = false;

        for (const line of lines) {
            // Check for drawer start (but not :END:)
            if (/^[ \t]*:[A-Z_]+:[ \t]*$/.test(line) && !/^[ \t]*:END:[ \t]*$/.test(line)) {
                inDrawer = true;
                continue;
            }
            // Check for drawer end
            if (/^[ \t]*:END:[ \t]*$/.test(line)) {
                inDrawer = false;
                continue;
            }
            // Skip lines inside drawer, but NEVER skip headlines
            if (inDrawer && !line.match(/^\*+ /)) {
                continue;
            }
            // If we hit a headline while in a drawer, the drawer was malformed - exit drawer mode
            if (inDrawer && line.match(/^\*+ /)) {
                inDrawer = false;
            }
            outputLines.push(line);
        }
        result = outputLines.join('\n');
        result = result.replace(/\n{3,}/g, '\n\n');
    }

    // Remove PROPERTIES drawers specifically when includeProperties is false (prop:nil)
    if (opts.includeProperties === false) {
        const lines = result.split('\n');
        const outputLines: string[] = [];
        let inPropertiesDrawer = false;

        for (const line of lines) {
            // Check for :PROPERTIES: start
            if (/^[ \t]*:PROPERTIES:[ \t]*$/.test(line)) {
                inPropertiesDrawer = true;
                continue;
            }
            // Check for :END: while in properties drawer
            if (inPropertiesDrawer && /^[ \t]*:END:[ \t]*$/.test(line)) {
                inPropertiesDrawer = false;
                continue;
            }
            // Skip property lines inside PROPERTIES drawer
            if (inPropertiesDrawer) {
                // Property lines look like :PROPERTY_NAME: value
                if (/^[ \t]*:[A-Z_]+:/.test(line)) {
                    continue;
                }
                // If we hit something that's not a property line, we're out of the drawer
                inPropertiesDrawer = false;
            }
            // Also remove orphaned property lines (without :PROPERTIES: wrapper)
            // These look like :PROPERTY_NAME: value on their own line right after a heading
            if (/^:[A-Z_]+:\s+\S/.test(line) && !line.startsWith('*')) {
                continue;
            }
            outputLines.push(line);
        }
        result = outputLines.join('\n');
        result = result.replace(/\n{3,}/g, '\n\n');
    }

    // Convert LaTeX environments to $$...$$ format so pandoc recognizes them as math
    // This mimics what ox-pandoc does in org-pandoc-latex-environ
    result = convertLatexEnvironmentsForPandoc(result);

    // Extract bibliography path for pandoc (before removing the lines)
    const bibMatch = result.match(/^bibliography:(.+)$/m) ||
                     result.match(/^#\+BIBLIOGRAPHY:\s*(.+)$/im);
    if (bibMatch) {
        const bibPath = bibMatch[1].trim();
        // Store for later use in pandoc command
        (opts as any)._bibliographyPath = bibPath;
    }

    // Remove org-ref bibliography/bibstyle lines (pandoc will handle via --bibliography flag)
    result = result.replace(/^bibliography:.*$/gm, '');
    result = result.replace(/^bibstyle:.*$/gm, '');
    result = result.replace(/^#\+BIBLIOGRAPHY:.*$/gim, '');

    // Convert org-ref style citations to org-cite format: cite:key -> [cite:@key]
    // Pandoc's org reader understands [cite:@key] natively with --citeproc
    result = convertOrgRefToOrgCite(result);

    // Clean up orphaned :END: markers that don't have matching drawer starts
    // This can happen when drawer content is partially processed
    // Process line by line to find :END: without preceding drawer start
    const lines = result.split('\n');
    const cleanedLines: string[] = [];
    let inDrawer = false;

    for (const line of lines) {
        // Check for drawer start
        if (/^[ \t]*:(PROPERTIES|LOGBOOK|NOTES|CLOCK|RESULTS|[A-Z_]+):[ \t]*$/.test(line) &&
            !/^[ \t]*:END:[ \t]*$/.test(line)) {
            inDrawer = true;
            cleanedLines.push(line);
            continue;
        }
        // Check for :END:
        if (/^[ \t]*:END:[ \t]*$/.test(line)) {
            if (inDrawer) {
                // Valid :END: - keep it
                cleanedLines.push(line);
            }
            // If not in drawer, this is orphaned - skip it
            inDrawer = false;
            continue;
        }
        cleanedLines.push(line);
    }
    result = cleanedLines.join('\n');

    return result;
}

/**
 * Convert LaTeX environments to $$...$$ format for pandoc
 * Pandoc's org reader doesn't always recognize \begin{equation}...\end{equation}
 * but does recognize $$...$$ as display math
 * This mimics ox-pandoc's org-pandoc-latex-environ function
 */
function convertLatexEnvironmentsForPandoc(content: string): string {
    // Math environments that should be wrapped in $$...$$
    const mathEnvs = [
        'equation', 'equation\\*',
        'align', 'align\\*',
        'gather', 'gather\\*',
        'multline', 'multline\\*',
        'eqnarray', 'eqnarray\\*',
        'displaymath',
        'math',
    ];

    let result = content;

    for (const env of mathEnvs) {
        // Match \begin{env}...\end{env} including content with newlines
        const pattern = new RegExp(
            `\\\\begin\\{${env}\\}([\\s\\S]*?)\\\\end\\{${env}\\}`,
            'g'
        );

        result = result.replace(pattern, (_match: string, innerContent: string) => {
            // Strip \label{...} from the content (pandoc doesn't need it for OMML)
            let mathContent = innerContent.replace(/\\label\{[^}]*\}/g, '');

            // For non-starred environments, we keep the environment for numbering context
            // but wrap in $$ so pandoc recognizes it as math
            if (!env.includes('\\*')) {
                // Keep the full environment but wrap in $$ for pandoc
                return `$$\\begin{${env.replace('\\*', '*')}}${mathContent}\\end{${env.replace('\\*', '*')}}$$`;
            } else {
                // For starred (unnumbered) environments, just use the content
                return `$$${mathContent.trim()}$$`;
            }
        });
    }

    // Also handle \[...\] display math (should already work but ensure it's clean)
    // And standalone display math blocks

    return result;
}

/**
 * Convert org-ref style citations cite:key, citep:key, citet:key to org-cite format
 * Pandoc's org reader understands [cite:@key] format natively with --citeproc
 *
 * Note: Must not match existing org-cite format [cite:@key]
 */
function convertOrgRefToOrgCite(content: string): string {
    // Match org-ref citations: cite:key, citep:key, citet:key, citep:key1,key2
    // Use negative lookbehind (?<!\[) to avoid matching inside existing [cite:...]
    // Also avoid matching keys that start with @ (already org-cite format)
    return content.replace(/(?<!\[)(cite[pt]?):(?!@)([^\s\[\](),.;]+(?:,[^\s\[\](),.;]+)*)/g, (match, citeType, keysStr) => {
        // Handle comma-separated keys
        const keys = keysStr.split(',').map((k: string) => k.trim()).filter((k: string) => k);

        if (keys.length === 0) return match;

        // Convert to org-cite format [cite:@key] or [cite/t:@key] for textual
        const keyList = keys.map((k: string) => `@${k}`).join(';');

        if (citeType === 'citet') {
            // Textual citation: [cite/t:@key]
            return `[cite/t:${keyList}]`;
        } else {
            // citep or cite: [cite:@key]
            return `[cite:${keyList}]`;
        }
    });
}

// =============================================================================
// DOCX Export Backend
// =============================================================================

/**
 * DOCX export backend using pandoc
 */
export class DocxExportBackend {
    public readonly name = 'docx';

    /**
     * Export a complete document to DOCX format using pandoc
     * Returns a Buffer containing the DOCX file data
     */
    async exportDocument(
        doc: OrgDocumentNode,
        options?: Partial<DocxExportOptions>
    ): Promise<Buffer> {
        // Check pandoc availability
        const { available, version } = checkPandoc();
        if (!available) {
            throw new Error(
                'Pandoc is not installed or not in PATH. ' +
                'Please install pandoc from https://pandoc.org/installing.html'
            );
        }

        // Parse #+OPTIONS: keyword if present
        const optionsKeyword = doc.keywords['OPTIONS'];
        const parsedOptions = optionsKeyword ? parseOptionsKeyword(optionsKeyword) : {};

        // Handle toc option which can be boolean or number (depth)
        let tocEnabled = DEFAULT_DOCX_OPTIONS.toc;
        let tocDepth = DEFAULT_DOCX_OPTIONS.tocDepth;
        if (parsedOptions.toc !== undefined) {
            if (typeof parsedOptions.toc === 'number') {
                tocEnabled = parsedOptions.toc > 0;
                tocDepth = parsedOptions.toc;
            } else {
                tocEnabled = parsedOptions.toc;
            }
        }
        if (options?.toc !== undefined) {
            tocEnabled = !!options.toc;
        }
        if (options?.tocDepth !== undefined) {
            tocDepth = options.tocDepth;
        }

        const opts: DocxExportOptions = {
            ...DEFAULT_DOCX_OPTIONS,
            ...parsedOptions,
            ...options,
            backend: 'docx',
            toc: tocEnabled,
            tocDepth: tocDepth,
        };

        // Extract metadata from document keywords
        const title = doc.keywords['TITLE'] || opts.title || '';
        const author = doc.keywords['AUTHOR'] || opts.author || '';
        const date = doc.keywords['DATE'] || opts.date || '';

        // Use raw content if provided, otherwise serialize the AST
        // Raw content is preferred as AST serialization may lose some formatting
        // Apply preprocessing to respect export options
        const rawOrg = opts.rawContent || this.serializeToOrg(doc, opts);
        const orgContent = preprocessOrgForExport(rawOrg, opts);

        // Create temp files
        const tmpDir = os.tmpdir();
        const uniqueId = crypto.randomBytes(8).toString('hex');
        const inputFile = path.join(tmpDir, `export-${uniqueId}.org`);
        const outputFile = path.join(tmpDir, `export-${uniqueId}.docx`);

        try {
            // Write org content to temp file
            fs.writeFileSync(inputFile, orgContent, 'utf-8');

            // Build pandoc command
            const args: string[] = [
                `"${inputFile}"`,
                '-f', 'org',
                '-t', 'docx',
                '-o', `"${outputFile}"`,
            ];

            // Add metadata
            if (title) {
                args.push('-M', `title="${title}"`);
            }
            if (author) {
                args.push('-M', `author="${author}"`);
            }
            if (date) {
                args.push('-M', `date="${date}"`);
            }

            // Add TOC if enabled
            if (opts.toc) {
                args.push('--toc');
                args.push('--toc-depth', String(opts.tocDepth || 3));
            }

            // Add section numbering
            if (opts.sectionNumbers) {
                args.push('--number-sections');
            }

            // Add reference doc for styling if provided
            if (opts.referenceDoc && fs.existsSync(opts.referenceDoc)) {
                args.push('--reference-doc', `"${opts.referenceDoc}"`);
            }

            // Add bibliography support if a bibliography path was found
            const bibPath = (opts as any)._bibliographyPath;
            let useBibliography = false;
            let expandedBibPath = '';
            if (bibPath) {
                // Expand ~ to home directory
                expandedBibPath = bibPath.replace(/^~/, process.env.HOME || '');
                if (fs.existsSync(expandedBibPath)) {
                    useBibliography = true;
                }
            }

            // Add any additional pandoc arguments
            if (opts.pandocArgs && opts.pandocArgs.length > 0) {
                args.push(...opts.pandocArgs);
            }

            // Set working directory for relative path resolution
            const cwd = opts.basePath || process.cwd();

            // Build and run pandoc command
            let command: string;
            let bibWarning: string | undefined;
            if (useBibliography) {
                const bibArgs = [...args, '--bibliography', `"${expandedBibPath}"`, '--citeproc'];
                command = `pandoc ${bibArgs.join(' ')}`;
                try {
                    execSync(command, {
                        cwd,
                        stdio: ['pipe', 'pipe', 'pipe'],
                        timeout: 60000,
                        maxBuffer: 50 * 1024 * 1024,
                    });
                } catch (bibError: any) {
                    // Extract the error message for user feedback
                    const errorMsg = bibError.stderr?.toString() || bibError.message || String(bibError);
                    bibWarning = `Bibliography processing failed: ${errorMsg.slice(0, 500)}`;
                    console.warn(bibWarning);

                    // Fall back to export without bibliography
                    command = `pandoc ${args.join(' ')}`;
                    execSync(command, {
                        cwd,
                        stdio: ['pipe', 'pipe', 'pipe'],
                        timeout: 60000,
                        maxBuffer: 50 * 1024 * 1024,
                    });
                }
            } else {
                command = `pandoc ${args.join(' ')}`;
                execSync(command, {
                    cwd,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    timeout: 60000, // 60 second timeout
                    maxBuffer: 50 * 1024 * 1024, // 50MB buffer
                });
            }

            // Store warning for caller to display
            if (bibWarning) {
                (opts as any)._bibWarning = bibWarning;
            }

            // Read the generated docx
            const buffer = fs.readFileSync(outputFile);
            return buffer;

        } finally {
            // Clean up temp files
            try {
                if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
                if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
            } catch {
                // Ignore cleanup errors
            }
        }
    }

    /**
     * Serialize the AST back to org format
     * This preserves the original structure while applying any transformations
     */
    private serializeToOrg(doc: OrgDocumentNode, opts: DocxExportOptions): string {
        const lines: string[] = [];

        // Add document keywords
        if (doc.keywords['TITLE']) {
            lines.push(`#+TITLE: ${doc.keywords['TITLE']}`);
        }
        if (doc.keywords['AUTHOR']) {
            lines.push(`#+AUTHOR: ${doc.keywords['AUTHOR']}`);
        }
        if (doc.keywords['DATE']) {
            lines.push(`#+DATE: ${doc.keywords['DATE']}`);
        }
        if (doc.keywords['OPTIONS']) {
            lines.push(`#+OPTIONS: ${doc.keywords['OPTIONS']}`);
        }

        // Add other keywords
        for (const [key, value] of Object.entries(doc.keywords)) {
            if (!['TITLE', 'AUTHOR', 'DATE', 'OPTIONS'].includes(key)) {
                lines.push(`#+${key}: ${value}`);
            }
        }

        if (lines.length > 0) {
            lines.push(''); // Blank line after keywords
        }

        // Serialize document content
        for (const element of doc.children) {
            const serialized = this.serializeElement(element, opts);
            if (serialized) {
                lines.push(serialized);
            }
        }

        return lines.join('\n');
    }

    /**
     * Serialize a single element to org format
     */
    private serializeElement(element: any, opts: DocxExportOptions): string {
        switch (element.type) {
            case 'headline':
                return this.serializeHeadline(element, opts);
            case 'section':
                return this.serializeSection(element, opts);
            case 'paragraph':
                return this.serializeParagraph(element, opts);
            case 'src-block':
                return this.serializeSrcBlock(element, opts);
            case 'example-block':
                return this.serializeExampleBlock(element, opts);
            case 'quote-block':
                return this.serializeQuoteBlock(element, opts);
            case 'center-block':
                return this.serializeCenterBlock(element, opts);
            case 'verse-block':
                return this.serializeVerseBlock(element, opts);
            case 'special-block':
                return this.serializeSpecialBlock(element, opts);
            case 'plain-list':
                return this.serializePlainList(element, opts);
            case 'table':
                return this.serializeTable(element, opts);
            case 'latex-environment':
                return this.serializeLatexEnvironment(element, opts);
            case 'keyword':
                return this.serializeKeyword(element, opts);
            case 'fixed-width':
                return this.serializeFixedWidth(element, opts);
            case 'drawer':
                return this.serializeDrawer(element, opts);
            case 'horizontal-rule':
                return '-----';
            case 'comment':
                return `# ${element.properties?.value || ''}`;
            case 'comment-block':
                return `#+BEGIN_COMMENT\n${element.properties?.value || ''}\n#+END_COMMENT`;
            default:
                // For unknown elements, try to get raw value
                if (element.properties?.value) {
                    return element.properties.value;
                }
                return '';
        }
    }

    private serializeHeadline(headline: any, opts: DocxExportOptions): string {
        const lines: string[] = [];
        const level = headline.properties?.level || 1;
        const stars = '*'.repeat(level);

        let title = '';

        // Add TODO keyword if present and includeTodo is true
        if (headline.properties?.todoKeyword && opts.includeTodo !== false) {
            title += headline.properties.todoKeyword + ' ';
        }

        // Add priority if present and includePriority is true
        if (headline.properties?.priority && opts.includePriority !== false) {
            title += `[#${headline.properties.priority}] `;
        }

        // Add title text
        if (headline.properties?.title) {
            title += this.serializeObjects(headline.properties.title, opts);
        } else if (headline.properties?.rawValue) {
            title += headline.properties.rawValue;
        }

        // Strip statistics cookies if includePlanning is false
        if (opts.includePlanning === false) {
            title = title.replace(/\s*\[(\d+\/\d+|\d+%)\]/g, '');
        }

        // Add tags if includeTags is true
        if (headline.properties?.tags?.length > 0 && opts.includeTags !== false) {
            const tagStr = ':' + headline.properties.tags.join(':') + ':';
            title += ' ' + tagStr;
        }

        lines.push(`${stars} ${title.trim()}`);

        // Add planning info if present
        if (headline.properties?.planning && opts.includePlanning !== false) {
            const planning = headline.properties.planning;
            const planParts: string[] = [];
            if (planning.scheduled) planParts.push(`SCHEDULED: ${planning.scheduled}`);
            if (planning.deadline) planParts.push(`DEADLINE: ${planning.deadline}`);
            if (planning.closed) planParts.push(`CLOSED: ${planning.closed}`);
            if (planParts.length > 0) {
                lines.push(planParts.join(' '));
            }
        }

        // Serialize children (section and sub-headlines)
        for (const child of headline.children || []) {
            const serialized = this.serializeElement(child, opts);
            if (serialized) {
                lines.push(serialized);
            }
        }

        return lines.join('\n');
    }

    private serializeSection(section: any, opts: DocxExportOptions): string {
        const lines: string[] = [];
        for (const child of section.children || []) {
            const serialized = this.serializeElement(child, opts);
            if (serialized) {
                lines.push(serialized);
            }
        }
        return lines.join('\n');
    }

    private serializeParagraph(para: any, opts: DocxExportOptions): string {
        const content = this.serializeObjects(para.children || [], opts);
        return content + '\n';
    }

    private serializeObjects(objects: any[], opts: DocxExportOptions): string {
        if (!objects || objects.length === 0) return '';

        return objects.map(obj => this.serializeObject(obj, opts)).join('');
    }

    private serializeObject(obj: any, opts: DocxExportOptions): string {
        switch (obj.type) {
            case 'plain-text':
                return obj.properties?.value || '';
            case 'bold':
                return `*${this.serializeObjects(obj.children || [], opts)}*`;
            case 'italic':
                return `/${this.serializeObjects(obj.children || [], opts)}/`;
            case 'underline':
                return `_${this.serializeObjects(obj.children || [], opts)}_`;
            case 'strike-through':
                return `+${this.serializeObjects(obj.children || [], opts)}+`;
            case 'code':
                return `~${obj.properties?.value || ''}~`;
            case 'verbatim':
                return `=${obj.properties?.value || ''}=`;
            case 'link':
                return this.serializeLink(obj, opts);
            case 'latex-fragment':
                return obj.properties?.value || '';
            case 'entity':
                return obj.properties?.latex || obj.properties?.utf8 || '';
            case 'subscript':
                return `_{${this.serializeObjects(obj.children || [], opts)}}`;
            case 'superscript':
                return `^{${this.serializeObjects(obj.children || [], opts)}}`;
            case 'line-break':
                return '\\\\\n';
            case 'footnote-reference':
                return `[fn:${obj.properties?.label || ''}]`;
            case 'timestamp':
                return obj.properties?.rawValue || '';
            case 'statistics-cookie':
                // Hide statistics cookies if includePlanning is false
                if (opts.includePlanning === false) {
                    return '';
                }
                return obj.properties?.value || '';
            case 'citation':
                return this.serializeCitation(obj, opts);
            default:
                if (obj.properties?.value) {
                    return obj.properties.value;
                }
                return '';
        }
    }

    private serializeLink(link: any, opts: DocxExportOptions): string {
        const path = link.properties?.path || link.properties?.rawLink || '';
        const linkType = link.properties?.linkType || '';

        // Get description
        let description = '';
        if (link.children && link.children.length > 0) {
            description = this.serializeObjects(link.children, opts);
        }

        // Handle different link types
        if (linkType === 'cite' || linkType === 'citep' || linkType === 'citet') {
            // org-ref style citation
            return `${linkType}:${path}`;
        }

        if (description) {
            return `[[${path}][${description}]]`;
        }
        return `[[${path}]]`;
    }

    private serializeCitation(citation: any, opts: DocxExportOptions): string {
        // org-cite format: [cite:@key] or [cite:@key1;@key2]
        const keys = citation.properties?.keys || [];
        const style = citation.properties?.style || '';

        if (keys.length === 0) {
            return citation.properties?.rawValue || '';
        }

        const keyStr = keys.map((k: any) => `@${k.key || k}`).join(';');
        if (style) {
            return `[cite/${style}:${keyStr}]`;
        }
        return `[cite:${keyStr}]`;
    }

    private serializeSrcBlock(block: any, opts: DocxExportOptions): string {
        const lang = block.properties?.language || '';
        const params = block.properties?.parameters || '';
        const value = block.properties?.value || '';

        let header = `#+BEGIN_SRC ${lang}`;
        if (params) {
            header += ` ${params}`;
        }

        return `${header}\n${value}\n#+END_SRC\n`;
    }

    private serializeExampleBlock(block: any, opts: DocxExportOptions): string {
        const value = block.properties?.value || '';
        return `#+BEGIN_EXAMPLE\n${value}\n#+END_EXAMPLE\n`;
    }

    private serializeQuoteBlock(block: any, opts: DocxExportOptions): string {
        const lines: string[] = ['#+BEGIN_QUOTE'];
        for (const child of block.children || []) {
            const serialized = this.serializeElement(child, opts);
            if (serialized) {
                lines.push(serialized);
            }
        }
        lines.push('#+END_QUOTE\n');
        return lines.join('\n');
    }

    private serializeCenterBlock(block: any, opts: DocxExportOptions): string {
        const lines: string[] = ['#+BEGIN_CENTER'];
        for (const child of block.children || []) {
            const serialized = this.serializeElement(child, opts);
            if (serialized) {
                lines.push(serialized);
            }
        }
        lines.push('#+END_CENTER\n');
        return lines.join('\n');
    }

    private serializeVerseBlock(block: any, opts: DocxExportOptions): string {
        const value = block.properties?.value || '';
        return `#+BEGIN_VERSE\n${value}\n#+END_VERSE\n`;
    }

    private serializeSpecialBlock(block: any, opts: DocxExportOptions): string {
        const blockType = block.properties?.blockType || 'SPECIAL';
        const lines: string[] = [`#+BEGIN_${blockType}`];
        for (const child of block.children || []) {
            const serialized = this.serializeElement(child, opts);
            if (serialized) {
                lines.push(serialized);
            }
        }
        lines.push(`#+END_${blockType}\n`);
        return lines.join('\n');
    }

    private serializePlainList(list: any, opts: DocxExportOptions): string {
        const lines: string[] = [];
        for (const item of list.children || []) {
            const serialized = this.serializeListItem(item, list.properties?.listType, opts);
            if (serialized) {
                lines.push(serialized);
            }
        }
        return lines.join('\n') + '\n';
    }

    private serializeListItem(item: any, listType: string, opts: DocxExportOptions): string {
        const indent = '  '.repeat((item.properties?.indentation || 0) / 2);
        let bullet = '-';

        if (listType === 'ordered') {
            bullet = (item.properties?.counter || '1') + '.';
        } else if (listType === 'descriptive') {
            const tag = item.properties?.tag || '';
            bullet = `- ${tag} ::`;
        }

        const lines: string[] = [];
        let firstLine = true;

        for (const child of item.children || []) {
            if (child.type === 'paragraph') {
                const content = this.serializeParagraph(child, opts).trim();
                if (firstLine) {
                    lines.push(`${indent}${bullet} ${content}`);
                    firstLine = false;
                } else {
                    lines.push(`${indent}  ${content}`);
                }
            } else if (child.type === 'plain-list') {
                // Nested list
                const nested = this.serializePlainList(child, opts);
                lines.push(nested);
            } else {
                const serialized = this.serializeElement(child, opts);
                if (serialized) {
                    lines.push(serialized);
                }
            }
        }

        return lines.join('\n');
    }

    private serializeTable(table: any, opts: DocxExportOptions): string {
        const lines: string[] = [];

        for (const row of table.children || []) {
            if (row.properties?.rowType === 'rule') {
                lines.push('|-');
            } else {
                const cells: string[] = [];
                for (const cell of row.children || []) {
                    const content = this.serializeObjects(cell.children || [], opts);
                    cells.push(content.trim());
                }
                lines.push('| ' + cells.join(' | ') + ' |');
            }
        }

        return lines.join('\n') + '\n';
    }

    private serializeLatexEnvironment(env: any, opts: DocxExportOptions): string {
        return (env.properties?.value || '') + '\n';
    }

    private serializeKeyword(keyword: any, opts: DocxExportOptions): string {
        const key = keyword.properties?.key || '';
        const value = keyword.properties?.value || '';
        return `#+${key}: ${value}`;
    }

    private serializeFixedWidth(fw: any, opts: DocxExportOptions): string {
        const value = fw.properties?.value || '';
        return value.split('\n').map((line: string) => `: ${line}`).join('\n') + '\n';
    }

    private serializeDrawer(drawer: any, opts: DocxExportOptions): string {
        if (opts.includeDrawers === false) {
            return '';
        }
        const name = drawer.properties?.name || 'DRAWER';
        const lines: string[] = [`:${name}:`];
        for (const child of drawer.children || []) {
            const serialized = this.serializeElement(child, opts);
            if (serialized) {
                lines.push(serialized);
            }
        }
        lines.push(':END:\n');
        return lines.join('\n');
    }
}

// =============================================================================
// Public Export Function
// =============================================================================

/**
 * Export an org document to DOCX format using pandoc
 * Returns a Buffer containing the DOCX file data
 */
export async function exportToDocx(
    doc: OrgDocumentNode,
    options?: Partial<DocxExportOptions>
): Promise<Buffer> {
    const backend = new DocxExportBackend();
    return backend.exportDocument(doc, options);
}

/**
 * Check if pandoc is available for DOCX export
 */
export function isPandocAvailable(): boolean {
    return checkPandoc().available;
}

/**
 * Get pandoc version if available
 */
export function getPandocVersion(): string | null {
    return checkPandoc().version;
}
