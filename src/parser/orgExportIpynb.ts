/**
 * Jupyter Notebook (ipynb) export backend for org-mode documents
 *
 * Converts org AST to Jupyter Notebook format (.ipynb)
 * Compatible with ox-ipynb from Emacs
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import type {
    OrgElement,
    OrgObject,
    OrgDocumentNode,
    HeadlineElement,
    SectionElement,
    ParagraphElement,
    SrcBlockElement,
    ExampleBlockElement,
    QuoteBlockElement,
    CenterBlockElement,
    SpecialBlockElement,
    VerseBlockElement,
    LatexEnvironmentElement,
    TableElement,
    TableRowElement,
    PlainListElement,
    ItemElement,
    DrawerElement,
    KeywordElement,
    HorizontalRuleElement,
    CommentBlockElement,
    FixedWidthElement,
    FootnoteDefinitionElement,
    ExportBlockElement,
    BoldObject,
    ItalicObject,
    UnderlineObject,
    StrikeThroughObject,
    CodeObject,
    VerbatimObject,
    LinkObject,
    TimestampObject,
    EntityObject,
    LatexFragmentObject,
    SubscriptObject,
    SuperscriptObject,
    FootnoteReferenceObject,
    PlainTextObject,
    InlineSrcBlockObject,
    LineBreakObject,
    TableCellObject,
} from './orgElementTypes';

import type {
    ExportBackend,
    ExportState,
    ExportOptions,
} from './orgExport';

import {
    createExportState,
    exportObjects,
    shouldExport,
} from './orgExport';

import { ALL_CITATION_COMMANDS } from '../references/citationTypes';

// Set of citation link types (lowercase for comparison)
const CITATION_LINK_TYPES = new Set(ALL_CITATION_COMMANDS.map(c => c.toLowerCase()));

// =============================================================================
// Jupyter Notebook Types (nbformat v4)
// =============================================================================

/**
 * Complete Jupyter Notebook structure
 */
export interface JupyterNotebook {
    nbformat: 4;
    nbformat_minor: 5;
    metadata: NotebookMetadata;
    cells: JupyterCell[];
}

/**
 * Notebook-level metadata
 */
export interface NotebookMetadata {
    kernelspec: KernelSpec;
    language_info?: LanguageInfo;
    title?: string;
    authors?: { name: string }[];
    [key: string]: unknown;
}

/**
 * Kernel specification
 */
export interface KernelSpec {
    display_name: string;
    language: string;
    name: string;
}

/**
 * Language information
 */
export interface LanguageInfo {
    name: string;
    version?: string;
    file_extension?: string;
    mimetype?: string;
    [key: string]: unknown;
}

/**
 * A single Jupyter cell
 */
export interface JupyterCell {
    cell_type: 'markdown' | 'code' | 'raw';
    id: string;
    source: string[];
    metadata: CellMetadata;
    execution_count?: number | null;
    outputs?: CellOutput[];
}

/**
 * Cell-level metadata
 */
export interface CellMetadata {
    collapsed?: boolean;
    scrolled?: boolean | 'auto';
    tags?: string[];
    slideshow?: {
        slide_type: 'slide' | 'subslide' | 'fragment' | 'skip' | 'notes' | '-';
    };
    [key: string]: unknown;
}

/**
 * Cell output types
 */
export type CellOutput = StreamOutput | DisplayDataOutput | ExecuteResultOutput | ErrorOutput;

export interface StreamOutput {
    output_type: 'stream';
    name: 'stdout' | 'stderr';
    text: string[];
}

export interface DisplayDataOutput {
    output_type: 'display_data';
    data: OutputData;
    metadata: Record<string, unknown>;
}

export interface ExecuteResultOutput {
    output_type: 'execute_result';
    execution_count: number;
    data: OutputData;
    metadata: Record<string, unknown>;
}

export interface ErrorOutput {
    output_type: 'error';
    ename: string;
    evalue: string;
    traceback: string[];
}

/**
 * Output data with MIME types
 */
export interface OutputData {
    'text/plain'?: string[];
    'text/html'?: string[];
    'text/markdown'?: string[];
    'image/png'?: string;
    'image/jpeg'?: string;
    'image/svg+xml'?: string[];
    'application/json'?: unknown;
    [key: string]: unknown;
}

// =============================================================================
// IPYNB Export Options
// =============================================================================

export interface IpynbExportOptions extends ExportOptions {
    /** Kernel name (default: python3) */
    kernel?: string;
    /** Kernel display name */
    kernelDisplayName?: string;
    /** Language for the kernel */
    kernelLanguage?: string;
    /** Include #+RESULTS as cell outputs (default: true) */
    includeResults?: boolean;
    /** Base64 encode images in outputs (default: true) */
    embedImages?: boolean;
    /** Languages that should become code cells (default: matches kernel) */
    codeCellLanguages?: string[];
    /** Export mode: full, participant (strip solutions), or code-only */
    mode?: 'full' | 'participant' | 'code-only';
    /** Strip content between solution markers in participant mode */
    stripSolutions?: boolean;
    /** Base path for resolving relative file paths (e.g., images) */
    basePath?: string;
    /** Custom notebook metadata to merge */
    notebookMetadata?: Record<string, unknown>;
}

