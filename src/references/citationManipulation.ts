import * as vscode from 'vscode';

/**
 * Citation manipulation commands
 * Inspired by org-ref citation manipulation in Emacs
 *
 * - Shift-left: Transpose citation left (swap with previous)
 * - Shift-right: Transpose citation right (swap with next)
 * - Shift-up: Sort citations alphabetically
 */

interface CitationInfo {
    fullMatch: string;
    prefix: string;           // e.g., "cite:", "citep:", "\cite{"
    suffix: string;           // e.g., "" or "}"
    keys: string[];           // Individual citation keys
    separator: string;        // "," or ";"
    keyPrefix: string;        // "" or "@" for org-mode 9.5 style
    start: number;            // Start position in line
    end: number;              // End position in line
    keysStart: number;        // Start of keys within fullMatch
}

/**
 * Find citation at cursor position
 */
function findCitationAtPosition(line: string, position: number): CitationInfo | null {
    // Patterns to match different citation formats
    const patterns = [
        // org-ref style: cite:key1,key2,key3
        {
            regex: /(cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt):([a-zA-Z0-9_:,-]+)/g,
            prefix: (m: RegExpExecArray) => m[1] + ':',
            suffix: '',
            separator: ',',
            keyPrefix: '',
            keysGroup: 2
        },
        // LaTeX style: \cite{key1,key2,key3}
        {
            regex: /(\\cite[pt]?)\{([a-zA-Z0-9_:,-]+)\}/g,
            prefix: (m: RegExpExecArray) => m[1] + '{',
            suffix: '}',
            separator: ',',
            keyPrefix: '',
            keysGroup: 2
        },
        // org-mode 9.5+ style: [cite:@key1;@key2]
        {
            regex: /(\[cite(?:\/[^\]:]*)?\:)(@[a-zA-Z0-9_:;@-]+)(\])/g,
            prefix: (m: RegExpExecArray) => m[1],
            suffix: ']',
            separator: ';',
            keyPrefix: '@',
            keysGroup: 2
        }
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.regex.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;

            if (position >= start && position <= end) {
                const prefix = typeof pattern.prefix === 'function'
                    ? pattern.prefix(match)
                    : pattern.prefix;
                const keysStr = match[pattern.keysGroup];

                // Parse keys
                let keys: string[];
                if (pattern.keyPrefix === '@') {
                    // org-mode 9.5 style with @key;@key2
                    keys = keysStr.split(pattern.separator).map(k => k.trim().replace(/^@/, ''));
                } else {
                    keys = keysStr.split(pattern.separator).map(k => k.trim());
                }

                // Calculate keysStart position within the line
                const keysStart = start + prefix.length;

                return {
                    fullMatch: match[0],
                    prefix,
                    suffix: pattern.suffix,
                    keys,
                    separator: pattern.separator,
                    keyPrefix: pattern.keyPrefix,
                    start,
                    end,
                    keysStart
                };
            }
        }
    }

    return null;
}

/**
 * Find which key index the cursor is on
 */
function findKeyIndexAtPosition(citation: CitationInfo, line: string, position: number): number {
    let currentPos = citation.keysStart;

    for (let i = 0; i < citation.keys.length; i++) {
        const key = citation.keys[i];
        const keyWithPrefix = citation.keyPrefix + key;
        const keyEnd = currentPos + keyWithPrefix.length;

        if (position >= currentPos && position <= keyEnd) {
            return i;
        }

        // Move past the key and separator
        currentPos = keyEnd + citation.separator.length;
    }

    // Default to last key if position is at the end
    return citation.keys.length - 1;
}

/**
 * Rebuild citation string from parts
 */
function rebuildCitation(citation: CitationInfo): string {
    const keysWithPrefix = citation.keys.map(k => citation.keyPrefix + k);
    return citation.prefix + keysWithPrefix.join(citation.separator) + citation.suffix;
}

/**
 * Transpose citation key left (swap with previous)
 */
