/**
 * Completion Provider for org-mode
 * Provides intelligent completions for links, tags, keywords, blocks, etc.
 */

import * as vscode from 'vscode';
import { ORG_ENTITIES } from '../parser/orgEntities';

// Common source block languages
const SOURCE_LANGUAGES = [
    'python', 'bash', 'sh', 'shell', 'emacs-lisp', 'elisp',
    'javascript', 'js', 'typescript', 'ts', 'json', 'yaml',
    'sql', 'latex', 'html', 'css', 'xml', 'markdown', 'md',
    'c', 'cpp', 'c++', 'java', 'rust', 'go', 'golang', 'ruby',
    'perl', 'r', 'R', 'julia', 'haskell', 'clojure', 'scala',
    'kotlin', 'swift', 'objc', 'objective-c', 'php', 'lua',
    'awk', 'sed', 'gnuplot', 'dot', 'plantuml', 'ditaa', 'mermaid',
];

// Common header arguments
const HEADER_ARGS = [
    ':results', ':exports', ':session', ':var', ':dir', ':file',
    ':output-dir', ':cache', ':eval', ':noweb', ':tangle', ':mkdirp',
    ':comments', ':padline', ':no-expand', ':hlines', ':colnames',
    ':rownames', ':shebang', ':wrap', ':post',
];

// Results options
const RESULTS_OPTIONS = [
    'value', 'output', 'silent', 'replace', 'append', 'prepend',
    'raw', 'drawer', 'html', 'latex', 'code', 'pp', 'table',
    'list', 'scalar', 'verbatim', 'file', 'link', 'graphics',
];

// Export options
const EXPORT_OPTIONS = ['code', 'results', 'both', 'none'];

// Common TODO keywords
const TODO_KEYWORDS = ['TODO', 'NEXT', 'WAITING', 'HOLD', 'SOMEDAY'];
const DONE_KEYWORDS = ['DONE', 'CANCELLED', 'CANCELED'];

// Document keywords
const DOC_KEYWORDS = [
    'TITLE', 'AUTHOR', 'DATE', 'EMAIL', 'LANGUAGE', 'OPTIONS',
    'PROPERTY', 'SETUPFILE', 'INCLUDE', 'BIBLIOGRAPHY',
    'LATEX_CLASS', 'LATEX_CLASS_OPTIONS', 'LATEX_HEADER',
    'HTML_HEAD', 'HTML_HEAD_EXTRA', 'STARTUP', 'FILETAGS',
    'ARCHIVE', 'CATEGORY', 'COLUMNS', 'CONSTANTS', 'LINK',
    'PRIORITIES', 'SEQ_TODO', 'TYP_TODO', 'TODO', 'TAGS',
    'EXPORT_FILE_NAME', 'EXPORT_SELECT_TAGS', 'EXPORT_EXCLUDE_TAGS',
];

// Link types
const LINK_TYPES = [
    'file', 'http', 'https', 'ftp', 'mailto', 'doi', 'cite', 'id',
    'shell', 'elisp', 'info', 'help', 'news', 'bbdb', 'irc', 'rmail',
    'mhe', 'gnus', 'attachment', 'docview',
];

/**
 * Org-mode completion provider
 */