const DEFAULT_IPYNB_OPTIONS: IpynbExportOptions = {
    // kernel, kernelDisplayName, kernelLanguage are NOT set by default
    // to allow auto-detection from document content
    includeResults: true,
    embedImages: true,
    mode: 'full',
    stripSolutions: false,
};

// =============================================================================
// Kernel Mappings
// =============================================================================

/**
 * Map common language names to Jupyter kernel specs
 */
const KERNEL_MAPPINGS: Record<string, { name: string; displayName: string; language: string }> = {
    'python': { name: 'python3', displayName: 'Python 3', language: 'python' },
    'python3': { name: 'python3', displayName: 'Python 3', language: 'python' },
    'jupyter-python': { name: 'python3', displayName: 'Python 3', language: 'python' },
    'julia': { name: 'julia-1.9', displayName: 'Julia 1.9', language: 'julia' },
    'julia-1.9': { name: 'julia-1.9', displayName: 'Julia 1.9', language: 'julia' },
    'jupyter-julia': { name: 'julia-1.9', displayName: 'Julia 1.9', language: 'julia' },
    'r': { name: 'ir', displayName: 'R', language: 'R' },
    'ir': { name: 'ir', displayName: 'R', language: 'R' },
    'jupyter-r': { name: 'ir', displayName: 'R', language: 'R' },
    'javascript': { name: 'javascript', displayName: 'JavaScript', language: 'javascript' },
    'typescript': { name: 'typescript', displayName: 'TypeScript', language: 'typescript' },
    'rust': { name: 'rust', displayName: 'Rust', language: 'rust' },
    'go': { name: 'go', displayName: 'Go', language: 'go' },
    'scala': { name: 'scala', displayName: 'Scala', language: 'scala' },
};

// =============================================================================
// IPYNB Export State
// =============================================================================

interface IpynbExportState extends ExportState {
    ipynbOptions: IpynbExportOptions;
    /** Accumulated markdown content for current cell */
    markdownBuffer: string[];
    /** All generated cells */
    cells: JupyterCell[];
    /** Language counts for kernel detection */
    languageCounts: Map<string, number>;
    /** Parsed ATTR_IPYNB attributes for current element */
    ipynbAttrs?: Record<string, string>;
    /** Whether we're inside a results block that should attach to previous code cell */
    pendingResults: boolean;
}

// =============================================================================
// IPYNB Export Backend
// =============================================================================

export class IpynbExportBackend implements ExportBackend {
    public readonly name = 'ipynb';

    /**
     * Export a complete document to Jupyter Notebook format
     */
    exportDocument(doc: OrgDocumentNode, options?: Partial<IpynbExportOptions>): string {
        const opts: IpynbExportOptions = {
            ...DEFAULT_IPYNB_OPTIONS,
            ...options,
            backend: 'ipynb',
        };

        // Preprocess for participant mode
        let processedDoc = doc;
        if (opts.mode === 'participant') {
            processedDoc = this.preprocessParticipantMode(doc);
        }

        // Create export state
        const baseState = createExportState(opts);
        const state: IpynbExportState = {
            ...baseState,
            ipynbOptions: opts,
            markdownBuffer: [],
            cells: [],
            languageCounts: new Map(),
            pendingResults: false,
        };

        // Extract metadata from document keywords
        const metadata = this.extractDocumentMetadata(processedDoc, state);

        // First pass: count languages for kernel detection
        this.countLanguages(processedDoc, state);

        // Process document content
        if (processedDoc.section) {
            this.processSection(processedDoc.section, state);
        }

        for (const headline of processedDoc.children) {
            this.processHeadline(headline, state);
        }

        // Flush any remaining markdown buffer
        this.flushMarkdownBuffer(state);

        // Determine kernel from document or most common language
        const kernel = this.determineKernel(processedDoc, state);

        // Build notebook structure
        const notebook: JupyterNotebook = {
            nbformat: 4,
            nbformat_minor: 5,
            metadata: {
                kernelspec: kernel,
                language_info: {
                    name: kernel.language,
                },
                ...metadata,
                ...(opts.notebookMetadata || {}),
            },
            cells: state.cells,
        };

        return JSON.stringify(notebook, null, 1);
    }

    /**
     * Export a single element (required by ExportBackend interface)
     */
    exportElement(element: OrgElement, state: ExportState): string {
        // For ipynb, we don't use this method directly
        // Elements are processed through processElement which accumulates cells
        return '';
    }

    /**
     * Export a single object (required by ExportBackend interface)
     */
    exportObject(object: OrgObject, state: ExportState): string {
        return this.objectToMarkdown(object, state as IpynbExportState);
    }

    // =========================================================================
    // Document Processing
    // =========================================================================

