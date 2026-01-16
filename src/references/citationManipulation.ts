import * as vscode from 'vscode';
import {
    findCitationAtPosition as findCitationNew,
    rebuildCitation as rebuildCitationNew,
    findReferenceIndexAtPosition,
} from './citationParser';
import type { ParsedCitation } from './citationTypes';
import { CITATION_PATTERN_CONFIG } from './citationTypes';

/**
 * Citation manipulation commands
 * Inspired by org-ref citation manipulation in Emacs
 *
 * - Shift-left: Transpose citation left (swap with previous)
 * - Shift-right: Transpose citation right (swap with next)
 * - Shift-up: Sort citations by year (oldest first)
 * - Shift-down: Sort citations by year (newest first)
 *
 * Supports multiple citation syntaxes:
 * - org-ref v2: cite:key1,key2
 * - org-ref v3: cite:&key1;&key2
 * - org-cite: [cite:@key1;@key2]
 * - LaTeX: \cite{key1,key2}
 */

/**
 * Legacy CitationInfo interface for backward compatibility
 * @deprecated Use ParsedCitation from citationTypes.ts instead
 */
export interface CitationInfo {
    fullMatch: string;
    prefix: string;           // e.g., "cite:", "citep:", "\cite{"
    suffix: string;           // e.g., "" or "}"
    keys: string[];           // Individual citation keys
    separator: string;        // "," or ";"
    keyPrefix: string;        // "" or "@" or "&"
    start: number;            // Start position in line
    end: number;              // End position in line
    keysStart: number;        // Start of keys within fullMatch
    // New fields from ParsedCitation
    parsedCitation?: ParsedCitation;
}

/**
 * Convert ParsedCitation to CitationInfo for backward compatibility
 */
function parsedToCitationInfo(parsed: ParsedCitation): CitationInfo {
    const config = CITATION_PATTERN_CONFIG[parsed.syntax];

    // Calculate prefix based on syntax
    let prefix: string;
    let suffix: string;

    switch (parsed.syntax) {
        case 'org-cite':
            prefix = `[cite${parsed.style ? '/' + parsed.style : ''}:`;
            suffix = ']';
            break;
        case 'latex':
            prefix = `\\${parsed.command}{`;
            suffix = '}';
            break;
        default:
            prefix = `${parsed.command}:`;
            suffix = '';
    }

    // Calculate keysStart (position after prefix in the raw string)
    let keysStart = parsed.range.start + prefix.length;
    if (parsed.commonPrefix) {
        keysStart += parsed.commonPrefix.length + config.separator.length;
    }

    return {
        fullMatch: parsed.raw,
        prefix,
        suffix,
        keys: parsed.references.map(r => r.key),
        separator: config.separator,
        keyPrefix: config.keyPrefix,
        start: parsed.range.start,
        end: parsed.range.end,
        keysStart,
        parsedCitation: parsed,
    };
}

/**
 * Find citation at cursor position
 * Exported for testing
 */
export function findCitationAtPosition(line: string, position: number): CitationInfo | null {
    const parsed = findCitationNew(line, position);
    if (!parsed) {
        return null;
    }
    return parsedToCitationInfo(parsed);
}

/**
 * Find which key index the cursor is on
 */
function findKeyIndexAtPosition(citation: CitationInfo, line: string, position: number): number {
    // Use new parser function if parsed citation is available
    if (citation.parsedCitation) {
        return findReferenceIndexAtPosition(citation.parsedCitation, line, position);
    }

    // Fallback to legacy implementation
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
    // If we have the parsed citation, use the new rebuilder to preserve notes
    if (citation.parsedCitation) {
        // Update the references with potentially reordered keys
        const parsed = citation.parsedCitation;
        parsed.references = citation.keys.map((key, i) => {
            // Try to preserve original reference data if key exists
            const original = citation.parsedCitation!.references.find(r => r.key === key);
            return original || { key };
        });
        return rebuildCitationNew(parsed);
    }

    // Fallback for legacy usage
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
 * Extract year from citation key or bibliography entry
 * Handles keys like "curtin-2009-struc-activ" or "2023-jupyt-ai"
 * Exported for testing
 */
export function extractYear(key: string, getEntry?: (key: string) => any): number {
    // First try to get year from bibliography entry
    if (getEntry) {
        const entry = getEntry(key);
        if (entry?.year) {
            const year = parseInt(entry.year);
            if (!isNaN(year)) return year;
        }
    }

    // Try to extract year from key name
    // Look for 4-digit year pattern (1900-2099)
    const yearMatch = key.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
        return parseInt(yearMatch[0]);
    }

    // No year found - return high value to sort last
    return 9999;
}

// Reference to getEntry function for sorting
let _getEntry: ((key: string) => any) | undefined;

/**
 * Sort citations by year ascending (oldest first)
 */
async function sortCitationsByYearAscending(): Promise<void> {
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

    // Sort keys by year ascending
    const originalKeys = [...citation.keys];
    citation.keys.sort((a, b) => {
        const yearA = extractYear(a, _getEntry);
        const yearB = extractYear(b, _getEntry);
        return yearA - yearB;
    });

    // Check if already sorted
    if (originalKeys.every((k, i) => k === citation.keys[i])) {
        vscode.window.showInformationMessage('Citations already sorted by year');
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

    vscode.window.showInformationMessage(`Sorted ${citation.keys.length} citations by year (oldest first)`);
}

/**
 * Sort citations by year descending (newest first)
 */
async function sortCitationsByYearDescending(): Promise<void> {
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

    // Sort keys by year descending
    const originalKeys = [...citation.keys];
    citation.keys.sort((a, b) => {
        const yearA = extractYear(a, _getEntry);
        const yearB = extractYear(b, _getEntry);
        return yearB - yearA;  // Descending
    });

    // Check if already sorted
    if (originalKeys.every((k, i) => k === citation.keys[i])) {
        vscode.window.showInformationMessage('Citations already sorted by year');
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

    vscode.window.showInformationMessage(`Sorted ${citation.keys.length} citations by year (newest first)`);
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

    vscode.window.showInformationMessage(`Sorted ${citation.keys.length} citations alphabetically`);
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
    // Store getEntry reference for year extraction
    _getEntry = getEntry;

    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.ref.transposeCitationLeft', transposeCitationLeft),
        vscode.commands.registerCommand('scimax.ref.transposeCitationRight', transposeCitationRight),
        vscode.commands.registerCommand('scimax.ref.sortCitations', sortCitationsByYearAscending),  // shift-up: year ascending
        vscode.commands.registerCommand('scimax.ref.sortCitationsByYear', sortCitationsByYearDescending),  // shift-down: year descending
        vscode.commands.registerCommand('scimax.ref.sortCitationsAlphabetically', sortCitations),  // alphabetical sort
        vscode.commands.registerCommand('scimax.ref.deleteCitation', deleteCitation)
    );
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
