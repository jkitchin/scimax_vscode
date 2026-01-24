/**
 * Hover Provider for org-mode
 * Provides hover information for entities, links, blocks, timestamps, etc.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ORG_ENTITIES } from '../parser/orgEntities';
import {
    findLatexFragmentAtPosition,
    createLatexHover,
    invalidateEquationCounterCache,
} from './latexPreviewProvider';
import { parseDiarySexp, getDiarySexpDates } from '../parser/orgDiarySexp';
import { DAY_NAMES_SHORT, MONTH_NAMES_SHORT } from '../utils/dateConstants';
import {
    parseClockLine,
    formatDuration,
    formatDurationLong,
    parseEffort,
} from '../parser/orgClocking';

// Entity lookup map for fast access
const ENTITY_MAP = new Map<string, { utf8: string; latex: string; html: string }>();
for (const [name, entity] of Object.entries(ORG_ENTITIES)) {
    ENTITY_MAP.set(name, {
        utf8: entity.utf8,
        latex: entity.latex,
        html: entity.html,
    });
}

// Image file extensions
const IMAGE_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.tiff', '.tif'
]);

// Excalidraw file extensions
const EXCALIDRAW_EXTENSIONS = ['.excalidraw', '.excalidraw.json', '.excalidraw.svg', '.excalidraw.png'];

/**
 * Check if a file path is an Excalidraw file
 */
function isExcalidrawFile(filePath: string): boolean {
    const lowerPath = filePath.toLowerCase();
    return EXCALIDRAW_EXTENSIONS.some(ext => lowerPath.endsWith(ext));
}

/**
 * Excalidraw element interface for preview rendering
 */
interface ExcalidrawElement {
    type: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    points?: [number, number][];
    strokeColor?: string;
    backgroundColor?: string;
    fillStyle?: string;
    isDeleted?: boolean;
    text?: string;
}

/**
 * Generate a simple SVG preview from Excalidraw JSON
 * This creates a simplified representation suitable for hover previews
 */