    /**
     * Extract document metadata from keywords
     */
    private extractDocumentMetadata(
        doc: OrgDocumentNode,
        state: IpynbExportState
    ): Record<string, unknown> {
        const metadata: Record<string, unknown> = {};

        // Helper to get keyword with hyphen or underscore variants
        const getKeyword = (name: string): string | undefined => {
            if (!doc.keywords) return undefined;
            // Try hyphen version first (org-mode standard)
            const hyphenName = name;
            if (doc.keywords[hyphenName]) return doc.keywords[hyphenName];
            // Try underscore version (parser may convert)
            const underscoreName = name.replace(/-/g, '_');
            if (doc.keywords[underscoreName]) return doc.keywords[underscoreName];
            return undefined;
        };

        if (doc.keywords) {
            if (doc.keywords.TITLE) {
                metadata.title = doc.keywords.TITLE;
            }
            if (doc.keywords.AUTHOR) {
                metadata.authors = [{ name: doc.keywords.AUTHOR }];
            }

            // ox-ipynb specific keywords (support both hyphen and underscore)
            const kernelName = getKeyword('OX-IPYNB-KERNEL-NAME');
            if (kernelName) {
                state.ipynbOptions.kernel = kernelName;
            }

            const language = getKeyword('OX-IPYNB-LANGUAGE');
            if (language) {
                state.ipynbOptions.kernelLanguage = language;
            }

            // Parse custom notebook metadata
            const notebookMeta = getKeyword('OX-IPYNB-NOTEBOOK-METADATA');
            if (notebookMeta) {
                try {
                    const customMeta = JSON.parse(notebookMeta);
                    Object.assign(metadata, customMeta);
                } catch {
                    // Ignore parse errors
                }
            }
        }

        return metadata;
    }

    /**
     * Count languages in source blocks for kernel detection
     */
    private countLanguages(doc: OrgDocumentNode, state: IpynbExportState): void {
        const countInSection = (section: SectionElement | undefined) => {
            if (!section) return;
            for (const elem of section.children) {
                if (elem.type === 'src-block') {
                    const srcBlock = elem as SrcBlockElement;
                    const lang = srcBlock.properties.language?.toLowerCase() || '';
                    if (lang) {
                        state.languageCounts.set(lang, (state.languageCounts.get(lang) || 0) + 1);
                    }
                }
            }
        };

        const countInHeadline = (headline: HeadlineElement) => {
            countInSection(headline.section);
            for (const child of headline.children) {
                countInHeadline(child);
            }
        };

        countInSection(doc.section);
        for (const headline of doc.children) {
            countInHeadline(headline);
        }
    }

    /**
     * Determine kernel based on document keywords or language frequency
     */
    private determineKernel(doc: OrgDocumentNode, state: IpynbExportState): KernelSpec {
        // Priority 1: Explicit kernel from options or keywords
        if (state.ipynbOptions.kernel) {
            const mapping = KERNEL_MAPPINGS[state.ipynbOptions.kernel.toLowerCase()];
            if (mapping) {
                return {
                    name: mapping.name,
                    display_name: state.ipynbOptions.kernelDisplayName || mapping.displayName,
                    language: state.ipynbOptions.kernelLanguage || mapping.language,
                };
            }
            return {
                name: state.ipynbOptions.kernel,
                display_name: state.ipynbOptions.kernelDisplayName || state.ipynbOptions.kernel,
                language: state.ipynbOptions.kernelLanguage || state.ipynbOptions.kernel,
            };
        }

        // Priority 2: Most common language in source blocks
        let maxCount = 0;
        let mostCommon = 'python';
        for (const [lang, count] of state.languageCounts) {
            if (count > maxCount) {
                maxCount = count;
                mostCommon = lang;
            }
        }

        const mapping = KERNEL_MAPPINGS[mostCommon.toLowerCase()];
        if (mapping) {
            return {
                name: mapping.name,
                display_name: mapping.displayName,
                language: mapping.language,
            };
        }

        // Default to python3
        return {
            name: 'python3',
            display_name: 'Python 3',
            language: 'python',
        };
    }

    // =========================================================================
    // Element Processing
    // =========================================================================

    /**
     * Process a section (document preamble or headline content)
     */
    private processSection(section: SectionElement, state: IpynbExportState): void {
        for (let i = 0; i < section.children.length; i++) {
            const element = section.children[i];

            // Check for affiliated keywords
            if (element.type === 'keyword') {
                const keyword = element as KeywordElement;
                if (keyword.properties.key?.toUpperCase() === 'ATTR_IPYNB') {
                    state.ipynbAttrs = this.parseAttrIpynb(keyword.properties.value || '');
                    continue;
                }
            }

            // Check if this is a results block
            if (this.isResultsBlock(element)) {
                if (state.ipynbOptions.includeResults && state.cells.length > 0) {
                    const lastCell = state.cells[state.cells.length - 1];
                    if (lastCell.cell_type === 'code') {
                        this.addResultsToCell(lastCell, element, state);
                    }
                }
                continue;
            }

            this.processElement(element, state);
            state.ipynbAttrs = undefined;
        }
    }

    /**
     * Process a headline
     */
    private processHeadline(headline: HeadlineElement, state: IpynbExportState): void {
        // Check if headline should be exported
        if (!shouldExport(headline, state.options)) {
            return;
        }

        // Check for :remove: attribute in participant mode
        if (state.ipynbOptions.mode === 'participant') {
            const tags = headline.properties.tags || [];
            if (tags.includes('remove') || tags.includes('noexport')) {
                return;
            }
        }

        // Add headline as markdown
        const level = headline.properties.level;
        const title = headline.properties.rawValue || '';
        const hashes = '#'.repeat(level);
        state.markdownBuffer.push(`${hashes} ${title}`);
        state.markdownBuffer.push('');

        // Process section content
        if (headline.section) {
            this.processSection(headline.section, state);
        }

        // Process child headlines
        for (const child of headline.children) {
            this.processHeadline(child, state);
        }
    }

