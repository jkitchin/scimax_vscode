/**
 * Hover Provider for org-mode
 * Provides hover information for entities, links, blocks, timestamps, etc.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ORG_ENTITIES } from '../parser/orgEntities';

// Entity lookup map for fast access
const ENTITY_MAP = new Map<string, { utf8: string; latex: string; html: string }>();
for (const entity of ORG_ENTITIES) {
    ENTITY_MAP.set(entity.name, {
        utf8: entity.utf8,
        latex: entity.latex,
        html: entity.html,
    });
}

// Image file extensions
const IMAGE_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.tiff', '.tif'
]);

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

// Day name for timestamp display
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Org-mode hover provider
 */
export class OrgHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.Hover | null {
        const line = document.lineAt(position.line).text;

        // Check for various hover contexts
        let hover: vscode.Hover | null = null;

        // Image link hover (show image preview) - check first for better UX
        hover = this.getImageLinkHover(line, position, document);
        if (hover) return hover;

        // Entity hover (backslash entities like \alpha)
        hover = this.getEntityHover(line, position);
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
        const tsPattern = /([<\[])(\d{4})-(\d{2})-(\d{2})(?:\s+([A-Za-z]+))?(?:\s+(\d{2}:\d{2})(?:-(\d{2}:\d{2}))?)?(?:\s+([+.]+)(\d+)([hdwmy]))?([>\]])/g;
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
                const repeaterType = match[8];
                const repeaterValue = match[9];
                const repeaterUnit = match[10];

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

                if (repeaterType && repeaterValue && repeaterUnit) {
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
                    markdown.appendMarkdown(`**Repeater:** ${repeaterTypes[repeaterType] || 'Repeater'} every ${repeaterValue} ${units[repeaterUnit] || repeaterUnit}\n\n`);
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
}