async function transposeCitationLeft(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line).text;

    const citation = findCitationAtPosition(line, position.character);
    if (!citation) {
        // Not on a citation, fall back to default shift-left behavior
        await vscode.commands.executeCommand('cursorWordLeft');
        return;
    }

    if (citation.keys.length < 2) {
        vscode.window.showInformationMessage('Only one citation key - nothing to transpose');
        return;
    }

    const keyIndex = findKeyIndexAtPosition(citation, line, position.character);

    if (keyIndex === 0) {
        vscode.window.showInformationMessage('Already at first citation');
        return;
    }

    // Swap with previous key
    const temp = citation.keys[keyIndex];
    citation.keys[keyIndex] = citation.keys[keyIndex - 1];
    citation.keys[keyIndex - 1] = temp;

    // Replace in document
    const newCitation = rebuildCitation(citation);
    const range = new vscode.Range(
        position.line, citation.start,
        position.line, citation.end
    );

    await editor.edit(editBuilder => {
        editBuilder.replace(range, newCitation);
    });

    // Move cursor to follow the transposed key
    const newKeyStart = calculateKeyPosition(citation, keyIndex - 1);
    const newPosition = new vscode.Position(position.line, newKeyStart);
    editor.selection = new vscode.Selection(newPosition, newPosition);
}

/**
 * Transpose citation key right (swap with next)
 */
async function transposeCitationRight(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line).text;

    const citation = findCitationAtPosition(line, position.character);
    if (!citation) {
        // Not on a citation, fall back to default shift-right behavior
        await vscode.commands.executeCommand('cursorWordRight');
        return;
    }

    if (citation.keys.length < 2) {
        vscode.window.showInformationMessage('Only one citation key - nothing to transpose');
        return;
    }

    const keyIndex = findKeyIndexAtPosition(citation, line, position.character);

    if (keyIndex >= citation.keys.length - 1) {
        vscode.window.showInformationMessage('Already at last citation');
        return;
    }

    // Swap with next key
    const temp = citation.keys[keyIndex];
    citation.keys[keyIndex] = citation.keys[keyIndex + 1];
    citation.keys[keyIndex + 1] = temp;

    // Replace in document
    const newCitation = rebuildCitation(citation);
    const range = new vscode.Range(
        position.line, citation.start,
        position.line, citation.end
    );

    await editor.edit(editBuilder => {
        editBuilder.replace(range, newCitation);
    });

    // Move cursor to follow the transposed key
    const newKeyStart = calculateKeyPosition(citation, keyIndex + 1);
    const newPosition = new vscode.Position(position.line, newKeyStart);
    editor.selection = new vscode.Selection(newPosition, newPosition);
}

/**
 * Calculate position of a key by index after modification
 */
function calculateKeyPosition(citation: CitationInfo, keyIndex: number): number {
    let pos = citation.start + citation.prefix.length;

    for (let i = 0; i < keyIndex; i++) {
        pos += citation.keyPrefix.length + citation.keys[i].length + citation.separator.length;
    }

    return pos + citation.keyPrefix.length;
}

/**
 * Sort citations alphabetically
 */
async function sortCitations(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line).text;

    const citation = findCitationAtPosition(line, position.character);
    if (!citation) {
        vscode.window.showInformationMessage('Cursor not on a citation');
        return;
    }

    if (citation.keys.length < 2) {
        vscode.window.showInformationMessage('Only one citation key - nothing to sort');
        return;
    }

    // Sort keys alphabetically (case-insensitive)
    const originalKeys = [...citation.keys];
    citation.keys.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    // Check if already sorted
    if (originalKeys.every((k, i) => k === citation.keys[i])) {
        vscode.window.showInformationMessage('Citations already sorted');
        return;
    }

    // Replace in document
    const newCitation = rebuildCitation(citation);
    const range = new vscode.Range(
        position.line, citation.start,
        position.line, citation.end
    );

    await editor.edit(editBuilder => {
        editBuilder.replace(range, newCitation);
    });

    vscode.window.showInformationMessage(`Sorted ${citation.keys.length} citations`);
}