function generateExcalidrawPreviewSvg(data: { elements?: ExcalidrawElement[]; appState?: { viewBackgroundColor?: string } }): string | null {
    const elements = data.elements?.filter(el => !el.isDeleted) || [];
    if (elements.length === 0) {
        return null;
    }

    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const el of elements) {
        const x = el.x || 0;
        const y = el.y || 0;
        const w = el.width || 0;
        const h = el.height || 0;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);

        // Handle line/arrow points
        if (el.points) {
            for (const [px, py] of el.points) {
                minX = Math.min(minX, x + px);
                minY = Math.min(minY, y + py);
                maxX = Math.max(maxX, x + px);
                maxY = Math.max(maxY, y + py);
            }
        }
    }

    // Add padding
    const padding = 20;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const width = maxX - minX;
    const height = maxY - minY;

    // Scale to fit in preview size (max 400x300)
    const maxWidth = 400;
    const maxHeight = 300;
    const scale = Math.min(maxWidth / width, maxHeight / height, 1);
    const viewWidth = Math.ceil(width * scale);
    const viewHeight = Math.ceil(height * scale);

    const bgColor = data.appState?.viewBackgroundColor || '#ffffff';

    // Generate SVG shapes
    const shapes: string[] = [];
    for (const el of elements) {
        const x = (el.x || 0) - minX;
        const y = (el.y || 0) - minY;
        const w = el.width || 0;
        const h = el.height || 0;
        const stroke = el.strokeColor || '#000000';
        const fill = el.fillStyle === 'solid' ? (el.backgroundColor || 'none') : 'none';

        switch (el.type) {
            case 'rectangle':
                shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${stroke}" fill="${fill}" stroke-width="2"/>`);
                break;
            case 'ellipse':
                shapes.push(`<ellipse cx="${x + w/2}" cy="${y + h/2}" rx="${w/2}" ry="${h/2}" stroke="${stroke}" fill="${fill}" stroke-width="2"/>`);
                break;
            case 'diamond':
                const cx = x + w/2, cy = y + h/2;
                shapes.push(`<polygon points="${cx},${y} ${x+w},${cy} ${cx},${y+h} ${x},${cy}" stroke="${stroke}" fill="${fill}" stroke-width="2"/>`);
                break;
            case 'line':
            case 'arrow':
                if (el.points && el.points.length >= 2) {
                    const pts = el.points.map(([px, py]) => `${x + px},${y + py}`).join(' ');
                    shapes.push(`<polyline points="${pts}" stroke="${stroke}" fill="none" stroke-width="2"/>`);
                    if (el.type === 'arrow' && el.points.length >= 2) {
                        // Add arrowhead
                        const last = el.points[el.points.length - 1];
                        const prev = el.points[el.points.length - 2];
                        const angle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
                        const ax = x + last[0], ay = y + last[1];
                        const size = 10;
                        shapes.push(`<polygon points="${ax},${ay} ${ax - size * Math.cos(angle - 0.5)},${ay - size * Math.sin(angle - 0.5)} ${ax - size * Math.cos(angle + 0.5)},${ay - size * Math.sin(angle + 0.5)}" fill="${stroke}"/>`);
                    }
                }
                break;
            case 'text':
                // Show text placeholder
                shapes.push(`<rect x="${x}" y="${y}" width="${Math.max(w, 50)}" height="${Math.max(h, 20)}" stroke="#aaa" fill="#f5f5f5" stroke-width="1" stroke-dasharray="4"/>`);
                break;
            case 'freedraw':
                if (el.points && el.points.length >= 2) {
                    const pts = el.points.map(([px, py]) => `${x + px},${y + py}`).join(' ');
                    shapes.push(`<polyline points="${pts}" stroke="${stroke}" fill="none" stroke-width="2"/>`);
                }
                break;
            case 'image':
                // Show image placeholder
                shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="#666" fill="#e0e0e0" stroke-width="1"/>`);
                shapes.push(`<text x="${x + w/2}" y="${y + h/2}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="#666">[image]</text>`);
                break;
        }
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${viewWidth}" height="${viewHeight}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${bgColor}"/>
  <g transform="scale(1)">
    ${shapes.join('\n    ')}
  </g>
</svg>`;

    return svg;
}

// Keyword descriptions
const KEYWORD_DESCRIPTIONS: Record<string, string> = {
    'TITLE': 'Document title shown in exports',
    'AUTHOR': 'Author name(s) for the document',
    'DATE': 'Document date',
    'EMAIL': 'Author email address',
    'LANGUAGE': 'Document language (e.g., en, de, fr)',
    'OPTIONS': 'Export and display options',
    'PROPERTY': 'Document-wide property setting',
    'SETUPFILE': 'Include settings from another file',
    'INCLUDE': 'Include content from another file',
    'BIBLIOGRAPHY': 'Path to bibliography file(s)',
    'LATEX_CLASS': 'LaTeX document class for export',
    'LATEX_CLASS_OPTIONS': 'Options for LaTeX document class',
    'LATEX_HEADER': 'Additional LaTeX header content',
    'HTML_HEAD': 'HTML head content for export',
    'HTML_HEAD_EXTRA': 'Additional HTML head content',
    'STARTUP': 'Buffer startup options (folded, overview, etc.)',
    'FILETAGS': 'Tags inherited by all entries',
    'ARCHIVE': 'Archive file location',
    'CATEGORY': 'Default category for entries',
    'COLUMNS': 'Column view format specification',
    'CONSTANTS': 'Constants for table formulas',
    'LINK': 'Link abbreviation definition',
    'PRIORITIES': 'Priority range (highest, lowest, default)',
    'SEQ_TODO': 'Sequential TODO workflow states',
    'TYP_TODO': 'Type-based TODO states',
    'TODO': 'TODO keyword sequence',
    'TAGS': 'Tags and tag groups',
    'EXPORT_FILE_NAME': 'Override default export filename',
    'EXPORT_SELECT_TAGS': 'Only export entries with these tags',
    'EXPORT_EXCLUDE_TAGS': 'Exclude entries with these tags from export',
    'BEGIN_SRC': 'Source code block',
    'END_SRC': 'End of source code block',
    'BEGIN_EXAMPLE': 'Example block (fixed-width, no markup)',
    'END_EXAMPLE': 'End of example block',
    'BEGIN_QUOTE': 'Quotation block',
    'END_QUOTE': 'End of quote block',
    'BEGIN_CENTER': 'Centered text block',
    'END_CENTER': 'End of center block',
    'BEGIN_VERSE': 'Verse block (preserves line breaks)',
    'END_VERSE': 'End of verse block',
    'BEGIN_COMMENT': 'Comment block (not exported)',
    'END_COMMENT': 'End of comment block',
    'BEGIN_EXPORT': 'Raw export block for specific backend',
    'END_EXPORT': 'End of export block',
    'RESULTS': 'Results of code block execution',
    'NAME': 'Name for reference (blocks, tables, etc.)',
    'CAPTION': 'Caption for figures, tables, listings',
    'ATTR_HTML': 'HTML export attributes',
    'ATTR_LATEX': 'LaTeX export attributes',
    'CALL': 'Call a named code block',
    'HEADER': 'Default header arguments',
    'TBLFM': 'Table formula',
};

// Header argument descriptions
const HEADER_ARG_DESCRIPTIONS: Record<string, string> = {
    ':results': 'How to handle results (value, output, silent, replace, etc.)',
    ':exports': 'What to export (code, results, both, none)',
    ':session': 'Session name for persistent state',
    ':var': 'Variable definitions for the block',
    ':dir': 'Working directory for execution',
    ':file': 'Output file for results',
    ':output-dir': 'Directory for output files',
    ':cache': 'Cache results based on input',
    ':eval': 'When to evaluate (yes, no, never-export, etc.)',
    ':noweb': 'Noweb-style reference expansion',
    ':tangle': 'Extract code to file (literate programming)',
    ':mkdirp': 'Create parent directories if needed',
    ':comments': 'Include comments in tangled output',
    ':padline': 'Add blank line before tangled code',
    ':no-expand': 'Do not expand noweb references',
    ':hlines': 'How to handle horizontal lines in tables',
    ':colnames': 'Use first row as column names',
    ':rownames': 'Use first column as row names',
    ':shebang': 'Shebang line for tangled scripts',
    ':wrap': 'Wrap results in a block',
    ':post': 'Post-process results with another block',
};

// Link type descriptions
const LINK_TYPE_DESCRIPTIONS: Record<string, string> = {
    'file': 'Link to a local file',
    'http': 'HTTP web link',
    'https': 'HTTPS secure web link',
    'ftp': 'FTP file link',
    'mailto': 'Email link',
    'doi': 'Digital Object Identifier (academic papers)',
    'cite': 'Citation link to bibliography entry',
    'id': 'Link to entry by ID property',
    'shell': 'Shell command link',
    'elisp': 'Emacs Lisp code link',
    'info': 'Info documentation link',
    'help': 'Emacs help link',
    'news': 'Usenet news link',
    'bbdb': 'Big Brother Database link',
    'irc': 'IRC channel link',
    'rmail': 'Rmail message link',
    'mhe': 'MH-E message link',
    'gnus': 'Gnus article link',
    'attachment': 'Attachment link',
    'docview': 'Document viewer link',
};

// Day name for timestamp display - use shared constants
const DAY_NAMES = DAY_NAMES_SHORT;
const MONTH_NAMES = MONTH_NAMES_SHORT;

/**
 * Org-mode hover provider
 */
export class OrgHoverProvider implements vscode.HoverProvider {
    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        const line = document.lineAt(position.line).text;

        // Check for various hover contexts
        let hover: vscode.Hover | null = null;

        // Excalidraw link hover (show drawing preview) - check before image hover
        hover = this.getExcalidrawHover(line, position, document);
        if (hover) return hover;

        // Image link hover (show image preview) - check first for better UX
        hover = this.getImageLinkHover(line, position, document);
        if (hover) return hover;

        // Entity hover (backslash entities like \alpha)
        hover = this.getEntityHover(line, position);
        if (hover) return hover;

        // LaTeX equation hover (shows rendered equation preview)
        hover = await this.getLatexEquationHover(document, position);
        if (hover) return hover;

        // Keyword hover (#+KEYWORD:)
        hover = this.getKeywordHover(line, position);
        if (hover) return hover;

        // Header argument hover (:results, :exports, etc.)
        hover = this.getHeaderArgHover(line, position);
        if (hover) return hover;

        // Link type hover ([[type:...]])
        hover = this.getLinkTypeHover(line, position);
        if (hover) return hover;

        // Timestamp hover
        hover = this.getTimestampHover(line, position);
        if (hover) return hover;

        // Diary sexp hover (%%(diary-anniversary ...) etc.)
        hover = this.getDiarySexpHover(line, position);
        if (hover) return hover;

        // Source block language hover
        hover = this.getSourceBlockHover(line, position);
        if (hover) return hover;

        // Property hover
        hover = this.getPropertyHover(line, position);
        if (hover) return hover;

        // Priority hover
        hover = this.getPriorityHover(line, position);
        if (hover) return hover;

        // Tag hover
        hover = this.getTagHover(line, position);
        if (hover) return hover;

        // Footnote reference hover
        hover = this.getFootnoteHover(line, position, document);
        if (hover) return hover;

        // Heading hover (shows clock time info)
        hover = this.getHeadingClockHover(line, position, document);
        if (hover) return hover;

        return null;
    }

    /**
     * Get hover for org entities
     */
    private getEntityHover(line: string, position: vscode.Position): vscode.Hover | null {
        // Find entity at position: \entityname
        const entityPattern = /\\([a-zA-Z]+)/g;
        let match;

        while ((match = entityPattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = match.index + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const entityName = match[1];
                const entity = ENTITY_MAP.get(entityName);

                if (entity) {
                    const markdown = new vscode.MarkdownString();
                    markdown.appendMarkdown(`## ${entity.utf8}\n\n`);
                    markdown.appendMarkdown(`**Entity:** \`\\${entityName}\`\n\n`);
                    markdown.appendMarkdown(`| Format | Output |\n|--------|--------|\n`);
                    markdown.appendMarkdown(`| UTF-8 | ${entity.utf8} |\n`);
                    markdown.appendMarkdown(`| LaTeX | \`${entity.latex}\` |\n`);
                    markdown.appendMarkdown(`| HTML | \`${entity.html}\` |\n`);

                    const range = new vscode.Range(
                        position.line, startCol,
                        position.line, endCol
                    );
                    return new vscode.Hover(markdown, range);
                }
            }
        }

        return null;
    }

    /**
     * Get hover for image links - shows image preview
     */
    private getImageLinkHover(
        line: string,
        position: vscode.Position,
        document: vscode.TextDocument
    ): vscode.Hover | null {
        // Match org links: [[path]] or [[path][description]] or [[file:path]]
        const linkPattern = /\[\[(?:file:)?([^\]]+?)(?:\]\[([^\]]*))?\]\]/g;
        let match;

        while ((match = linkPattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = match.index + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                let imagePath = match[1];
                const description = match[2];

                // Check if this is an image file
                const ext = path.extname(imagePath).toLowerCase();
                if (!IMAGE_EXTENSIONS.has(ext)) {
                    return null;
                }

                // Resolve the image path
                const documentDir = path.dirname(document.uri.fsPath);
                let absolutePath: string;

                if (path.isAbsolute(imagePath)) {
                    absolutePath = imagePath;
                } else {
                    // Handle ./path or just path
                    absolutePath = path.resolve(documentDir, imagePath);
                }

                // Check if file exists
                if (!fs.existsSync(absolutePath)) {
                    const markdown = new vscode.MarkdownString();
                    markdown.appendMarkdown(`**Image not found:**\n\n\`${imagePath}\`\n\n`);
                    markdown.appendMarkdown(`Expected at: \`${absolutePath}\``);

                    const range = new vscode.Range(
                        position.line, startCol,
                        position.line, endCol
                    );
                    return new vscode.Hover(markdown, range);
                }

                // Create hover with image preview
                const markdown = new vscode.MarkdownString();
                markdown.isTrusted = true;
                markdown.supportHtml = true;

                // Get file size for info
                const stats = fs.statSync(absolutePath);
                const sizeKB = (stats.size / 1024).toFixed(1);

                // Use file URI for the image
                const imageUri = vscode.Uri.file(absolutePath);

                // Add image with max dimensions for readability
                markdown.appendMarkdown(`**${description || path.basename(imagePath)}**\n\n`);
                markdown.appendMarkdown(`<img src="${imageUri.toString()}" width="400" />\n\n`);
                markdown.appendMarkdown(`*${path.basename(imagePath)}* (${sizeKB} KB)`);

                const range = new vscode.Range(
                    position.line, startCol,
                    position.line, endCol
                );
                return new vscode.Hover(markdown, range);
            }
        }

        // Also check for bare image links (just a path to an image file)
        const bareImagePattern = /\[\[([^\]]+\.(png|jpe?g|gif|svg|webp|bmp|ico|tiff?))\]\]/gi;
        bareImagePattern.lastIndex = 0;

        while ((match = bareImagePattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = match.index + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const imagePath = match[1];
                const documentDir = path.dirname(document.uri.fsPath);
                const absolutePath = path.isAbsolute(imagePath)
                    ? imagePath
                    : path.resolve(documentDir, imagePath);

                if (!fs.existsSync(absolutePath)) {
                    return null;
                }

                const markdown = new vscode.MarkdownString();
                markdown.isTrusted = true;
                markdown.supportHtml = true;

                const stats = fs.statSync(absolutePath);
                const sizeKB = (stats.size / 1024).toFixed(1);
                const imageUri = vscode.Uri.file(absolutePath);

                markdown.appendMarkdown(`**${path.basename(imagePath)}**\n\n`);
                markdown.appendMarkdown(`<img src="${imageUri.toString()}" width="400" />\n\n`);
                markdown.appendMarkdown(`*${sizeKB} KB*`);

                const range = new vscode.Range(
                    position.line, startCol,
                    position.line, endCol
                );
                return new vscode.Hover(markdown, range);
            }
        }

        return null;
    }

    /**
     * Get hover for Excalidraw links - shows drawing preview
     */
    private getExcalidrawHover(
        line: string,
        position: vscode.Position,
        document: vscode.TextDocument
    ): vscode.Hover | null {
        // Match org links: [[path]] or [[path][description]] or [[file:path]]
        const linkPattern = /\[\[(?:file:)?([^\]]+?)(?:\]\[([^\]]*))?\]\]/g;
        let match;

        while ((match = linkPattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = match.index + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const filePath = match[1];
                const description = match[2];

                // Check if this is an Excalidraw file
                if (!isExcalidrawFile(filePath)) {
                    return null;
                }

                // Resolve the file path
                const documentDir = path.dirname(document.uri.fsPath);
                let absolutePath: string;

                if (path.isAbsolute(filePath)) {
                    absolutePath = filePath;
                } else {
                    absolutePath = path.resolve(documentDir, filePath);
                }

                const markdown = new vscode.MarkdownString();
                markdown.isTrusted = true;
                markdown.supportHtml = true;

                const fileName = path.basename(filePath);
                markdown.appendMarkdown(`**Excalidraw Drawing:** ${description || fileName}\n\n`);

                // Check if file exists
                if (!fs.existsSync(absolutePath)) {
                    markdown.appendMarkdown(`*File not found:* \`${absolutePath}\`\n\n`);
                    markdown.appendMarkdown(`Click to create a new drawing.`);

                    const range = new vscode.Range(
                        position.line, startCol,
                        position.line, endCol
                    );
                    return new vscode.Hover(markdown, range);
                }

                // Get file stats
                const stats = fs.statSync(absolutePath);
                const sizeKB = (stats.size / 1024).toFixed(1);
                const modifiedDate = stats.mtime.toLocaleDateString();

                // For .excalidraw.svg and .excalidraw.png, show the image directly
                const lowerPath = absolutePath.toLowerCase();
                if (lowerPath.endsWith('.excalidraw.svg') || lowerPath.endsWith('.excalidraw.png')) {
                    const imageUri = vscode.Uri.file(absolutePath);
                    markdown.appendMarkdown(`<img src="${imageUri.toString()}" width="400" />\n\n`);
                    markdown.appendMarkdown(`*${sizeKB} KB • Modified: ${modifiedDate}*\n\n`);
                    markdown.appendMarkdown(`Click to edit in Excalidraw`);
                } else {
                    // For .excalidraw or .excalidraw.json, try to find a companion export
                    const possibleExports = [
                        absolutePath + '.svg',
                        absolutePath + '.png',
                        absolutePath.replace(/\.excalidraw(\.json)?$/, '.excalidraw.svg'),
                        absolutePath.replace(/\.excalidraw(\.json)?$/, '.excalidraw.png'),
                    ];

                    let foundExport = false;
                    for (const exportPath of possibleExports) {
                        if (fs.existsSync(exportPath)) {
                            const imageUri = vscode.Uri.file(exportPath);
                            markdown.appendMarkdown(`<img src="${imageUri.toString()}" width="400" />\n\n`);
                            foundExport = true;
                            break;
                        }
                    }

                    // Try to read and parse the JSON to show element count and generate preview
                    try {
                        const content = fs.readFileSync(absolutePath, 'utf-8');
                        const data = JSON.parse(content);
                        const elementCount = Array.isArray(data.elements) ? data.elements.length : 0;

                        if (!foundExport) {
                            // Generate SVG preview from JSON
                            const svgPreview = generateExcalidrawPreviewSvg(data);
                            if (svgPreview) {
                                const svgDataUri = `data:image/svg+xml;base64,${Buffer.from(svgPreview).toString('base64')}`;
                                markdown.appendMarkdown(`<img src="${svgDataUri}" width="400" />\n\n`);
                            } else if (elementCount === 0) {
                                markdown.appendMarkdown(`*Empty drawing*\n\n`);
                            } else {
                                markdown.appendMarkdown(`*Preview not available*\n\n`);
                            }
                        }

                        markdown.appendMarkdown(`**Elements:** ${elementCount}\n\n`);
                    } catch {
                        if (!foundExport) {
                            markdown.appendMarkdown(`*Preview not available*\n\n`);
                        }
                    }

                    markdown.appendMarkdown(`*${sizeKB} KB • Modified: ${modifiedDate}*\n\n`);
                    markdown.appendMarkdown(`Click to edit in Excalidraw`);
                }

                const range = new vscode.Range(
                    position.line, startCol,
                    position.line, endCol
                );
                return new vscode.Hover(markdown, range);
            }
        }

        return null;
    }

    /**
     * Get hover for keywords (#+KEYWORD:)
     */
    private getKeywordHover(line: string, position: vscode.Position): vscode.Hover | null {
        const keywordMatch = line.match(/^(\s*)#\+([A-Z_]+)(\[.*?\])?:/i);
        if (!keywordMatch) return null;

        const indent = keywordMatch[1].length;
        const keyword = keywordMatch[2].toUpperCase();
        const startCol = indent + 2; // After #+
        const endCol = startCol + keyword.length;

        if (position.character >= startCol && position.character <= endCol) {
            const description = KEYWORD_DESCRIPTIONS[keyword];
            if (description) {
                const markdown = new vscode.MarkdownString();
                markdown.appendMarkdown(`**#+${keyword}:**\n\n`);
                markdown.appendMarkdown(description);

                const range = new vscode.Range(
                    position.line, startCol,
                    position.line, endCol
                );
                return new vscode.Hover(markdown, range);
            }
        }

        return null;
    }

    /**
     * Get hover for header arguments
     */
    private getHeaderArgHover(line: string, position: vscode.Position): vscode.Hover | null {
        // Check if this is a source block header line
        if (!line.match(/^\s*#\+(?:BEGIN_SRC|HEADER|CALL)/i)) return null;

        // Find header argument at position
        const argPattern = /(:[a-z-]+)/g;
        let match;

        while ((match = argPattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = match.index + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const arg = match[1];
                const description = HEADER_ARG_DESCRIPTIONS[arg];

                if (description) {
                    const markdown = new vscode.MarkdownString();
                    markdown.appendMarkdown(`**${arg}**\n\n`);
                    markdown.appendMarkdown(description);

                    const range = new vscode.Range(
                        position.line, startCol,
                        position.line, endCol
                    );
                    return new vscode.Hover(markdown, range);
                }
            }
        }

        return null;
    }

    /**
     * Get hover for link types
     */
    private getLinkTypeHover(line: string, position: vscode.Position): vscode.Hover | null {
        // Find link at position: [[type:path][description]] or [[type:path]]
        const linkPattern = /\[\[([a-zA-Z]+):/g;
        let match;

        while ((match = linkPattern.exec(line)) !== null) {
            const startCol = match.index + 2; // After [[
            const endCol = startCol + match[1].length;

            if (position.character >= startCol && position.character <= endCol) {
                const linkType = match[1].toLowerCase();
                const description = LINK_TYPE_DESCRIPTIONS[linkType];

                if (description) {
                    const markdown = new vscode.MarkdownString();
                    markdown.appendMarkdown(`**${linkType}:** link\n\n`);
                    markdown.appendMarkdown(description);

                    const range = new vscode.Range(
                        position.line, startCol,
                        position.line, endCol
                    );
                    return new vscode.Hover(markdown, range);
                }
            }
        }

        return null;
    }

    /**
     * Get hover for timestamps
     */
    private getTimestampHover(line: string, position: vscode.Position): vscode.Hover | null {
        // Match active timestamps <YYYY-MM-DD ...> or inactive [YYYY-MM-DD ...]
        // Supports: day name, time range, repeater (+1w, .+1d, ++1m), warning period (-3d)
        const tsPattern = /([<\[])(\d{4})-(\d{2})-(\d{2})(?:\s+([A-Za-z]+))?(?:\s+(\d{2}:\d{2})(?:-(\d{2}:\d{2}))?)?(?:\s+([+.]+\d+[hdwmy]))?(?:\s+(-\d+[hdwmy]))?([>\]])/g;
        let match;

        while ((match = tsPattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = match.index + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const isActive = match[1] === '<';
                const year = parseInt(match[2], 10);
                const month = parseInt(match[3], 10);
                const day = parseInt(match[4], 10);
                const dayName = match[5];
                const startTime = match[6];
                const endTime = match[7];
                const repeater = match[8]; // e.g., +1w, .+1d, ++1m
                const warningPeriod = match[9]; // e.g., -3d, -7d

                const date = new Date(year, month - 1, day);
                const computedDayName = DAY_NAMES[date.getDay()];
                const monthName = MONTH_NAMES[month - 1];

                const markdown = new vscode.MarkdownString();
                markdown.appendMarkdown(`## 📅 ${monthName} ${day}, ${year}\n\n`);
                markdown.appendMarkdown(`**Type:** ${isActive ? 'Active' : 'Inactive'} timestamp\n\n`);
                markdown.appendMarkdown(`**Day:** ${computedDayName}\n\n`);

                if (startTime) {
                    markdown.appendMarkdown(`**Time:** ${startTime}`);
                    if (endTime) {
                        markdown.appendMarkdown(` - ${endTime}`);
                    }
                    markdown.appendMarkdown('\n\n');
                }

                if (repeater) {
                    const repMatch = repeater.match(/^([+.]+)(\d+)([hdwmy])$/);
                    if (repMatch) {
                        const units: Record<string, string> = {
                            'h': 'hour(s)',
                            'd': 'day(s)',
                            'w': 'week(s)',
                            'm': 'month(s)',
                            'y': 'year(s)',
                        };
                        const repeaterTypes: Record<string, string> = {
                            '+': 'Cumulative repeater',
                            '++': 'Catch-up repeater',
                            '.+': 'Restart repeater',
                        };
                        markdown.appendMarkdown(`**Repeater:** ${repeaterTypes[repMatch[1]] || 'Repeater'} every ${repMatch[2]} ${units[repMatch[3]] || repMatch[3]}\n\n`);
                    }
                }

                if (warningPeriod) {
                    const warnMatch = warningPeriod.match(/^-(\d+)([hdwmy])$/);
                    if (warnMatch) {
                        const units: Record<string, string> = {
                            'h': 'hour(s)',
                            'd': 'day(s)',
                            'w': 'week(s)',
                            'm': 'month(s)',
                            'y': 'year(s)',
                        };
                        markdown.appendMarkdown(`**Warning:** ${warnMatch[1]} ${units[warnMatch[2]] || warnMatch[2]} before\n\n`);
                    }
                }

                // Calculate relative date
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const targetDate = new Date(year, month - 1, day);
                targetDate.setHours(0, 0, 0, 0);
                const diffTime = targetDate.getTime() - today.getTime();
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays === 0) {
                    markdown.appendMarkdown('📌 **Today**');
                } else if (diffDays === 1) {
                    markdown.appendMarkdown('📌 **Tomorrow**');
                } else if (diffDays === -1) {
                    markdown.appendMarkdown('📌 **Yesterday**');
                } else if (diffDays > 0) {
                    markdown.appendMarkdown(`📌 **In ${diffDays} days**`);
                } else {
                    markdown.appendMarkdown(`📌 **${Math.abs(diffDays)} days ago**`);
                }

                const range = new vscode.Range(
                    position.line, startCol,
                    position.line, endCol
                );
                return new vscode.Hover(markdown, range);
            }
        }

        return null;
    }

    /**
     * Get hover for diary sexp expressions
     * Shows human-readable interpretation and next occurrence
     */
    private getDiarySexpHover(line: string, position: vscode.Position): vscode.Hover | null {
        // Match diary sexp: %%(function args) optional-description
        const sexpPattern = /^%%(\([^)]+\))(?:\s+(.*))?$/;
        const match = line.match(sexpPattern);
        if (!match) return null;

        const sexpEnd = 2 + match[1].length; // 2 for %%, then the sexp length

        // Only show hover when over the sexp portion (including %%)
        if (position.character > sexpEnd) return null;

        const sexp = match[1]; // e.g., "(diary-anniversary 1 22 2010)"
        const description = match[2]?.trim(); // e.g., "Wedding Anniversary"

        const parsed = parseDiarySexp(sexp);
        if (!parsed) return null;

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        // Header with event description if available
        markdown.appendMarkdown(`## 📅 Diary Sexp\n\n`);
        if (description) {
            markdown.appendMarkdown(`**Event:** ${description}\n\n`);
        }
        markdown.appendMarkdown(`**Type:** \`${parsed.fn}\`\n\n`);

        // Human-readable interpretation based on function type
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const ordinals = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

        switch (parsed.fn) {
            case 'diary-anniversary': {
                const [month, day, year] = parsed.args as number[];
                if (typeof month === 'number' && typeof day === 'number' && typeof year === 'number') {
                    markdown.appendMarkdown(`**Original date:** ${monthNames[month - 1]} ${day}, ${year}\n\n`);
                    markdown.appendMarkdown(`**Recurs:** Every year on ${monthNames[month - 1]} ${day}\n\n`);
                }
                break;
            }
            case 'diary-float': {
                const [month, dayname, n] = parsed.args;
                if (typeof dayname === 'number' && typeof n === 'number') {
                    let ord: string;
                    if (n > 0 && n <= 5) {
                        ord = ordinals[n];
                    } else if (n === -1) {
                        ord = 'last';
                    } else if (n < -1) {
                        ord = `${-n}${-n === 2 ? 'nd' : -n === 3 ? 'rd' : 'th'}-to-last`;
                    } else {
                        ord = `${n}th`;
                    }
                    const monthStr = month !== null && typeof month === 'number' ? monthNames[month - 1] : 'every month';
                    markdown.appendMarkdown(`**Pattern:** ${ord} ${dayNames[dayname]} of ${monthStr}\n\n`);
                }
                break;
            }
            case 'diary-cyclic': {
                const [n, month, day, year] = parsed.args as number[];
                if (typeof n === 'number' && typeof month === 'number' && typeof day === 'number' && typeof year === 'number') {
                    markdown.appendMarkdown(`**Start date:** ${monthNames[month - 1]} ${day}, ${year}\n\n`);
                    markdown.appendMarkdown(`**Recurs:** Every ${n} day${n === 1 ? '' : 's'}\n\n`);
                }
                break;
            }
            case 'diary-block': {
                const [m1, d1, y1, m2, d2, y2] = parsed.args as number[];
                if (typeof m1 === 'number' && typeof d1 === 'number' && typeof y1 === 'number' &&
                    typeof m2 === 'number' && typeof d2 === 'number' && typeof y2 === 'number') {
                    markdown.appendMarkdown(`**From:** ${monthNames[m1 - 1]} ${d1}, ${y1}\n\n`);
                    markdown.appendMarkdown(`**To:** ${monthNames[m2 - 1]} ${d2}, ${y2}\n\n`);
                }
                break;
            }
            case 'diary-date': {
                const [month, day, year] = parsed.args;
                const parts: string[] = [];
                if (month !== null && typeof month === 'number') parts.push(`${monthNames[month - 1]}`);
                if (day !== null && typeof day === 'number') parts.push(`day ${day}`);
                if (year !== null && typeof year === 'number') parts.push(`${year}`);
                if (parts.length > 0) {
                    markdown.appendMarkdown(`**Matches:** ${parts.join(', ')}\n\n`);
                } else {
                    markdown.appendMarkdown(`**Matches:** Any date\n\n`);
                }
                break;
            }
            case 'org-class': {
                const [y1, m1, d1, y2, m2, d2, daynum] = parsed.args as number[];
                if (typeof y1 === 'number' && typeof m1 === 'number' && typeof d1 === 'number' &&
                    typeof y2 === 'number' && typeof m2 === 'number' && typeof d2 === 'number' &&
                    typeof daynum === 'number') {
                    markdown.appendMarkdown(`**Day:** ${dayNames[daynum]}s\n\n`);
                    markdown.appendMarkdown(`**Period:** ${monthNames[m1 - 1]} ${d1}, ${y1} - ${monthNames[m2 - 1]} ${d2}, ${y2}\n\n`);
                }
                break;
            }
        }

        // Calculate next occurrence
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const futureDate = new Date();
        futureDate.setFullYear(today.getFullYear() + 2); // Look 2 years ahead

        const matches = getDiarySexpDates(sexp, today, futureDate);
        if (matches.length > 0) {
            const next = matches[0];
            const diffTime = next.date.getTime() - today.getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

            markdown.appendMarkdown(`---\n\n`);
            markdown.appendMarkdown(`**Next occurrence:** ${next.date.toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            })}\n\n`);

            if (diffDays === 0) {
                markdown.appendMarkdown(`📌 **Today!**`);
            } else if (diffDays === 1) {
                markdown.appendMarkdown(`📌 **Tomorrow**`);
            } else {
                markdown.appendMarkdown(`📌 **In ${diffDays} days**`);
            }

            // For anniversary, show how many years it will be
            if (parsed.fn === 'diary-anniversary' && next.result.years !== undefined) {
                markdown.appendMarkdown(`\n\n🎂 Will be **${next.result.years} year${next.result.years === 1 ? '' : 's'}**`);
            }
        }

        return new vscode.Hover(markdown, new vscode.Range(
            position.line, 0,
            position.line, sexpEnd
        ));
    }

    /**
     * Get hover for source block headers
     */
    private getSourceBlockHover(line: string, position: vscode.Position): vscode.Hover | null {
        const srcMatch = line.match(/^(\s*)#\+BEGIN_SRC\s+([a-zA-Z0-9_+-]+)/i);
        if (!srcMatch) return null;

        const indent = srcMatch[1].length;
        const langStart = indent + '#+BEGIN_SRC '.length;
        const language = srcMatch[2];
        const langEnd = langStart + language.length;

        if (position.character >= langStart && position.character <= langEnd) {
            const langInfo = this.getLanguageInfo(language);

            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`## ${langInfo.name}\n\n`);
            markdown.appendMarkdown(`**Language:** \`${language}\`\n\n`);
            if (langInfo.description) {
                markdown.appendMarkdown(langInfo.description + '\n\n');
            }
            if (langInfo.fileExtension) {
                markdown.appendMarkdown(`**File extension:** \`.${langInfo.fileExtension}\`\n\n`);
            }

            const range = new vscode.Range(
                position.line, langStart,
                position.line, langEnd
            );
            return new vscode.Hover(markdown, range);
        }

        return null;
    }

    /**
     * Get language information
     */
    private getLanguageInfo(language: string): { name: string; description?: string; fileExtension?: string } {
        const languages: Record<string, { name: string; description?: string; fileExtension?: string }> = {
            'python': { name: 'Python', description: 'High-level programming language', fileExtension: 'py' },
            'bash': { name: 'Bash', description: 'Unix shell and command language', fileExtension: 'sh' },
            'sh': { name: 'Shell', description: 'Shell script', fileExtension: 'sh' },
            'shell': { name: 'Shell', description: 'Shell script', fileExtension: 'sh' },
            'emacs-lisp': { name: 'Emacs Lisp', description: 'Dialect of Lisp for Emacs', fileExtension: 'el' },
            'elisp': { name: 'Emacs Lisp', description: 'Dialect of Lisp for Emacs', fileExtension: 'el' },
            'javascript': { name: 'JavaScript', description: 'Web scripting language', fileExtension: 'js' },
            'js': { name: 'JavaScript', description: 'Web scripting language', fileExtension: 'js' },
            'typescript': { name: 'TypeScript', description: 'Typed superset of JavaScript', fileExtension: 'ts' },
            'ts': { name: 'TypeScript', description: 'Typed superset of JavaScript', fileExtension: 'ts' },
            'json': { name: 'JSON', description: 'JavaScript Object Notation', fileExtension: 'json' },
            'yaml': { name: 'YAML', description: 'YAML Ain\'t Markup Language', fileExtension: 'yaml' },
            'sql': { name: 'SQL', description: 'Structured Query Language', fileExtension: 'sql' },
            'latex': { name: 'LaTeX', description: 'Document preparation system', fileExtension: 'tex' },
            'html': { name: 'HTML', description: 'HyperText Markup Language', fileExtension: 'html' },
            'css': { name: 'CSS', description: 'Cascading Style Sheets', fileExtension: 'css' },
            'xml': { name: 'XML', description: 'Extensible Markup Language', fileExtension: 'xml' },
            'markdown': { name: 'Markdown', description: 'Lightweight markup language', fileExtension: 'md' },
            'md': { name: 'Markdown', description: 'Lightweight markup language', fileExtension: 'md' },
            'c': { name: 'C', description: 'General-purpose programming language', fileExtension: 'c' },
            'cpp': { name: 'C++', description: 'Object-oriented extension of C', fileExtension: 'cpp' },
            'c++': { name: 'C++', description: 'Object-oriented extension of C', fileExtension: 'cpp' },
            'java': { name: 'Java', description: 'Object-oriented programming language', fileExtension: 'java' },
            'rust': { name: 'Rust', description: 'Systems programming language', fileExtension: 'rs' },
            'go': { name: 'Go', description: 'Statically typed, compiled language', fileExtension: 'go' },
            'golang': { name: 'Go', description: 'Statically typed, compiled language', fileExtension: 'go' },
            'ruby': { name: 'Ruby', description: 'Dynamic, object-oriented language', fileExtension: 'rb' },
            'perl': { name: 'Perl', description: 'High-level, general-purpose language', fileExtension: 'pl' },
            'r': { name: 'R', description: 'Statistical computing language', fileExtension: 'r' },
            'R': { name: 'R', description: 'Statistical computing language', fileExtension: 'r' },
            'julia': { name: 'Julia', description: 'High-performance computing language', fileExtension: 'jl' },
            'haskell': { name: 'Haskell', description: 'Purely functional language', fileExtension: 'hs' },
            'clojure': { name: 'Clojure', description: 'Lisp dialect for JVM', fileExtension: 'clj' },
            'scala': { name: 'Scala', description: 'Object-functional language for JVM', fileExtension: 'scala' },
            'kotlin': { name: 'Kotlin', description: 'Modern language for JVM/Android', fileExtension: 'kt' },
            'swift': { name: 'Swift', description: 'Apple\'s programming language', fileExtension: 'swift' },
            'objc': { name: 'Objective-C', description: 'Object-oriented C', fileExtension: 'm' },
            'objective-c': { name: 'Objective-C', description: 'Object-oriented C', fileExtension: 'm' },
            'php': { name: 'PHP', description: 'Server-side scripting language', fileExtension: 'php' },
            'lua': { name: 'Lua', description: 'Lightweight scripting language', fileExtension: 'lua' },
            'awk': { name: 'AWK', description: 'Text processing language', fileExtension: 'awk' },
            'sed': { name: 'Sed', description: 'Stream editor', fileExtension: 'sed' },
            'gnuplot': { name: 'Gnuplot', description: 'Plotting utility', fileExtension: 'gp' },
            'dot': { name: 'Graphviz DOT', description: 'Graph description language', fileExtension: 'dot' },
            'plantuml': { name: 'PlantUML', description: 'UML diagram generator', fileExtension: 'puml' },
            'ditaa': { name: 'Ditaa', description: 'ASCII art diagram generator', fileExtension: 'ditaa' },
            'mermaid': { name: 'Mermaid', description: 'Diagram and chart tool', fileExtension: 'mmd' },
        };

        return languages[language.toLowerCase()] || { name: language };
    }

    /**
     * Get hover for property names
     */
    private getPropertyHover(line: string, position: vscode.Position): vscode.Hover | null {
        const propMatch = line.match(/^(\s*):([A-Za-z_][A-Za-z0-9_-]*):/);
        if (!propMatch) return null;

        const indent = propMatch[1].length;
        const propName = propMatch[2];
        const startCol = indent + 1;
        const endCol = startCol + propName.length;

        if (position.character >= startCol && position.character <= endCol) {
            const descriptions: Record<string, string> = {
                'PROPERTIES': 'Property drawer start',
                'END': 'Drawer end',
                'CUSTOM_ID': 'Custom ID for linking',
                'ID': 'Unique identifier (UUID)',
                'CATEGORY': 'Category for agenda views',
                'EFFORT': 'Estimated time to complete',
                'STYLE': 'Habit style (habit)',
                'COLUMNS': 'Column view format for this subtree',
                'COOKIE_DATA': 'How to calculate statistics cookies',
                'LOG_INTO_DRAWER': 'Log notes into a drawer',
                'LOGGING': 'Logging settings',
                'ARCHIVE': 'Archive file for this entry',
                'ORDERED': 'Enforce sequential task completion',
                'NOBLOCKING': 'Don\'t block parent completion',
                'VISIBILITY': 'Initial visibility state',
                'EXPORT_FILE_NAME': 'Export filename override',
                'ATTACH_DIR': 'Directory for attachments',
                'ATTACH_DIR_INHERIT': 'Inherit attachment directory',
                'CREATED': 'Creation timestamp',
                'LAST_MODIFIED': 'Last modification timestamp',
            };

            const description = descriptions[propName.toUpperCase()];
            if (description || propName !== 'PROPERTIES' && propName !== 'END') {
                const markdown = new vscode.MarkdownString();
                markdown.appendMarkdown(`**:${propName}:**\n\n`);
                markdown.appendMarkdown(description || 'Custom property');

                const range = new vscode.Range(
                    position.line, startCol,
                    position.line, endCol
                );
                return new vscode.Hover(markdown, range);
            }
        }

        return null;
    }

    /**
     * Get hover for priority cookies
     */
    private getPriorityHover(line: string, position: vscode.Position): vscode.Hover | null {
        // Match [#A], [#B], [#C] priority cookies in headlines
        const priorityMatch = line.match(/^\*+\s+(?:TODO|DONE|NEXT|WAITING|HOLD|SOMEDAY|CANCELLED)?\s*(\[#([A-Z])\])/);
        if (!priorityMatch) return null;

        const fullMatch = priorityMatch[1];
        const priority = priorityMatch[2];
        const startCol = line.indexOf(fullMatch);
        const endCol = startCol + fullMatch.length;

        if (position.character >= startCol && position.character <= endCol) {
            const priorities: Record<string, { name: string; description: string }> = {
                'A': { name: 'High Priority', description: 'Urgent and important tasks' },
                'B': { name: 'Medium Priority', description: 'Important but not urgent' },
                'C': { name: 'Low Priority', description: 'Nice to have, can wait' },
            };

            const info = priorities[priority] || { name: `Priority ${priority}`, description: 'Custom priority level' };

            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`## 🏷️ ${info.name}\n\n`);
            markdown.appendMarkdown(info.description);

            const range = new vscode.Range(
                position.line, startCol,
                position.line, endCol
            );
            return new vscode.Hover(markdown, range);
        }

        return null;
    }

    /**
     * Get hover for tags
     */
    private getTagHover(line: string, position: vscode.Position): vscode.Hover | null {
        // Match tags at end of headline :tag1:tag2:
        if (!line.match(/^\*+\s+/)) return null;

        const tagMatch = line.match(/:([a-zA-Z0-9_@#%]+):(?=\s*$|[a-zA-Z0-9_@#%]+:)/g);
        if (!tagMatch) return null;

        // Find tag at position
        let searchPos = 0;
        for (const fullTagMatch of tagMatch) {
            const tagStart = line.indexOf(fullTagMatch, searchPos);
            const tagEnd = tagStart + fullTagMatch.length;
            searchPos = tagEnd;

            if (position.character >= tagStart && position.character <= tagEnd) {
                const tag = fullTagMatch.replace(/:/g, '');

                const specialTags: Record<string, string> = {
                    'ARCHIVE': 'Entry is archived',
                    'noexport': 'Entry will not be exported',
                    'export': 'Entry will be exported',
                    'work': 'Work-related entry',
                    'personal': 'Personal entry',
                    'urgent': 'Urgent task',
                    'important': 'Important task',
                    'project': 'Project entry',
                    'review': 'Needs review',
                };

                const markdown = new vscode.MarkdownString();
                markdown.appendMarkdown(`## 🏷️ :${tag}:\n\n`);
                markdown.appendMarkdown(specialTags[tag] || 'User-defined tag');

                const range = new vscode.Range(
                    position.line, tagStart,
                    position.line, tagEnd
                );
                return new vscode.Hover(markdown, range);
            }
        }

        return null;
    }

    /**
     * Get hover for footnote references - shows definition content
     */
    private getFootnoteHover(
        line: string,
        position: vscode.Position,
        document: vscode.TextDocument
    ): vscode.Hover | null {
        // Match footnote references: [fn:label] or [fn:label:inline definition] or [fn::anonymous]
        const footnotePattern = /\[fn:([^:\]]*)?(?::([^\]]*))?\]/g;
        let match;

        while ((match = footnotePattern.exec(line)) !== null) {
            const startCol = match.index;
            const endCol = match.index + match[0].length;

            if (position.character >= startCol && position.character <= endCol) {
                const label = match[1] || '';
                const inlineDefinition = match[2];

                const markdown = new vscode.MarkdownString();
                markdown.isTrusted = true;

                // If it's an inline footnote with definition
                if (inlineDefinition !== undefined) {
                    markdown.appendMarkdown(`## 📝 Footnote${label ? ` [${label}]` : ' (anonymous)'}\n\n`);
                    markdown.appendMarkdown(`**Inline definition:**\n\n`);
                    markdown.appendMarkdown(`> ${inlineDefinition}\n`);
                } else if (label) {
                    // Standard footnote reference - search for definition
                    const definition = this.findFootnoteDefinition(document, label);

                    markdown.appendMarkdown(`## 📝 Footnote [${label}]\n\n`);

                    if (definition) {
                        markdown.appendMarkdown(`${definition}\n`);
                    } else {
                        markdown.appendMarkdown(`*Definition not found*\n`);
                    }
                } else {
                    // Anonymous footnote without inline definition (shouldn't normally happen)
                    markdown.appendMarkdown(`## 📝 Footnote (anonymous)\n\n`);
                    markdown.appendMarkdown(`*No definition available*\n`);
                }

                const range = new vscode.Range(
                    position.line, startCol,
                    position.line, endCol
                );
                return new vscode.Hover(markdown, range);
            }
        }

        return null;
    }

    /**
     * Find footnote definition in document
     * Footnote definitions start at column 0: [fn:label] definition text...
     */
    private findFootnoteDefinition(document: vscode.TextDocument, label: string): string | null {
        const text = document.getText();
        const lines = text.split('\n');
        const labelLower = label.toLowerCase();

        // Search for footnote definition: [fn:label] at start of line
        // Definition can span multiple lines until next footnote or blank line
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Match footnote definition at start of line
            const defMatch = line.match(/^\[fn:([^\]]+)\]\s*(.*)/);
            if (defMatch && defMatch[1].toLowerCase() === labelLower) {
                // Found the definition - collect all lines until next footnote or double blank
                const definitionLines: string[] = [];
                const firstLineContent = defMatch[2].trim();
                if (firstLineContent) {
                    definitionLines.push(firstLineContent);
                }

                // Continue collecting subsequent lines
                for (let j = i + 1; j < lines.length; j++) {
                    const nextLine = lines[j];

                    // Stop at next footnote definition
                    if (nextLine.match(/^\[fn:[^\]]+\]/)) {
                        break;
                    }

                    // Stop at org heading
                    if (nextLine.match(/^\*+\s/)) {
                        break;
                    }

                    // Stop at double blank line (paragraph break)
                    if (nextLine.trim() === '' && j + 1 < lines.length && lines[j + 1].trim() === '') {
                        break;
                    }

                    // Skip single blank lines but include non-blank content
                    if (nextLine.trim() !== '') {
                        definitionLines.push(nextLine.trim());
                    } else if (definitionLines.length > 0) {
                        // Single blank line within definition - add paragraph break
                        definitionLines.push('');
                    }
                }

                return definitionLines.join('\n').trim() || null;
            }
        }

        return null;
    }

    /**
     * Get hover for headlines - shows clock time information
     */
    private getHeadingClockHover(
        line: string,
        position: vscode.Position,
        document: vscode.TextDocument
    ): vscode.Hover | null {
        // Check if this is a heading line
        const headingMatch = line.match(/^(\*+)\s+/);
        if (!headingMatch) return null;

        // Only show hover when hovering over the stars or beginning of heading
        const starsEnd = headingMatch[0].length;
        if (position.character > starsEnd + 30) return null; // Only first 30 chars after stars

        // Find clock entries for this heading
        const clockEntries = this.collectClockEntriesForHeading(document, position.line);
        const effortValue = this.getEffortForHeading(document, position.line);

        // Only show hover if there are clock entries or effort estimate
        if (clockEntries.length === 0 && !effortValue) return null;

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        // Calculate total time
        const totalMinutes = clockEntries.reduce((sum, e) => sum + (e.duration || 0), 0);

        if (totalMinutes > 0 || effortValue) {
            markdown.appendMarkdown(`## $(clock) Clocked Time\n\n`);

            if (totalMinutes > 0) {
                markdown.appendMarkdown(`**Total:** ${formatDuration(totalMinutes)} (${formatDurationLong(totalMinutes)})\n\n`);
                markdown.appendMarkdown(`**Entries:** ${clockEntries.length}\n\n`);

                // Show effort comparison if available
                if (effortValue) {
                    const effortMinutes = parseEffort(effortValue);
                    if (effortMinutes > 0) {
                        const percentage = Math.round((totalMinutes / effortMinutes) * 100);
                        const remaining = effortMinutes - totalMinutes;

                        markdown.appendMarkdown(`**Effort estimate:** ${formatDuration(effortMinutes)}\n\n`);
                        markdown.appendMarkdown(`**Progress:** ${percentage}%`);

                        if (remaining > 0) {
                            markdown.appendMarkdown(` (${formatDuration(remaining)} remaining)`);
                        } else if (remaining < 0) {
                            markdown.appendMarkdown(` (${formatDuration(Math.abs(remaining))} over)`);
                        }
                        markdown.appendMarkdown('\n\n');
                    }
                }

                // Show recent entries
                if (clockEntries.length > 0) {
                    const recent = clockEntries.slice(0, 3);
                    markdown.appendMarkdown(`---\n\n**Recent entries:**\n`);
                    for (const entry of recent) {
                        const startStr = entry.start.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                        });
                        const duration = entry.duration ? formatDuration(entry.duration) : 'running';
                        markdown.appendMarkdown(`- ${startStr}: ${duration}\n`);
                    }
                }
            } else if (effortValue) {
                // Only effort, no clocked time
                const effortMinutes = parseEffort(effortValue);
                markdown.appendMarkdown(`**Effort estimate:** ${formatDuration(effortMinutes)}\n\n`);
                markdown.appendMarkdown(`*No time clocked yet*\n`);
            }

            const range = new vscode.Range(
                position.line, 0,
                position.line, starsEnd
            );
            return new vscode.Hover(markdown, range);
        }

        return null;
    }

    /**
     * Collect clock entries for a heading
     */
    private collectClockEntriesForHeading(
        document: vscode.TextDocument,
        headingLine: number
    ): Array<{ start: Date; end?: Date; duration?: number }> {
        const entries: Array<{ start: Date; end?: Date; duration?: number }> = [];
        const headingLevel = this.getHeadingLevel(document.lineAt(headingLine).text);

        // Search for LOGBOOK drawer or direct clock entries
        let inLogbook = false;

        for (let i = headingLine + 1; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;

            // Stop at next heading at same or higher level
            const lineLevel = this.getHeadingLevel(lineText);
            if (lineLevel > 0 && lineLevel <= headingLevel) break;

            // Check for LOGBOOK drawer
            if (lineText.trim() === ':LOGBOOK:') {
                inLogbook = true;
                continue;
            }

            if (lineText.trim() === ':END:') {
                if (inLogbook) break; // Done with logbook
                continue;
            }

            // Skip other drawers
            if (lineText.trim().startsWith(':') && lineText.trim().endsWith(':')) {
                continue;
            }

            // Parse clock entries
            if (lineText.includes('CLOCK:')) {
                const entry = parseClockLine(lineText.trim());
                if (entry) {
                    entries.push(entry);
                }
            }

            // Stop at content (non-planning, non-property lines)
            if (!inLogbook && !lineText.trim().startsWith(':') &&
                !lineText.match(/^(SCHEDULED|DEADLINE|CLOSED):/) &&
                lineText.trim() !== '') {
                break;
            }
        }

        // Sort by start time (most recent first)
        entries.sort((a, b) => b.start.getTime() - a.start.getTime());

        return entries;
    }

    /**
     * Get effort value for a heading
     */
    private getEffortForHeading(document: vscode.TextDocument, headingLine: number): string | null {
        const headingLevel = this.getHeadingLevel(document.lineAt(headingLine).text);

        // Search for PROPERTIES drawer
        let inProperties = false;

        for (let i = headingLine + 1; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;

            // Stop at next heading
            const lineLevel = this.getHeadingLevel(lineText);
            if (lineLevel > 0 && lineLevel <= headingLevel) break;

            if (lineText.trim() === ':PROPERTIES:') {
                inProperties = true;
                continue;
            }

            if (lineText.trim() === ':END:') {
                if (inProperties) break;
                continue;
            }

            if (inProperties) {
                const effortMatch = lineText.match(/:Effort:\s*(.+)/i);
                if (effortMatch) {
                    return effortMatch[1].trim();
                }
            }

            // Stop at content
            if (!inProperties && !lineText.trim().startsWith(':') &&
                !lineText.match(/^(SCHEDULED|DEADLINE|CLOSED):/) &&
                lineText.trim() !== '' && !lineText.includes('CLOCK:')) {
                break;
            }
        }

        return null;
    }

    /**
     * Get heading level from line
     */
    private getHeadingLevel(line: string): number {
        const match = line.match(/^(\*+)\s/);
        return match ? match[1].length : 0;
    }

    /**
     * Get hover for LaTeX equations - shows rendered equation preview
     */
    private async getLatexEquationHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Hover | null> {
        // Check if LaTeX preview is enabled
        const config = vscode.workspace.getConfiguration('scimax');
        const latexPreviewEnabled = config.get<boolean>('latexPreview.enabled', true);

        if (!latexPreviewEnabled) {
            return null;
        }

        // Find LaTeX fragment at current position
        const fragment = findLatexFragmentAtPosition(document, position);
        if (!fragment) {
            return null;
        }

        // Create hover with rendered equation
        return createLatexHover(document, fragment, position);
    }
}

/**
 * Register the hover provider
 */
export function registerOrgHoverProvider(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: 'org', scheme: 'file' },
            new OrgHoverProvider()
        )
    );

    // Invalidate equation counter cache when document changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
            if (event.document.languageId === 'org') {
                invalidateEquationCounterCache(event.document);
            }
        })
    );
}
