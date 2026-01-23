/**
 * LaTeX Semantic Token Provider
 *
 * Provides semantic highlighting for LaTeX citation commands that aren't
 * handled by the base TextMate grammar (e.g., \citenum, \citealp, etc.)
 */

import * as vscode from 'vscode';

// Define token types that match what themes expect
const tokenTypes = ['keyword', 'variable', 'string'];
const tokenModifiers = ['declaration', 'definition', 'readonly'];

export const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

// Citation commands to highlight (these aren't in the base LaTeX grammar)
const CITATION_COMMANDS = [
    'citenum',
    'citealp',
    'citealt',
    'citeyearpar',
    'citetext',
    'textcite',
    'parencite',
    'footcite',
    'autocite',
    'fullcite',
    'smartcite',
    'supercite',
    'Textcite',
    'Parencite',
    'Footcite',
    'Autocite',
    'Smartcite',
    'Supercite',
    'Citeauthor',
    'Citeyear',
    'Citetitle',
];

// Build regex pattern for citation commands
const citationPattern = new RegExp(
    `\\\\(${CITATION_COMMANDS.join('|')})\\s*(?:\\[([^\\]]*)\\])?\\s*\\{([^}]*)\\}`,
    'g'
);

export class LaTeXSemanticTokenProvider implements vscode.DocumentSemanticTokensProvider {
    async provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): Promise<vscode.SemanticTokens> {
        const builder = new vscode.SemanticTokensBuilder(legend);
        const text = document.getText();

        // Reset regex state
        citationPattern.lastIndex = 0;

        let match;
        while ((match = citationPattern.exec(text)) !== null) {
            const fullMatch = match[0];
            const commandName = match[1];
            const optionalArg = match[2]; // optional [...]
            const keys = match[3]; // citation keys

            const startOffset = match.index;
            const startPos = document.positionAt(startOffset);

            // Token for the backslash + command name (e.g., \citenum)
            // Type: keyword (index 0)
            const commandLength = 1 + commandName.length; // backslash + command
            builder.push(
                startPos.line,
                startPos.character,
                commandLength,
                0, // keyword
                0  // no modifiers
            );

            // Find and token the citation keys
            const keysStartInMatch = fullMatch.lastIndexOf('{') + 1;
            const keysOffset = startOffset + keysStartInMatch;

            // Split keys by comma and token each one
            let keyOffset = 0;
            const keyList = keys.split(',');
            for (const key of keyList) {
                const trimmedKey = key.trim();
                if (trimmedKey.length === 0) {
                    keyOffset += key.length + 1; // +1 for comma
                    continue;
                }

                // Find the actual position of this key in the original string
                const keyStartInKeys = key.indexOf(trimmedKey);
                const absoluteOffset = keysOffset + keyOffset + keyStartInKeys;
                const keyPos = document.positionAt(absoluteOffset);

                // Token for the citation key
                // Type: variable (index 1) - this typically gets a distinct color
                builder.push(
                    keyPos.line,
                    keyPos.character,
                    trimmedKey.length,
                    1, // variable
                    0  // no modifiers
                );

                keyOffset += key.length + 1; // +1 for comma
            }
        }

        return builder.build();
    }
}
