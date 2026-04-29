import * as vscode from 'vscode';
import {
    getTodoWorkflowForDocument,
    DEFAULT_TODO_STATES,
    type TodoWorkflow
} from '../org/todoStates';

// Define token types - must match package.json semanticTokenTypes
const tokenTypes = [
    'orgLink',
    'orgCitation',
    'orgTimestamp',
    'orgHeading',
    'orgTodo',
    'orgDone',
    'orgTag'
];

// Define token modifiers - must match package.json semanticTokenModifiers
const tokenModifiers = [
    'active',
    'inactive',
    'done'
];

export const semanticTokensLegend = new vscode.SemanticTokensLegend(
    tokenTypes,
    tokenModifiers
);

interface TokenMatch {
    line: number;
    startChar: number;
    length: number;
    tokenType: number;
    tokenModifiers: number;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildHeadingRegex(workflow: TodoWorkflow | null): RegExp {
    // Union of document workflow states and default states so existing
    // documents without #+TODO: still highlight standard keywords.
    const stateSet = new Set<string>(workflow?.allStates ?? []);
    for (const s of DEFAULT_TODO_STATES) {
        stateSet.add(s);
    }

    const statePattern = [...stateSet].map(escapeRegex).join('|');

    return new RegExp(
        `^(\\*+)\\s+(?:(${statePattern})\\s+)?(?:(\\[#[A-Za-z0-9]\\])\\s+)?(?:(COMMENT)\\s+)?(.*?)(\\s+:[\\w@#%:]+:)?\\s*$`
    );
}

export class OrgSemanticTokenProvider implements vscode.DocumentSemanticTokensProvider {

    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.SemanticTokens {
        const tokensBuilder = new vscode.SemanticTokensBuilder(semanticTokensLegend);
        const tokens: TokenMatch[] = [];

        const text = document.getText();
        const lines = text.split('\n');

        // Build a document-specific heading regex so custom #+TODO: states
        // (e.g. ACCEPTED, REJECTED, PREPARATION) are recognized and can be
        // colored as todo/done.
        const workflow = document.languageId === 'org'
            ? getTodoWorkflowForDocument(document)
            : null;
        const headingRegex = buildHeadingRegex(workflow);

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            if (token.isCancellationRequested) {
                break;
            }

            const line = lines[lineNum];

            // Find links
            this.findLinks(line, lineNum, tokens);

            // Find citations
            this.findCitations(line, lineNum, tokens);

            // Find timestamps
            this.findTimestamps(line, lineNum, tokens);

            // Find headings
            this.findHeadings(line, lineNum, tokens, workflow, headingRegex);

            // Find tags
            this.findTags(line, lineNum, tokens);
        }

        // Sort tokens by position (required by VS Code)
        tokens.sort((a, b) => {
            if (a.line !== b.line) {
                return a.line - b.line;
            }
            return a.startChar - b.startChar;
        });

        // Push tokens to builder
        for (const t of tokens) {
            tokensBuilder.push(t.line, t.startChar, t.length, t.tokenType, t.tokenModifiers);
        }

        return tokensBuilder.build();
    }

