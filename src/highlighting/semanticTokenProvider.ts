import * as vscode from 'vscode';

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

export class OrgSemanticTokenProvider implements vscode.DocumentSemanticTokensProvider {

    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.SemanticTokens {
        const tokensBuilder = new vscode.SemanticTokensBuilder(semanticTokensLegend);
        const tokens: TokenMatch[] = [];

        const text = document.getText();
        const lines = text.split('\n');

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
            this.findHeadings(line, lineNum, tokens);

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
        const urlRegex = /(?<![\\w])https?:\/\/[^\s<>\[\](){}]+/g;
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

    private findHeadings(line: string, lineNum: number, tokens: TokenMatch[]): void {
        // Match heading line: * TODO [#A] Title :tags:
        const headingRegex = /^(\*+)\s+(?:(TODO|DONE|NEXT|WAITING|HOLD|CANCELLED)\s+)?(?:(\[#[A-Za-z0-9]\])\s+)?(?:(COMMENT)\s+)?(.*?)(\s+:[\w@#%:]+:)?\s*$/;
        const match = headingRegex.exec(line);

        if (match) {
            const stars = match[1];
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
                    const isDone = todo === 'DONE' || todo === 'CANCELLED';
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