    /**
     * Process a single element
     */
    private processElement(element: OrgElement, state: IpynbExportState): void {
        switch (element.type) {
            case 'paragraph':
                this.processParagraph(element as ParagraphElement, state);
                break;

            case 'src-block':
                this.processSrcBlock(element as SrcBlockElement, state);
                break;

            case 'example-block':
                this.processExampleBlock(element as ExampleBlockElement, state);
                break;

            case 'quote-block':
                this.processQuoteBlock(element as QuoteBlockElement, state);
                break;

            case 'plain-list':
                this.processPlainList(element as PlainListElement, state);
                break;

            case 'table':
                this.processTable(element as TableElement, state);
                break;

            case 'horizontal-rule':
                state.markdownBuffer.push('---');
                state.markdownBuffer.push('');
                break;

            case 'latex-environment':
                this.processLatexEnvironment(element as LatexEnvironmentElement, state);
                break;

            case 'fixed-width':
                this.processFixedWidth(element as FixedWidthElement, state);
                break;

            case 'drawer':
                // Skip drawers in ipynb export
                break;

            case 'keyword':
                // Skip keywords (already processed for metadata)
                break;

            case 'export-block':
                this.processExportBlock(element as ExportBlockElement, state);
                break;

            default:
                // Skip unknown elements
                break;
        }
    }

    /**
     * Process a paragraph
     */
    private processParagraph(paragraph: ParagraphElement, state: IpynbExportState): void {
        const text = this.objectsToMarkdown(paragraph.children || [], state);
        if (text.trim()) {
            state.markdownBuffer.push(text);
            state.markdownBuffer.push('');
        }
    }

    /**
     * Process a source block
     */
    private processSrcBlock(srcBlock: SrcBlockElement, state: IpynbExportState): void {
        const lang = srcBlock.properties.language?.toLowerCase() || '';
        const code = srcBlock.properties.value || '';

        // Get kernel language for comparison
        const kernelLang = state.ipynbOptions.kernelLanguage?.toLowerCase() || 'python';
        const kernelName = state.ipynbOptions.kernel?.toLowerCase() || 'python3';

        // Determine if this should be a code cell
        // Code cells: language matches kernel or is in codeCellLanguages list
        const codeCellLanguages = state.ipynbOptions.codeCellLanguages || [];
        const isCodeCell = this.isCodeCellLanguage(lang, kernelLang, kernelName, codeCellLanguages);

        // Check for :eval no header
        const headers = srcBlock.properties.parameters || '';
        const evalNo = /\:eval\s+no\b/i.test(headers);

        if (isCodeCell && !evalNo) {
            // Flush markdown buffer before code cell
            this.flushMarkdownBuffer(state);

            // Parse cell metadata from ATTR_IPYNB
            const cellMetadata = this.parseCellMetadata(state.ipynbAttrs);

            // Create code cell
            const cell: JupyterCell = {
                cell_type: 'code',
                id: crypto.randomUUID(),
                source: this.splitIntoLines(code),
                metadata: cellMetadata,
                execution_count: null,
                outputs: [],
            };

            state.cells.push(cell);
        } else {
            // Non-kernel language: render as markdown code fence
            state.markdownBuffer.push('```' + lang);
            state.markdownBuffer.push(code);
            state.markdownBuffer.push('```');
            state.markdownBuffer.push('');
        }
    }

    /**
     * Check if a language should become a code cell
     */
    private isCodeCellLanguage(
        lang: string,
        kernelLang: string,
        kernelName: string,
        codeCellLanguages: string[]
    ): boolean {
        if (!lang) return false;

        // Direct match with kernel language
        if (lang === kernelLang) return true;

        // jupyter-* prefix languages
        if (lang.startsWith('jupyter-')) {
            const baseLang = lang.substring(8);
            if (baseLang === kernelLang) return true;
        }

        // Check explicit code cell languages list
        if (codeCellLanguages.includes(lang)) return true;

        // Common mappings
        const langMappings: Record<string, string[]> = {
            'python': ['python', 'python3', 'jupyter-python', 'ipython'],
            'julia': ['julia', 'jupyter-julia'],
            'r': ['r', 'R', 'jupyter-r'],
        };

        const kernelLangs = langMappings[kernelLang] || [kernelLang];
        return kernelLangs.includes(lang);
    }

    /**
     * Process an example block
     */
    private processExampleBlock(block: ExampleBlockElement, state: IpynbExportState): void {
        const value = block.properties.value || '';
        state.markdownBuffer.push('```');
        state.markdownBuffer.push(value);
        state.markdownBuffer.push('```');
        state.markdownBuffer.push('');
    }

    /**
     * Process a quote block
     */
    private processQuoteBlock(block: QuoteBlockElement, state: IpynbExportState): void {
        for (const child of block.children || []) {
            if (child.type === 'paragraph') {
                const para = child as ParagraphElement;
                const text = this.objectsToMarkdown(para.children || [], state);
                const lines = text.split('\n');
                for (const line of lines) {
                    state.markdownBuffer.push(`> ${line}`);
                }
            }
        }
        state.markdownBuffer.push('');
    }