    private findLinks(line: string, lineNum: number, tokens: TokenMatch[]): void {
        // Bracket links: [[target][description]] or [[target]]
        const bracketLinkRegex = /\[\[([^\]]+)\](?:\[([^\]]+)\])?\]/g;
        let match;

        while ((match = bracketLinkRegex.exec(line)) !== null) {
            // Check if this is a citation link (cite:, citep:, citet:, etc.)
            const target = match[1];
            const isCitation = /^cite[a-zA-Z]*:/.test(target);

            tokens.push({
                line: lineNum,
                startChar: match.index,
                length: match[0].length,
                tokenType: tokenTypes.indexOf(isCitation ? 'orgCitation' : 'orgLink'),
                tokenModifiers: 0
            });
        }

        // Plain URLs
        const urlRegex = /(?<![\\w])https?:\/\/[^\s<>[\](){}]+/g;
        while ((match = urlRegex.exec(line)) !== null) {
            tokens.push({
                line: lineNum,
                startChar: match.index,
                length: match[0].length,
                tokenType: tokenTypes.indexOf('orgLink'),
                tokenModifiers: 0
            });
        }

        // Angle links: <http://...>
        const angleLinkRegex = /<(https?:\/\/[^>]+)>/g;
        while ((match = angleLinkRegex.exec(line)) !== null) {
            tokens.push({
                line: lineNum,
                startChar: match.index,
                length: match[0].length,
                tokenType: tokenTypes.indexOf('orgLink'),
                tokenModifiers: 0
            });
        }
    }

    private findCitations(line: string, lineNum: number, tokens: TokenMatch[]): void {
        // Bracket citations: [cite:@key] or [cite/style:@key]
        const bracketCiteRegex = /\[cite(?:\/[^:]*)?:([^\]]+)\]/g;
        let match;

        while ((match = bracketCiteRegex.exec(line)) !== null) {
            tokens.push({
                line: lineNum,
                startChar: match.index,
                length: match[0].length,
                tokenType: tokenTypes.indexOf('orgCitation'),
                tokenModifiers: 0
            });
        }

        // org-ref style citations: cite:key, citep:key, citet:key, etc.
        // Supports both v2 (cite:key1,key2) and v3 (cite:&key1;&key2) syntax
        const orgRefCiteRegex = /(?<![\w])(?:cite|citep|citet|citeauthor|citeyear|Citep|Citet|citealp|citealt):([\w:,&;-]+)/g;
        while ((match = orgRefCiteRegex.exec(line)) !== null) {
            tokens.push({
                line: lineNum,
                startChar: match.index,
                length: match[0].length,
                tokenType: tokenTypes.indexOf('orgCitation'),
                tokenModifiers: 0
            });
        }

        // @ style citations: @key
        const atCiteRegex = /(?<![\\w@])@([\w:-]+)/g;
        while ((match = atCiteRegex.exec(line)) !== null) {
            tokens.push({
                line: lineNum,
                startChar: match.index,
                length: match[0].length,
                tokenType: tokenTypes.indexOf('orgCitation'),
                tokenModifiers: 0
            });
        }
    }

    private findTimestamps(line: string, lineNum: number, tokens: TokenMatch[]): void {
        // Active timestamps: <2024-01-15 Mon 10:00>
        const activeTimestampRegex = /<\d{4}-\d{2}-\d{2}[^>]*>/g;
        let match;

        while ((match = activeTimestampRegex.exec(line)) !== null) {
            tokens.push({
                line: lineNum,
                startChar: match.index,
                length: match[0].length,
                tokenType: tokenTypes.indexOf('orgTimestamp'),
                tokenModifiers: 1 << tokenModifiers.indexOf('active') // active modifier
            });
        }

        // Inactive timestamps: [2024-01-15 Mon 10:00]
        const inactiveTimestampRegex = /\[\d{4}-\d{2}-\d{2}[^\]]*\]/g;
        while ((match = inactiveTimestampRegex.exec(line)) !== null) {
            // Skip if this looks like a footnote [fn:...]
            if (/^\[fn:/.test(match[0])) {
                continue;
            }
            tokens.push({
                line: lineNum,
                startChar: match.index,
                length: match[0].length,
                tokenType: tokenTypes.indexOf('orgTimestamp'),
                tokenModifiers: 1 << tokenModifiers.indexOf('inactive') // inactive modifier
            });
        }
    }

    private findHeadings(
        line: string,
        lineNum: number,
        tokens: TokenMatch[],
        workflow: TodoWorkflow | null,
        headingRegex: RegExp
    ): void {
        // Match heading line: * TODO [#A] Title :tags:
        const match = headingRegex.exec(line);

        if (match) {
            const todo = match[2];
            const title = match[5];
            const tags = match[6];

            // Token for the title portion
            if (title && title.trim()) {
                const titleStart = line.indexOf(title);
                if (titleStart >= 0) {
                    tokens.push({
                        line: lineNum,
                        startChar: titleStart,
                        length: title.length,
                        tokenType: tokenTypes.indexOf('orgHeading'),
                        tokenModifiers: 0
                    });
                }
            }

            // Token for TODO keyword
            if (todo) {
                const todoStart = line.indexOf(todo);
                if (todoStart >= 0) {
                    const doneStates = workflow?.doneStates ?? ['DONE', 'CANCELLED'];
                    const isDone = doneStates.includes(todo);
                    tokens.push({
                        line: lineNum,
                        startChar: todoStart,
                        length: todo.length,
                        tokenType: tokenTypes.indexOf(isDone ? 'orgDone' : 'orgTodo'),
                        tokenModifiers: isDone ? (1 << tokenModifiers.indexOf('done')) : 0
                    });
                }
            }

            // Token for tags
            if (tags) {
                const tagsStart = line.lastIndexOf(tags.trim());
                if (tagsStart >= 0) {
                    tokens.push({
                        line: lineNum,
                        startChar: tagsStart,
                        length: tags.trim().length,
                        tokenType: tokenTypes.indexOf('orgTag'),
                        tokenModifiers: 0
                    });
                }
            }
        }
    }

    private findTags(line: string, lineNum: number, tokens: TokenMatch[]): void {
        // Hashtags in body text: #tag
        const hashtagRegex = /(?<!\S)#([a-zA-Z][a-zA-Z0-9_-]*)/g;
        let match;

        while ((match = hashtagRegex.exec(line)) !== null) {
            // Skip if in a comment line
            if (line.trim().startsWith('#') && !line.trim().startsWith('#+')) {
                continue;
            }
            tokens.push({
                line: lineNum,
                startChar: match.index,
                length: match[0].length,
                tokenType: tokenTypes.indexOf('orgTag'),
                tokenModifiers: 0
            });
        }
    }
}

export function registerSemanticTokenProvider(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(
            { language: 'org', scheme: 'file' },
            new OrgSemanticTokenProvider(),
            semanticTokensLegend
        )
    );
}