/**
 * Sort citations by year (requires reference manager)
 */
async function sortCitationsByYear(getEntry: (key: string) => any): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line).text;

    const citation = findCitationAtPosition(line, position.character);
    if (!citation) {
        vscode.window.showInformationMessage('Cursor not on a citation');
        return;
    }

    if (citation.keys.length < 2) {
        vscode.window.showInformationMessage('Only one citation key - nothing to sort');
        return;
    }

    // Sort keys by year
    citation.keys.sort((a, b) => {
        const entryA = getEntry(a);
        const entryB = getEntry(b);
        const yearA = parseInt(entryA?.year || '9999');
        const yearB = parseInt(entryB?.year || '9999');
        return yearA - yearB;
    });

    // Replace in document
    const newCitation = rebuildCitation(citation);
    const range = new vscode.Range(
        position.line, citation.start,
        position.line, citation.end
    );

    await editor.edit(editBuilder => {
        editBuilder.replace(range, newCitation);
    });

    vscode.window.showInformationMessage(`Sorted ${citation.keys.length} citations by year`);
}

/**
 * Delete citation at cursor
 */
async function deleteCitation(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line).text;

    const citation = findCitationAtPosition(line, position.character);
    if (!citation) {
        vscode.window.showInformationMessage('Cursor not on a citation');
        return;
    }

    const keyIndex = findKeyIndexAtPosition(citation, line, position.character);
    const keyToDelete = citation.keys[keyIndex];

    if (citation.keys.length === 1) {
        // Only one key - delete entire citation
        const range = new vscode.Range(
            position.line, citation.start,
            position.line, citation.end
        );

        await editor.edit(editBuilder => {
            editBuilder.delete(range);
        });
        vscode.window.showInformationMessage(`Deleted citation: ${keyToDelete}`);
    } else {
        // Multiple keys - remove just this one
        citation.keys.splice(keyIndex, 1);

        const newCitation = rebuildCitation(citation);
        const range = new vscode.Range(
            position.line, citation.start,
            position.line, citation.end
        );

        await editor.edit(editBuilder => {
            editBuilder.replace(range, newCitation);
        });
        vscode.window.showInformationMessage(`Removed citation key: ${keyToDelete}`);
    }
}

/**
 * Check if cursor is on a citation
 */
function isOnCitation(document: vscode.TextDocument, position: vscode.Position): boolean {
    const line = document.lineAt(position.line).text;
    return findCitationAtPosition(line, position.character) !== null;
}

/**
 * Register citation manipulation commands
 */
export function registerCitationManipulationCommands(
    context: vscode.ExtensionContext,
    getEntry?: (key: string) => any
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.transposeCitationLeft', transposeCitationLeft),
        vscode.commands.registerCommand('scimax.ref.transposeCitationRight', transposeCitationRight),
        vscode.commands.registerCommand('scimax.ref.sortCitations', sortCitations),
        vscode.commands.registerCommand('scimax.ref.deleteCitation', deleteCitation)
    );

    // Sort by year if reference manager is available
    if (getEntry) {
        context.subscriptions.push(
            vscode.commands.registerCommand('scimax.ref.sortCitationsByYear', () =>
                sortCitationsByYear(getEntry)
            )
        );
    }

    console.log('Scimax: Citation manipulation commands registered');
}

/**
 * Check if cursor is on citation (for keybinding context)
 */
export function checkCitationContext(context: vscode.ExtensionContext): void {
    // Update context when selection changes
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            const editor = e.textEditor;
            const document = editor.document;

            // Only check for org/markdown/latex files
            if (!['org', 'markdown', 'latex'].includes(document.languageId)) {
                vscode.commands.executeCommand('setContext', 'scimax.onCitation', false);
                return;
            }

            const position = editor.selection.active;
            const onCitation = isOnCitation(document, position);
            vscode.commands.executeCommand('setContext', 'scimax.onCitation', onCitation);
        })
    );
}