    /**
     * Process a plain list
     */
    private processPlainList(list: PlainListElement, state: IpynbExportState): void {
        const listType = list.properties.listType;
        let counter = 1;

        for (const item of list.children || []) {
            if (item.type === 'item') {
                const itemElem = item as ItemElement;
                const bullet = listType === 'ordered' ? `${counter++}.` : '-';
                const checkbox = itemElem.properties.checkbox;
                let prefix = bullet;

                if (checkbox === 'on') {
                    prefix += ' [x]';
                } else if (checkbox === 'off') {
                    prefix += ' [ ]';
                } else if (checkbox === 'trans') {
                    prefix += ' [-]';
                }

                // Get item content
                if (itemElem.children && itemElem.children.length > 0) {
                    const firstChild = itemElem.children[0];
                    if (firstChild.type === 'paragraph') {
                        const text = this.objectsToMarkdown((firstChild as ParagraphElement).children || [], state);
                        state.markdownBuffer.push(`${prefix} ${text}`);
                    }
                }
            }
        }
        state.markdownBuffer.push('');
    }

    /**
     * Process a table
     */
    private processTable(table: TableElement, state: IpynbExportState): void {
        const rows: string[][] = [];

        for (const row of table.children || []) {
            if (row.type === 'table-row') {
                const tableRow = row as TableRowElement;
                if (tableRow.properties.rowType === 'standard') {
                    const cells = (tableRow.children || []).map(cell => {
                        if (cell.type === 'table-cell') {
                            return this.objectsToMarkdown((cell as TableCellObject).children || [], state);
                        }
                        return '';
                    });
                    rows.push(cells);
                }
            }
        }

        if (rows.length === 0) return;

        // Calculate column widths
        const colCount = Math.max(...rows.map(r => r.length));
        const colWidths: number[] = [];
        for (let col = 0; col < colCount; col++) {
            const maxWidth = Math.max(3, ...rows.map(row => (row[col] || '').length));
            colWidths.push(maxWidth);
        }

        // Output header row
        const headerCells = rows[0].map((cell, i) => cell.padEnd(colWidths[i]));
        state.markdownBuffer.push(`| ${headerCells.join(' | ')} |`);

        // Output separator
        const separator = colWidths.map(w => '-'.repeat(w));
        state.markdownBuffer.push(`| ${separator.join(' | ')} |`);

        // Output data rows
        for (let i = 1; i < rows.length; i++) {
            const cells = rows[i].map((cell, j) => (cell || '').padEnd(colWidths[j] || 3));
            state.markdownBuffer.push(`| ${cells.join(' | ')} |`);
        }
        state.markdownBuffer.push('');
    }

    /**
     * Process a LaTeX environment
     */
    private processLatexEnvironment(env: LatexEnvironmentElement, state: IpynbExportState): void {
        const value = env.properties.value || '';
        state.markdownBuffer.push('$$');
        state.markdownBuffer.push(value);
        state.markdownBuffer.push('$$');
        state.markdownBuffer.push('');
    }

    /**
     * Process a fixed-width block (for results)
     */
    private processFixedWidth(block: FixedWidthElement, state: IpynbExportState): void {
        const value = block.properties.value || '';
        state.markdownBuffer.push('```');
        state.markdownBuffer.push(value);
        state.markdownBuffer.push('```');
        state.markdownBuffer.push('');
    }

    /**
     * Process an export block
     */
    private processExportBlock(block: ExportBlockElement, state: IpynbExportState): void {
        const backend = block.properties.backend?.toLowerCase();
        const value = block.properties.value || '';

        // Only include if it's for ipynb or jupyter
        if (backend === 'ipynb' || backend === 'jupyter') {
            // Flush markdown and add as raw cell
            this.flushMarkdownBuffer(state);
            state.cells.push({
                cell_type: 'raw',
                id: crypto.randomUUID(),
                source: this.splitIntoLines(value),
                metadata: {},
            });
        } else if (backend === 'markdown' || backend === 'md') {
            state.markdownBuffer.push(value);
            state.markdownBuffer.push('');
        }
    }

    // =========================================================================
    // Results Handling
    // =========================================================================

    /**
     * Check if an element is a results block
     */
    private isResultsBlock(element: OrgElement): boolean {
        // Results can be: fixed-width, example-block, or drawer with name RESULTS
        if (element.type === 'fixed-width') return true;
        if (element.type === 'example-block') return true;
        if (element.type === 'drawer') {
            const drawer = element as DrawerElement;
            return drawer.properties.name?.toUpperCase() === 'RESULTS';
        }
        return false;
    }

    /**
     * Add results to a code cell as outputs
     */
    private addResultsToCell(
        cell: JupyterCell,
        resultsElement: OrgElement,
        state: IpynbExportState
    ): void {
        if (!cell.outputs) {
            cell.outputs = [];
        }

        let text = '';

        if (resultsElement.type === 'fixed-width') {
            text = (resultsElement as FixedWidthElement).properties.value || '';
        } else if (resultsElement.type === 'example-block') {
            text = (resultsElement as ExampleBlockElement).properties.value || '';
        } else if (resultsElement.type === 'drawer') {
            const drawer = resultsElement as DrawerElement;
            // Extract content from drawer children
            for (const child of drawer.children || []) {
                if (child.type === 'paragraph') {
                    text += this.objectsToMarkdown((child as ParagraphElement).children || [], state) + '\n';
                } else if (child.type === 'fixed-width') {
                    text += (child as FixedWidthElement).properties.value || '';
                }
            }
        }

        // Check for image links in results
        const imageMatch = text.match(/\[\[file:([^\]]+\.(png|jpg|jpeg|gif|svg))\]\]/i);
        if (imageMatch && state.ipynbOptions.embedImages) {
            const imagePath = imageMatch[1];
            const imageOutput = this.createImageOutput(imagePath, state);
            if (imageOutput) {
                cell.outputs.push(imageOutput);
                return;
            }
        }

