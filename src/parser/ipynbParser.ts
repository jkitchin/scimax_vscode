/**
 * Jupyter notebook (.ipynb) parser
 * Extracts structure from notebook files for indexing
 */

export interface NotebookCell {
    cellType: 'markdown' | 'code' | 'raw';
    source: string;
    lineNumber: number;  // Line in the original JSON (approximate)
    index: number;       // Cell index in notebook
    language?: string;   // For code cells
    metadata?: Record<string, unknown>;
}

export interface NotebookHeading {
    level: number;
    title: string;
    lineNumber: number;
    cellIndex: number;
}

export interface NotebookCodeBlock {
    language: string;
    content: string;
    lineNumber: number;
    cellIndex: number;
}

export interface NotebookLink {
    type: string;
    target: string;
    description?: string;
    lineNumber: number;
    cellIndex: number;
}

export interface NotebookDocument {
    cells: NotebookCell[];
    headings: NotebookHeading[];
    codeBlocks: NotebookCodeBlock[];
    links: NotebookLink[];
    hashtags: string[];
    mentions: string[];
    metadata: {
        kernelName?: string;
        language?: string;
        title?: string;
    };
}

/**
 * Parse a Jupyter notebook from JSON content
 */
export function parseNotebook(content: string): NotebookDocument {
    const doc: NotebookDocument = {
        cells: [],
        headings: [],
        codeBlocks: [],
        links: [],
        hashtags: [],
        mentions: [],
        metadata: {}
    };

    try {
        const notebook = JSON.parse(content);

        // Extract metadata
        if (notebook.metadata) {
            doc.metadata.kernelName = notebook.metadata.kernelspec?.name;
            doc.metadata.language = notebook.metadata.kernelspec?.language ||
                notebook.metadata.language_info?.name;
            doc.metadata.title = notebook.metadata.title;
        }

        // Default language from metadata
        const defaultLanguage = doc.metadata.language || 'python';

        // Track line numbers approximately (JSON structure varies)
        let lineNumber = 1;
        const hashtagSet = new Set<string>();
        const mentionSet = new Set<string>();

        // Process cells
        const cells = notebook.cells || [];
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const cellType = cell.cell_type as 'markdown' | 'code' | 'raw';
            const source = Array.isArray(cell.source)
                ? cell.source.join('')
                : (cell.source || '');

            const notebookCell: NotebookCell = {
                cellType,
                source,
                lineNumber,
                index: i,
                metadata: cell.metadata
            };

            if (cellType === 'code') {
                notebookCell.language = defaultLanguage;
            }

            doc.cells.push(notebookCell);

            // Process based on cell type
            if (cellType === 'markdown') {
                // Extract headings from markdown
                const cellHeadings = extractMarkdownHeadings(source, lineNumber, i);
                doc.headings.push(...cellHeadings);

                // Extract links from markdown
                const cellLinks = extractMarkdownLinks(source, lineNumber, i);
                doc.links.push(...cellLinks);

                // Extract hashtags and mentions
                extractHashtagsAndMentions(source, hashtagSet, mentionSet);
            } else if (cellType === 'code') {
                // Add as code block
                doc.codeBlocks.push({
                    language: defaultLanguage,
                    content: source,
                    lineNumber,
                    cellIndex: i
                });

                // Extract hashtags from comments
                extractHashtagsAndMentions(source, hashtagSet, mentionSet);
            }

            // Approximate line counting (rough estimate)
            lineNumber += source.split('\n').length + 5; // +5 for JSON overhead
        }

        doc.hashtags = Array.from(hashtagSet);
        doc.mentions = Array.from(mentionSet);

    } catch (error) {
        console.error('Failed to parse notebook:', error);
    }

    return doc;
}

/**
 * Extract markdown headings from cell content
 */
function extractMarkdownHeadings(
    content: string,
    baseLineNumber: number,
    cellIndex: number
): NotebookHeading[] {
    const headings: NotebookHeading[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^(#{1,6})\s+(.*)$/);
        if (match) {
            headings.push({
                level: match[1].length,
                title: match[2].trim(),
                lineNumber: baseLineNumber + i,
                cellIndex
            });
        }
    }

    return headings;
}

/**
 * Extract links from markdown content
 */
function extractMarkdownLinks(
    content: string,
    baseLineNumber: number,
    cellIndex: number
): NotebookLink[] {
    const links: NotebookLink[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match [description](target)
        const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
        let match;
        while ((match = linkRegex.exec(line)) !== null) {
            const target = match[2];
            let type = 'internal';

            if (target.startsWith('http://') || target.startsWith('https://')) {
                type = 'http';
            } else if (target.startsWith('/') || target.startsWith('./') || target.startsWith('../')) {
                type = 'file';
            }

            links.push({
                type,
                target,
                description: match[1],
                lineNumber: baseLineNumber + i,
                cellIndex
            });
        }

        // Match bare URLs
        const urlRegex = /https?:\/\/[^\s)>\]]+/g;
        while ((match = urlRegex.exec(line)) !== null) {
            // Skip if already captured in markdown link
            if (!line.includes(`](${match[0]})`)) {
                links.push({
                    type: 'http',
                    target: match[0],
                    lineNumber: baseLineNumber + i,
                    cellIndex
                });
            }
        }
    }

    return links;
}

/**
 * Extract hashtags and @mentions from content
 */
function extractHashtagsAndMentions(
    content: string,
    hashtags: Set<string>,
    mentions: Set<string>
): void {
    // Hashtags: #word (but not ## markdown headings or #! shebangs)
    const hashtagRegex = /(?:^|[\s(])#([a-zA-Z]\w*)/g;
    let match;
    while ((match = hashtagRegex.exec(content)) !== null) {
        hashtags.add(match[1].toLowerCase());
    }

    // @mentions: @word
    const mentionRegex = /(?:^|[\s(])@([a-zA-Z]\w*)/g;
    while ((match = mentionRegex.exec(content)) !== null) {
        mentions.add(match[1].toLowerCase());
    }
}

/**
 * Get full text content from notebook for indexing
 */
export function getNotebookFullText(doc: NotebookDocument): string {
    const parts: string[] = [];

    for (const cell of doc.cells) {
        if (cell.cellType === 'markdown' || cell.cellType === 'code') {
            parts.push(cell.source);
        }
    }

    return parts.join('\n\n');
}