export class OrgCompletionProvider implements vscode.CompletionItemProvider {
    private documentTags: Map<string, Set<string>> = new Map();
    private documentProperties: Map<string, Set<string>> = new Map();

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.CompletionItem[] | vscode.CompletionList {
        const line = document.lineAt(position.line).text;
        const linePrefix = line.substring(0, position.character);

        // Check various completion contexts
        const items: vscode.CompletionItem[] = [];

        // Keyword completions (#+)
        if (linePrefix.match(/^\s*#\+$/i) || linePrefix.match(/^\s*#\+\w*$/i)) {
            items.push(...this.getKeywordCompletions(linePrefix));
        }

        // Block start completions (#+BEGIN_)
        if (linePrefix.match(/^\s*#\+BEGIN_$/i) || linePrefix.match(/^\s*#\+BEGIN_\w*$/i)) {
            items.push(...this.getBlockTypeCompletions());
        }

        // Source block language completions
        if (linePrefix.match(/^\s*#\+BEGIN_SRC\s+$/i) || linePrefix.match(/^\s*#\+BEGIN_SRC\s+\w*$/i)) {
            items.push(...this.getLanguageCompletions());
        }

        // Header argument completions
        if (linePrefix.match(/#\+BEGIN_SRC\s+\w+.*:$/i)) {
            items.push(...this.getHeaderArgCompletions());
        }

        // Results option completions
        if (linePrefix.match(/:results\s+$/i) || linePrefix.match(/:results\s+\w*$/i)) {
            items.push(...this.getResultsCompletions());
        }

        // Exports option completions
        if (linePrefix.match(/:exports\s+$/i)) {
            items.push(...this.getExportsCompletions());
        }

        // Link type completions [[
        if (linePrefix.match(/\[\[$/) || linePrefix.match(/\[\[\w+$/)) {
            items.push(...this.getLinkTypeCompletions());
        }

        // Tag completions (after headline or in #+TAGS)
        if (linePrefix.match(/:\w*$/) && line.match(/^\*+ /)) {
            items.push(...this.getTagCompletions(document));
        }

        // TODO keyword completions (at start of headline after stars)
        if (linePrefix.match(/^\*+\s+$/) || linePrefix.match(/^\*+\s+\w*$/)) {
            items.push(...this.getTodoKeywordCompletions());
        }

        // Property name completions (in drawer)
        if (linePrefix.match(/^\s*:$/)) {
            items.push(...this.getPropertyNameCompletions(document));
        }

        // Entity completions (backslash entities like \alpha)
        if (linePrefix.match(/\\[a-zA-Z]*$/)) {
            items.push(...this.getEntityCompletions());
        }

        // Snippet completions for common structures
        if (linePrefix.match(/^\s*<$/)) {
            items.push(...this.getSnippetCompletions());
        }

        // Line-start keyword shortcuts (ti, n, ca, etc.)
        if (linePrefix.match(/^\s*(ti|n|ca|au|da|op)$/i)) {
            items.push(...this.getLineStartKeywordCompletions(linePrefix, position));
        }

        return items;
    }

    /**
     * Get keyword completions (#+KEYWORD:)
     */
    private getKeywordCompletions(linePrefix: string): vscode.CompletionItem[] {
        const prefix = linePrefix.replace(/^\s*#\+/i, '').toLowerCase();

        return DOC_KEYWORDS
            .filter(kw => kw.toLowerCase().startsWith(prefix))
            .map(kw => {
                const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
                item.insertText = new vscode.SnippetString(`${kw}: $0`);
                item.detail = 'Document keyword';
                return item;
            });
    }

    /**
     * Get block type completions
     */
    private getBlockTypeCompletions(): vscode.CompletionItem[] {
        const blockTypes = [
            { name: 'SRC', detail: 'Source code block', snippet: 'SRC ${1:language}\n$0\n#+END_SRC' },
            { name: 'EXAMPLE', detail: 'Example block', snippet: 'EXAMPLE\n$0\n#+END_EXAMPLE' },
            { name: 'QUOTE', detail: 'Quote block', snippet: 'QUOTE\n$0\n#+END_QUOTE' },
            { name: 'CENTER', detail: 'Centered text', snippet: 'CENTER\n$0\n#+END_CENTER' },
            { name: 'VERSE', detail: 'Verse block', snippet: 'VERSE\n$0\n#+END_VERSE' },
            { name: 'COMMENT', detail: 'Comment block', snippet: 'COMMENT\n$0\n#+END_COMMENT' },
            { name: 'EXPORT', detail: 'Export block', snippet: 'EXPORT ${1:html}\n$0\n#+END_EXPORT' },
        ];

        return blockTypes.map(bt => {
            const item = new vscode.CompletionItem(bt.name, vscode.CompletionItemKind.Snippet);
            item.insertText = new vscode.SnippetString(bt.snippet);
            item.detail = bt.detail;
            return item;
        });
    }

    /**
     * Get language completions for source blocks
     */
    private getLanguageCompletions(): vscode.CompletionItem[] {
        return SOURCE_LANGUAGES.map(lang => {
            const item = new vscode.CompletionItem(lang, vscode.CompletionItemKind.Value);
            item.detail = `${lang} source block`;
            return item;
        });
    }

    /**
     * Get header argument completions
     */
    private getHeaderArgCompletions(): vscode.CompletionItem[] {
        return HEADER_ARGS.map(arg => {
            const item = new vscode.CompletionItem(arg, vscode.CompletionItemKind.Property);
            item.insertText = new vscode.SnippetString(`${arg} $0`);
            item.detail = 'Header argument';
            return item;
        });
    }

    /**
     * Get results option completions
     */
    private getResultsCompletions(): vscode.CompletionItem[] {
        return RESULTS_OPTIONS.map(opt => {
            const item = new vscode.CompletionItem(opt, vscode.CompletionItemKind.EnumMember);
            item.detail = 'Results option';
            return item;
        });
    }

    /**
     * Get exports option completions
     */
    private getExportsCompletions(): vscode.CompletionItem[] {
        return EXPORT_OPTIONS.map(opt => {
            const item = new vscode.CompletionItem(opt, vscode.CompletionItemKind.EnumMember);
            item.detail = 'Export option';
            return item;
        });
    }

    /**
     * Get link type completions
     */
    private getLinkTypeCompletions(): vscode.CompletionItem[] {
        return LINK_TYPES.map(type => {
            const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.Reference);
            item.insertText = new vscode.SnippetString(`${type}:$0`);
            item.detail = `${type} link`;
            return item;
        });
    }

    /**
     * Get tag completions from document
     */
    private getTagCompletions(document: vscode.TextDocument): vscode.CompletionItem[] {
        // Collect all tags used in the document
        const tags = new Set<string>();
        const text = document.getText();

        // Find tags in headlines
        const tagMatches = text.matchAll(/^\*+.*?\s+:([\w@#%:]+):\s*$/gm);
        for (const match of tagMatches) {
            match[1].split(':').forEach(tag => tags.add(tag));
        }

        // Find tags in #+TAGS line
        const tagsLine = text.match(/^\s*#\+TAGS:\s*(.+)$/im);
        if (tagsLine) {
            // Parse tag definitions (could be { } for mutually exclusive)
            tagsLine[1].replace(/\{[^}]+\}/g, '').split(/\s+/).forEach(tag => {
                if (tag && !tag.startsWith('{')) {
                    tags.add(tag.replace(/\([^)]+\)/, '')); // Remove shortcuts
                }
            });
        }

        // Common tags
        ['work', 'personal', 'urgent', 'important', 'review', 'project'].forEach(t => tags.add(t));

        return Array.from(tags).map(tag => {
            const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Constant);
            item.insertText = `${tag}:`;
            item.detail = 'Tag';
            return item;
        });
    }

    /**
     * Get TODO keyword completions
     */
    private getTodoKeywordCompletions(): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        TODO_KEYWORDS.forEach(kw => {
            const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
            item.detail = 'TODO keyword';
            item.insertText = `${kw} `;
            items.push(item);
        });

        DONE_KEYWORDS.forEach(kw => {
            const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
            item.detail = 'Done keyword';
            item.insertText = `${kw} `;
            items.push(item);
        });

        return items;
    }

    /**
     * Get property name completions
     */
    private getPropertyNameCompletions(document: vscode.TextDocument): vscode.CompletionItem[] {
        const properties = new Set<string>([
            'CUSTOM_ID', 'ID', 'CATEGORY', 'EFFORT', 'STYLE', 'COLUMNS',
            'COOKIE_DATA', 'LOG_INTO_DRAWER', 'LOGGING', 'ARCHIVE',
            'ORDERED', 'NOBLOCKING', 'VISIBILITY', 'EXPORT_FILE_NAME',
            'ATTACH_DIR', 'ATTACH_DIR_INHERIT',
        ]);

        // Collect properties from document
        const text = document.getText();
        const propMatches = text.matchAll(/^\s*:([A-Za-z_][A-Za-z0-9_-]*):/gm);
        for (const match of propMatches) {
            if (match[1] !== 'PROPERTIES' && match[1] !== 'END') {
                properties.add(match[1]);
            }
        }

        return Array.from(properties).map(prop => {
            const item = new vscode.CompletionItem(prop, vscode.CompletionItemKind.Property);
            item.insertText = new vscode.SnippetString(`${prop}: $0`);
            item.detail = 'Property';
            return item;
        });
    }

    /**
     * Get entity completions (LaTeX-style entities)
     */
    private getEntityCompletions(): vscode.CompletionItem[] {
        return Object.entries(ORG_ENTITIES).map(([name, entity]) => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Text);
            item.insertText = name;
            item.detail = `${entity.utf8} (${entity.latex})`;
            item.documentation = `Renders as: ${entity.utf8}`;
            return item;
        });
    }

    /**
     * Get line-start keyword completions (shortcuts like ti -> #+TITLE:)
     * These only activate when typed at the beginning of a line
     */
    private getLineStartKeywordCompletions(linePrefix: string, position: vscode.Position): vscode.CompletionItem[] {
        const shortcuts: Array<{ prefix: string; keyword: string; detail: string }> = [
            { prefix: 'ti', keyword: 'TITLE', detail: 'Document title' },
            { prefix: 'n', keyword: 'NAME', detail: 'Named element (for references)' },
            { prefix: 'ca', keyword: 'CAPTION', detail: 'Caption for tables/figures' },
            { prefix: 'au', keyword: 'AUTHOR', detail: 'Document author' },
            { prefix: 'da', keyword: 'DATE', detail: 'Document date' },
            { prefix: 'op', keyword: 'OPTIONS', detail: 'Export options' },
        ];

        const typed = linePrefix.trim().toLowerCase();
        const startCol = linePrefix.length - linePrefix.trimStart().length;

        return shortcuts
            .filter(s => s.prefix === typed)
            .map(s => {
                const item = new vscode.CompletionItem(s.prefix, vscode.CompletionItemKind.Snippet);
                item.insertText = new vscode.SnippetString(`#+${s.keyword}: $0`);
                item.detail = s.detail;
                item.documentation = `Expands to #+${s.keyword}: `;
                // Replace the typed prefix (from start of text to cursor)
                item.range = new vscode.Range(
                    new vscode.Position(position.line, startCol),
                    position
                );
                return item;
            });
    }

    /**
     * Get snippet completions for common structures
     */
    private getSnippetCompletions(): vscode.CompletionItem[] {
        const snippets = [
            {
                label: '<s',
                detail: 'Source block',
                snippet: '#+BEGIN_SRC ${1:language}\n$0\n#+END_SRC',
            },
            {
                label: '<e',
                detail: 'Example block',
                snippet: '#+BEGIN_EXAMPLE\n$0\n#+END_EXAMPLE',
            },
            {
                label: '<q',
                detail: 'Quote block',
                snippet: '#+BEGIN_QUOTE\n$0\n#+END_QUOTE',
            },
            {
                label: '<c',
                detail: 'Center block',
                snippet: '#+BEGIN_CENTER\n$0\n#+END_CENTER',
            },
            {
                label: '<v',
                detail: 'Verse block',
                snippet: '#+BEGIN_VERSE\n$0\n#+END_VERSE',
            },
            {
                label: '<l',
                detail: 'LaTeX block',
                snippet: '#+BEGIN_EXPORT latex\n$0\n#+END_EXPORT',
            },
            {
                label: '<h',
                detail: 'HTML block',
                snippet: '#+BEGIN_EXPORT html\n$0\n#+END_EXPORT',
            },
        ];

        return snippets.map(s => {
            const item = new vscode.CompletionItem(s.label, vscode.CompletionItemKind.Snippet);
            item.insertText = new vscode.SnippetString(s.snippet);
            item.detail = s.detail;
            return item;
        });
    }
}

/**
 * Register the completion provider
 */
export function registerOrgCompletionProvider(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'org', scheme: 'file' },
            new OrgCompletionProvider(),
            '#', '+', ':', '[', '\\', '<', '*' // Trigger characters
        )
    );
}