        // Add as stream output
        if (text.trim()) {
            cell.outputs.push({
                output_type: 'stream',
                name: 'stdout',
                text: this.splitIntoLines(text),
            });
        }
    }

    /**
     * Create an image output from a file path
     */
    private createImageOutput(
        imagePath: string,
        state: IpynbExportState
    ): DisplayDataOutput | null {
        try {
            // Resolve path
            let fullPath = imagePath;
            if (!path.isAbsolute(imagePath) && state.ipynbOptions.basePath) {
                fullPath = path.join(state.ipynbOptions.basePath, imagePath);
            }

            // Read and encode image
            const imageBuffer = fs.readFileSync(fullPath);
            const base64 = imageBuffer.toString('base64');

            // Determine MIME type
            const ext = path.extname(imagePath).toLowerCase();
            let mimeType = 'image/png';
            if (ext === '.jpg' || ext === '.jpeg') {
                mimeType = 'image/jpeg';
            } else if (ext === '.gif') {
                mimeType = 'image/gif';
            } else if (ext === '.svg') {
                mimeType = 'image/svg+xml';
            }

            const data: OutputData = {};
            if (mimeType === 'image/svg+xml') {
                data[mimeType] = this.splitIntoLines(imageBuffer.toString('utf-8'));
            } else {
                data[mimeType] = base64;
            }

            return {
                output_type: 'display_data',
                data,
                metadata: {},
            };
        } catch {
            // File not found or read error
            return null;
        }
    }

    // =========================================================================
    // Object to Markdown Conversion
    // =========================================================================

    /**
     * Convert an array of objects to markdown text
     */
    private objectsToMarkdown(objects: OrgObject[], state: IpynbExportState): string {
        return objects.map(obj => this.objectToMarkdown(obj, state)).join('');
    }

    /**
     * Convert a single object to markdown text
     */
    private objectToMarkdown(object: OrgObject, state: IpynbExportState): string {
        switch (object.type) {
            case 'plain-text':
                return (object as PlainTextObject).properties.value || '';

            case 'bold':
                return `**${this.objectsToMarkdown((object as BoldObject).children || [], state)}**`;

            case 'italic':
                return `*${this.objectsToMarkdown((object as ItalicObject).children || [], state)}*`;

            case 'underline':
                return `_${this.objectsToMarkdown((object as UnderlineObject).children || [], state)}_`;

            case 'strike-through':
                return `~~${this.objectsToMarkdown((object as StrikeThroughObject).children || [], state)}~~`;

            case 'code':
                return `\`${(object as CodeObject).properties.value || ''}\``;

            case 'verbatim':
                return `\`${(object as VerbatimObject).properties.value || ''}\``;

            case 'link':
                return this.linkToMarkdown(object as LinkObject, state);

            case 'latex-fragment':
                return this.latexFragmentToMarkdown(object as LatexFragmentObject);

            case 'subscript':
                return `<sub>${this.objectsToMarkdown((object as SubscriptObject).children || [], state)}</sub>`;

            case 'superscript':
                return `<sup>${this.objectsToMarkdown((object as SuperscriptObject).children || [], state)}</sup>`;

            case 'line-break':
                return '  \n';

            case 'entity':
                return this.entityToMarkdown(object as EntityObject);

            case 'inline-src-block':
                const inlineSrc = object as InlineSrcBlockObject;
                return `\`${inlineSrc.properties.value || ''}\``;

            case 'footnote-reference':
                const fnRef = object as FootnoteReferenceObject;
                return `[^${fnRef.properties.label || ''}]`;

            default:
                return '';
        }
    }

    /**
     * Convert a link to markdown
     */
    private linkToMarkdown(link: LinkObject, state: IpynbExportState): string {
        const linkType = link.properties.linkType || '';
        const linkPath = link.properties.path || '';
        const description = link.children && link.children.length > 0
            ? this.objectsToMarkdown(link.children, state)
            : linkPath;

        // Handle citation links (cite:key, citep:key, citet:key, etc.)
        if (linkType && CITATION_LINK_TYPES.has(linkType.toLowerCase())) {
            return this.citationToMarkdown(linkType, linkPath);
        }

        // Handle file links to images
        if (linkType === 'file' && /\.(png|jpg|jpeg|gif|svg)$/i.test(linkPath)) {
            return `![${description}](${linkPath})`;
        }

        // Handle http/https links
        if (linkType === 'http' || linkType === 'https') {
            return `[${description}](${linkType}:${linkPath})`;
        }

        // Handle file links
        if (linkType === 'file') {
            return `[${description}](${linkPath})`;
        }

        // Default link format
        if (linkType) {
            return `[${description}](${linkType}:${linkPath})`;
        }

        return `[${description}](${linkPath})`;
    }

    /**
     * Convert a citation link to markdown format
     * Uses Pandoc-style citations [@key] which are widely supported
     */
    private citationToMarkdown(command: string, path: string): string {
        // Parse citation keys from the path
        // org-ref v2: cite:key1,key2
        // org-ref v3: cite:&key1;&key2
        const keys = path
            .replace(/^&/, '')       // Remove leading &
            .split(/[,;]/)           // Split by comma or semicolon
            .map(k => k.replace(/^&/, '').trim())  // Remove & prefix from each key
            .filter(k => k.length > 0);

        if (keys.length === 0) {
            return `[${command}:${path}]`;
        }

        const cmd = command.toLowerCase();

        // Format based on citation type
        // Use Pandoc-style citations which are recognized by many Jupyter extensions
        const formattedKeys = keys.map(k => `@${k}`).join('; ');

        // Different formatting based on citation command
        if (cmd === 'citet' || cmd === 'citealt') {
            // Textual: Author (Year) - in Pandoc format: @key
            return formattedKeys;
        } else if (cmd === 'citeauthor') {
            // Author only - use Pandoc -@key syntax to suppress year
            return keys.map(k => `-@${k}`).join('; ');
        } else if (cmd === 'citeyear') {
            // Year only - show as keys in brackets without @
            return `[${keys.join('; ')}]`;
        } else {
            // Parenthetical (cite, citep, citealp, etc.): (Author, Year)
            // Pandoc format: [@key] or [see @key, p. 10]
            return `[${formattedKeys}]`;
        }
    }

    /**
     * Convert a LaTeX fragment to markdown
     */
    private latexFragmentToMarkdown(fragment: LatexFragmentObject): string {
        const value = fragment.properties.value || '';

        // Inline math: \( \) or $ $
        if (value.startsWith('\\(') && value.endsWith('\\)')) {
            const inner = value.slice(2, -2);
            return `$${inner}$`;
        }

        // Display math: \[ \] or $$ $$
        if (value.startsWith('\\[') && value.endsWith('\\]')) {
            const inner = value.slice(2, -2);
            return `$$${inner}$$`;
        }

        // Already in $ or $$ form
        return value;
    }

    /**
     * Convert an entity to its UTF-8 representation
     */
    private entityToMarkdown(entity: EntityObject): string {
        const name = entity.properties.name || '';

        // Common org entities
        const entityMap: Record<string, string> = {
            'nbsp': '\u00A0',
            'mdash': '\u2014',
            'ndash': '\u2013',
            'times': '\u00D7',
            'div': '\u00F7',
            'plusmn': '\u00B1',
            'infin': '\u221E',
            'larr': '\u2190',
            'rarr': '\u2192',
            'uarr': '\u2191',
            'darr': '\u2193',
            'le': '\u2264',
            'ge': '\u2265',
            'ne': '\u2260',
            'alpha': '\u03B1',
            'beta': '\u03B2',
            'gamma': '\u03B3',
            'delta': '\u03B4',
            'epsilon': '\u03B5',
            'lambda': '\u03BB',
            'mu': '\u03BC',
            'pi': '\u03C0',
            'sigma': '\u03C3',
            'theta': '\u03B8',
            'omega': '\u03C9',
        };

        return entityMap[name] || entity.properties.utf8 || `\\${name}`;
    }

    // =========================================================================
    // Cell Metadata Parsing
    // =========================================================================

    /**
     * Parsed ATTR_IPYNB values
     */
    private parseAttrIpynb(value: string): Record<string, string> {
        const result: Record<string, string> = {};

        // Parse key:value pairs from the attribute string
        // Format: :key1 value1 :key2 value2
        const pairs = value.match(/:(\w+)\s+([^:]+)/g) || [];

        for (const pair of pairs) {
            const match = pair.match(/:(\w+)\s+(.+)/);
            if (match) {
                const [, key, val] = match;
                result[key] = val.trim();
            }
        }

        return result;
    }

    /**
     * Parse affiliated keywords into cell metadata
     */
    private parseCellMetadata(affiliated?: Record<string, string>): CellMetadata {
        const metadata: CellMetadata = {};

        if (!affiliated) return metadata;

        const attrs = affiliated as any;

        // Parse collapsed
        if (attrs.collapsed === 't' || attrs.collapsed === 'true') {
            metadata.collapsed = true;
        }

        // Parse scrolled
        if (attrs.scrolled === 't' || attrs.scrolled === 'true') {
            metadata.scrolled = true;
        } else if (attrs.scrolled === 'auto') {
            metadata.scrolled = 'auto';
        }

        // Parse tags
        if (attrs.tags) {
            try {
                // Try parsing as JSON array
                if (attrs.tags.startsWith('[')) {
                    metadata.tags = JSON.parse(attrs.tags);
                } else {
                    // Space-separated tags
                    metadata.tags = attrs.tags.split(/\s+/).filter(Boolean);
                }
            } catch {
                metadata.tags = [attrs.tags];
            }
        }

        // Parse slideshow metadata
        if (attrs.slideshow) {
            try {
                // Parse S-expression format: ((slide_type . "slide"))
                const sexpMatch = attrs.slideshow.match(/\(\(slide_type\s+\.\s+"?(\w+)"?\)\)/);
                if (sexpMatch) {
                    metadata.slideshow = { slide_type: sexpMatch[1] as any };
                } else if (attrs.slideshow.startsWith('{')) {
                    // JSON format
                    metadata.slideshow = JSON.parse(attrs.slideshow);
                }
            } catch {
                // Ignore parse errors
            }
        }

        return metadata;
    }

    // =========================================================================
    // Participant Mode Processing
    // =========================================================================

    /**
     * Preprocess document for participant mode
     * Removes content between solution markers and elements with :remove t
     */
    private preprocessParticipantMode(doc: OrgDocumentNode): OrgDocumentNode {
        // Create a deep copy and filter
        const processSection = (section: SectionElement | undefined): SectionElement | undefined => {
            if (!section) return undefined;

            const filteredChildren: OrgElement[] = [];
            let skipUntilEndSolution = false;
            let skipUntilEndHidden = false;

            for (const child of section.children) {
                // Check for solution markers in source blocks
                if (child.type === 'src-block') {
                    const srcBlock = child as SrcBlockElement;
                    const code = srcBlock.properties.value || '';

                    if (skipUntilEndSolution || skipUntilEndHidden) {
                        continue;
                    }

                    // Filter solution content from within the code block
                    const filteredCode = this.filterSolutionContent(code);
                    if (filteredCode.trim()) {
                        // Only add if there's content left after filtering
                        const filteredSrcBlock: SrcBlockElement = {
                            ...srcBlock,
                            properties: {
                                ...srcBlock.properties,
                                value: filteredCode,
                            },
                        };
                        filteredChildren.push(filteredSrcBlock);
                    }
                    continue;
                }

                if (skipUntilEndSolution || skipUntilEndHidden) {
                    continue;
                }

                // Check for ATTR_IPYNB :remove t
                if (child.type === 'keyword') {
                    const keyword = child as KeywordElement;
                    if (keyword.properties.key?.toUpperCase() === 'ATTR_IPYNB') {
                        const value = keyword.properties.value || '';
                        if (value.includes(':remove') && (value.includes('t') || value.includes('true'))) {
                            // Skip next element
                            continue;
                        }
                    }
                }

                filteredChildren.push(child);
            }

            return {
                ...section,
                children: filteredChildren,
            };
        };

        const processHeadline = (headline: HeadlineElement): HeadlineElement | null => {
            // Check for :remove: tag
            const tags = headline.properties.tags || [];
            if (tags.includes('remove')) {
                return null;
            }

            return {
                ...headline,
                section: processSection(headline.section),
                children: headline.children
                    .map(child => processHeadline(child))
                    .filter((h): h is HeadlineElement => h !== null),
            };
        };

        return {
            ...doc,
            section: processSection(doc.section),
            children: doc.children
                .map(child => processHeadline(child))
                .filter((h): h is HeadlineElement => h !== null),
        };
    }

    /**
     * Filter solution content from code
     */
    private filterSolutionContent(code: string): string {
        const lines = code.split('\n');
        const filteredLines: string[] = [];
        let skipUntilEnd = false;
        let markerType = '';

        for (const line of lines) {
            // Check for solution markers
            if (line.includes('### BEGIN SOLUTION') || line.includes('# BEGIN SOLUTION')) {
                skipUntilEnd = true;
                markerType = 'SOLUTION';
                continue;
            }
            if (line.includes('### END SOLUTION') || line.includes('# END SOLUTION')) {
                if (markerType === 'SOLUTION') {
                    skipUntilEnd = false;
                    markerType = '';
                }
                continue;
            }

            // Check for hidden markers
            if (line.includes('### BEGIN HIDDEN') || line.includes('# BEGIN HIDDEN')) {
                skipUntilEnd = true;
                markerType = 'HIDDEN';
                continue;
            }
            if (line.includes('### END HIDDEN') || line.includes('# END HIDDEN')) {
                if (markerType === 'HIDDEN') {
                    skipUntilEnd = false;
                    markerType = '';
                }
                continue;
            }

            if (!skipUntilEnd) {
                filteredLines.push(line);
            }
        }

        return filteredLines.join('\n');
    }

    // =========================================================================
    // Utility Methods
    // =========================================================================

    /**
     * Flush accumulated markdown buffer to a cell
     */
    private flushMarkdownBuffer(state: IpynbExportState): void {
        if (state.markdownBuffer.length === 0) return;

        // Remove trailing empty strings
        while (state.markdownBuffer.length > 0 &&
            state.markdownBuffer[state.markdownBuffer.length - 1] === '') {
            state.markdownBuffer.pop();
        }

        if (state.markdownBuffer.length === 0) return;

        // Skip markdown cells in code-only mode
        if (state.ipynbOptions.mode === 'code-only') {
            state.markdownBuffer = [];
            return;
        }

        // Create markdown cell
        const content = state.markdownBuffer.join('\n');
        state.cells.push({
            cell_type: 'markdown',
            id: crypto.randomUUID(),
            source: this.splitIntoLines(content),
            metadata: {},
        });

        state.markdownBuffer = [];
    }

    /**
     * Split content into lines with newline characters preserved
     */
    private splitIntoLines(content: string): string[] {
        const lines = content.split('\n');
        return lines.map((line, index) => {
            // Add newline to all lines except the last
            return index < lines.length - 1 ? line + '\n' : line;
        });
    }
}

// =============================================================================
// Export Functions
// =============================================================================

/**
 * Export an org document to Jupyter Notebook format
 */
export function exportToIpynb(
    doc: OrgDocumentNode,
    options?: Partial<IpynbExportOptions>
): string {
    const backend = new IpynbExportBackend();
    return backend.exportDocument(doc, options);
}

/**
 * Export an org document to Jupyter Notebook in participant mode
 */
export function exportToIpynbParticipant(
    doc: OrgDocumentNode,
    options?: Partial<IpynbExportOptions>
): string {
    const backend = new IpynbExportBackend();
    return backend.exportDocument(doc, {
        ...options,
        mode: 'participant',
    });
}
