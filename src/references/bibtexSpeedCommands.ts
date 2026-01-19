/**
 * BibTeX Speed Commands
 *
 * Single-key commands for navigating and manipulating BibTeX entries
 * when cursor is at column 0 of an entry line (@article, @book, etc.)
 *
 * Inspired by org-ref-bibtex.el speed keys from org-ref.
 */

import * as vscode from 'vscode';
import { BibEntry, parseBibTeX, entryToBibTeX, formatAuthors } from './bibtexParser';

/**
 * BibTeX field ordering for sort-entry command
 * Standard BibLaTeX field order
 */
const BIBTEX_FIELD_ORDER = [
    'author',
    'title',
    'journaltitle',
    'journal',
    'booktitle',
    'editor',
    'edition',
    'volume',
    'number',
    'issue',
    'pages',
    'publisher',
    'location',
    'address',
    'year',
    'date',
    'month',
    'doi',
    'url',
    'urldate',
    'isbn',
    'issn',
    'eprint',
    'eprinttype',
    'archiveprefix',
    'primaryclass',
    'note',
    'annote',
    'abstract',
    'keywords',
    'file'
];

/**
 * Speed command definitions for BibTeX mode
 */
export interface BibtexSpeedCommandDefinition {
    key: string;
    command: string;
    description: string;
}

export const BIBTEX_SPEED_COMMANDS: BibtexSpeedCommandDefinition[] = [
    // Navigation
    { key: 'n', command: 'scimax.bibtex.nextEntry', description: 'Next entry' },
    { key: 'p', command: 'scimax.bibtex.previousEntry', description: 'Previous entry' },
    { key: 'j', command: 'scimax.bibtex.jumpToEntry', description: 'Jump to entry' },

    // Entry formatting
    { key: 's', command: 'scimax.bibtex.sortFields', description: 'Sort fields in entry' },
    { key: 'd', command: 'scimax.bibtex.downcaseEntry', description: 'Downcase entry type and fields' },
    { key: 't', command: 'scimax.bibtex.titleCase', description: 'Title case article title' },
    { key: 'S', command: 'scimax.bibtex.sentenceCase', description: 'Sentence case article title' },
    { key: 'c', command: 'scimax.bibtex.cleanEntry', description: 'Clean/format entry' },

    // Entry access
    { key: 'o', command: 'scimax.bibtex.openPdf', description: 'Open PDF' },
    { key: 'u', command: 'scimax.bibtex.openUrl', description: 'Open URL/DOI' },
    { key: 'N', command: 'scimax.bibtex.openNotes', description: 'Open notes' },
    { key: 'g', command: 'scimax.bibtex.googleScholar', description: 'Search Google Scholar' },
    { key: 'x', command: 'scimax.bibtex.crossref', description: 'Open in CrossRef' },
    { key: 'w', command: 'scimax.bibtex.webOfScience', description: 'Open in Web of Science' },

    // Actions
    { key: 'y', command: 'scimax.bibtex.copyKey', description: 'Copy citation key' },
    { key: 'b', command: 'scimax.bibtex.copyBibtex', description: 'Copy BibTeX entry' },
    { key: 'k', command: 'scimax.bibtex.killEntry', description: 'Kill (delete) entry' },
    { key: 'K', command: 'scimax.bibtex.generateKey', description: 'Generate citation key' },

    // File-wide
    { key: 'v', command: 'scimax.bibtex.validateFile', description: 'Validate file' },
    { key: 'i', command: 'scimax.bibtex.showStatistics', description: 'Show file statistics' },

    // Help
    { key: '?', command: 'scimax.bibtex.help', description: 'Show speed commands help' }
];

/**
 * Check if cursor is at the start of a BibTeX entry (column 0 on @type line)
 */
export function isAtBibtexEntryStart(document: vscode.TextDocument, position: vscode.Position): boolean {
    if (document.languageId !== 'bibtex') return false;
    if (position.character !== 0) return false;

    const line = document.lineAt(position.line).text;
    // Match @article, @book, @inproceedings, etc.
    return /^@\w+\s*\{/i.test(line);
}

/**
 * Get the range of the current BibTeX entry
 */
export function getEntryRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | null {
    const text = document.getText();
    const lines = text.split('\n');

    // Find entry start
    let startLine = position.line;
    while (startLine > 0 && !/^@\w+\s*\{/i.test(lines[startLine])) {
        startLine--;
    }

    if (!/^@\w+\s*\{/i.test(lines[startLine])) {
        return null;
    }

    // Find entry end by counting braces
    let braceCount = 0;
    let endLine = startLine;
    let foundStart = false;

    for (let i = startLine; i < lines.length; i++) {
        for (const char of lines[i]) {
            if (char === '{') {
                braceCount++;
                foundStart = true;
            } else if (char === '}') {
                braceCount--;
            }
        }
        endLine = i;
        if (foundStart && braceCount === 0) {
            break;
        }
    }

    return new vscode.Range(
        new vscode.Position(startLine, 0),
        new vscode.Position(endLine, lines[endLine].length)
    );
}

/**
 * Parse the entry at the current position
 */
export function getEntryAtPosition(document: vscode.TextDocument, position: vscode.Position): BibEntry | null {
    const range = getEntryRange(document, position);
    if (!range) return null;

    const entryText = document.getText(range);
    const result = parseBibTeX(entryText);

    return result.entries.length > 0 ? result.entries[0] : null;
}

/**
 * Navigate to next BibTeX entry
 */
export async function nextEntry(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;

    // Find next @type line
    for (let i = currentLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        if (/^@\w+\s*\{/i.test(line)) {
            const newPosition = new vscode.Position(i, 0);
            editor.selection = new vscode.Selection(newPosition, newPosition);
            editor.revealRange(new vscode.Range(newPosition, newPosition), vscode.TextEditorRevealType.InCenter);
            return;
        }
    }

    vscode.window.showInformationMessage('No more entries below');
}

/**
 * Navigate to previous BibTeX entry
 */
export async function previousEntry(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;

    // Find previous @type line
    for (let i = currentLine - 1; i >= 0; i--) {
        const line = document.lineAt(i).text;
        if (/^@\w+\s*\{/i.test(line)) {
            const newPosition = new vscode.Position(i, 0);
            editor.selection = new vscode.Selection(newPosition, newPosition);
            editor.revealRange(new vscode.Range(newPosition, newPosition), vscode.TextEditorRevealType.InCenter);
            return;
        }
    }

    vscode.window.showInformationMessage('No more entries above');
}

/**
 * Jump to a BibTeX entry using quick pick
 */
export async function jumpToEntry(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const document = editor.document;
    const text = document.getText();
    const result = parseBibTeX(text);

    if (result.entries.length === 0) {
        vscode.window.showInformationMessage('No entries found');
        return;
    }

    const items = result.entries.map(entry => ({
        label: entry.key,
        description: `${formatAuthors(entry.author, 2)} (${entry.year || 'n.d.'})`,
        detail: entry.title,
        entry
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Jump to entry',
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (!selected) return;

    // Find the entry in the document
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`{${selected.entry.key},`) || lines[i].includes(`{${selected.entry.key}`)) {
            const newPosition = new vscode.Position(i, 0);
            editor.selection = new vscode.Selection(newPosition, newPosition);
            editor.revealRange(new vscode.Range(newPosition, newPosition), vscode.TextEditorRevealType.InCenter);
            return;
        }
    }
}

/**
 * Sort fields in the current entry according to standard order
 */
export async function sortFields(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const document = editor.document;
    const range = getEntryRange(document, editor.selection.active);
    if (!range) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    const entry = getEntryAtPosition(document, editor.selection.active);
    if (!entry) {
        vscode.window.showWarningMessage('Could not parse entry');
        return;
    }

    // Sort fields according to standard order
    const sortedFields: [string, string][] = [];
    const seenFields = new Set<string>();

    // Add fields in standard order
    for (const field of BIBTEX_FIELD_ORDER) {
        const value = entry.fields[field];
        if (value !== undefined) {
            sortedFields.push([field, value]);
            seenFields.add(field);
        }
    }

    // Add remaining fields not in standard order
    for (const [field, value] of Object.entries(entry.fields)) {
        if (!seenFields.has(field)) {
            sortedFields.push([field, value]);
        }
    }

    // Build new entry
    let newEntry = `@${entry.type}{${entry.key},\n`;
    for (const [field, value] of sortedFields) {
        newEntry += `  ${field} = {${value}},\n`;
    }
    newEntry += '}';

    await editor.edit(editBuilder => {
        editBuilder.replace(range, newEntry);
    });

    vscode.window.showInformationMessage('Fields sorted');
}

/**
 * Downcase entry type and field names
 */
export async function downcaseEntry(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const document = editor.document;
    const range = getEntryRange(document, editor.selection.active);
    if (!range) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    const entryText = document.getText(range);

    // Downcase @TYPE to @type
    let newText = entryText.replace(/^@(\w+)/i, (_, type) => `@${type.toLowerCase()}`);

    // Downcase field names (word before =)
    newText = newText.replace(/^\s*(\w+)\s*=/gm, (_, field) => `  ${field.toLowerCase()} =`);

    await editor.edit(editBuilder => {
        editBuilder.replace(range, newText);
    });

    vscode.window.showInformationMessage('Entry downcased');
}

/**
 * Convert article title to Title Case
 */
export async function titleCaseTitle(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const document = editor.document;
    const range = getEntryRange(document, editor.selection.active);
    if (!range) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    const entryText = document.getText(range);

    // Find and transform title field
    const newText = entryText.replace(
        /(\btitle\s*=\s*\{)([^}]+)(\})/gi,
        (_, prefix, title, suffix) => {
            const titleCased = toTitleCase(title);
            return `${prefix}${titleCased}${suffix}`;
        }
    );

    if (newText === entryText) {
        vscode.window.showInformationMessage('No title field found');
        return;
    }

    await editor.edit(editBuilder => {
        editBuilder.replace(range, newText);
    });

    vscode.window.showInformationMessage('Title converted to Title Case');
}

/**
 * Convert article title to Sentence case
 */
export async function sentenceCaseTitle(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const document = editor.document;
    const range = getEntryRange(document, editor.selection.active);
    if (!range) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    const entryText = document.getText(range);

    // Find and transform title field
    const newText = entryText.replace(
        /(\btitle\s*=\s*\{)([^}]+)(\})/gi,
        (_, prefix, title, suffix) => {
            const sentenceCased = toSentenceCase(title);
            return `${prefix}${sentenceCased}${suffix}`;
        }
    );

    if (newText === entryText) {
        vscode.window.showInformationMessage('No title field found');
        return;
    }

    await editor.edit(editBuilder => {
        editBuilder.replace(range, newText);
    });

    vscode.window.showInformationMessage('Title converted to sentence case');
}

/**
 * Clean/format the current entry
 */
export async function cleanEntry(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const document = editor.document;
    const range = getEntryRange(document, editor.selection.active);
    if (!range) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    const entry = getEntryAtPosition(document, editor.selection.active);
    if (!entry) {
        vscode.window.showWarningMessage('Could not parse entry');
        return;
    }

    // Clean fields
    const cleanedFields: Record<string, string> = {};

    for (const [field, value] of Object.entries(entry.fields)) {
        // Normalize field name
        const normalizedField = field.toLowerCase();

        // Clean value
        let cleanedValue = value
            // Normalize whitespace
            .replace(/\s+/g, ' ')
            .trim();

        // Remove duplicate braces
        if (cleanedValue.startsWith('{') && cleanedValue.endsWith('}')) {
            // Check for double braces like {{Title}}
            if (cleanedValue.startsWith('{{') && cleanedValue.endsWith('}}')) {
                cleanedValue = cleanedValue.slice(1, -1);
            }
        }

        cleanedFields[normalizedField] = cleanedValue;
    }

    // Build cleaned entry with sorted fields
    const sortedFields: [string, string][] = [];

    for (const field of BIBTEX_FIELD_ORDER) {
        if (cleanedFields[field] !== undefined) {
            sortedFields.push([field, cleanedFields[field]]);
            delete cleanedFields[field];
        }
    }

    // Add remaining fields
    for (const [field, value] of Object.entries(cleanedFields)) {
        sortedFields.push([field, value]);
    }

    let newEntry = `@${entry.type.toLowerCase()}{${entry.key},\n`;
    for (const [field, value] of sortedFields) {
        newEntry += `  ${field} = {${value}},\n`;
    }
    newEntry += '}';

    await editor.edit(editBuilder => {
        editBuilder.replace(range, newEntry);
    });

    vscode.window.showInformationMessage('Entry cleaned');
}

/**
 * Open PDF for the current entry
 */
export async function openPdf(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const entry = getEntryAtPosition(editor.document, editor.selection.active);
    if (!entry) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    // Check for file field
    if (entry.fields.file) {
        // Parse file field (can be in various formats)
        const filePath = entry.fields.file
            .replace(/^:/, '')
            .split(':')[0]
            .replace(/;.*$/, '');

        try {
            await vscode.env.openExternal(vscode.Uri.file(filePath));
            return;
        } catch {
            // Fall through to other methods
        }
    }

    // Check PDF directory setting
    const config = vscode.workspace.getConfiguration('scimax.ref');
    const pdfDir = config.get<string>('pdfDirectory');

    if (pdfDir) {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const resolvedDir = pdfDir.replace('~', homeDir);
        const path = await import('path');
        const fs = await import('fs');

        // Try common naming patterns
        const patterns = [
            `${entry.key}.pdf`,
            `${entry.author?.split(',')[0]?.trim() || 'unknown'}_${entry.year || 'unknown'}.pdf`,
            entry.doi ? `${entry.doi.replace(/\//g, '_')}.pdf` : null
        ].filter(Boolean) as string[];

        for (const pattern of patterns) {
            const pdfPath = path.join(resolvedDir, pattern);
            if (fs.existsSync(pdfPath)) {
                await vscode.env.openExternal(vscode.Uri.file(pdfPath));
                return;
            }
        }
    }

    // Offer to open DOI
    if (entry.doi) {
        const action = await vscode.window.showInformationMessage(
            'PDF not found. Open DOI in browser?',
            'Open DOI', 'Cancel'
        );
        if (action === 'Open DOI') {
            await vscode.env.openExternal(vscode.Uri.parse(`https://doi.org/${entry.doi}`));
        }
    } else {
        vscode.window.showWarningMessage('No PDF or DOI found for this entry');
    }
}

/**
 * Open URL or DOI for the current entry
 */
export async function openUrl(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const entry = getEntryAtPosition(editor.document, editor.selection.active);
    if (!entry) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    if (entry.doi) {
        await vscode.env.openExternal(vscode.Uri.parse(`https://doi.org/${entry.doi}`));
    } else if (entry.url) {
        await vscode.env.openExternal(vscode.Uri.parse(entry.url));
    } else if (entry.fields.eprint) {
        // arXiv
        await vscode.env.openExternal(vscode.Uri.parse(`https://arxiv.org/abs/${entry.fields.eprint}`));
    } else {
        vscode.window.showWarningMessage('No URL, DOI, or eprint found');
    }
}

/**
 * Open notes for the current entry
 */
export async function openNotes(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const entry = getEntryAtPosition(editor.document, editor.selection.active);
    if (!entry) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    // Use scimax.ref.showDetails which handles notes
    await vscode.commands.executeCommand('scimax.ref.showDetails', entry.key);
}

/**
 * Search for entry in Google Scholar
 */
export async function googleScholar(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const entry = getEntryAtPosition(editor.document, editor.selection.active);
    if (!entry) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    let searchQuery = '';

    if (entry.doi) {
        searchQuery = entry.doi;
    } else if (entry.title) {
        searchQuery = entry.title;
    } else {
        searchQuery = entry.key;
    }

    const encodedQuery = encodeURIComponent(searchQuery);
    await vscode.env.openExternal(vscode.Uri.parse(`https://scholar.google.com/scholar?q=${encodedQuery}`));
}

/**
 * Open entry in CrossRef
 */
export async function openCrossref(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const entry = getEntryAtPosition(editor.document, editor.selection.active);
    if (!entry) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    if (entry.doi) {
        await vscode.env.openExternal(vscode.Uri.parse(`https://search.crossref.org/?q=${entry.doi}`));
    } else {
        vscode.window.showWarningMessage('No DOI found');
    }
}

/**
 * Open entry in Web of Science
 */
export async function openWebOfScience(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const entry = getEntryAtPosition(editor.document, editor.selection.active);
    if (!entry) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    if (entry.doi) {
        await vscode.env.openExternal(vscode.Uri.parse(`https://www.webofscience.com/wos/woscc/full-record/WOS:${entry.doi}`));
    } else {
        vscode.window.showWarningMessage('No DOI found - Web of Science requires DOI');
    }
}

/**
 * Copy citation key to clipboard
 */
export async function copyKey(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const entry = getEntryAtPosition(editor.document, editor.selection.active);
    if (!entry) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    await vscode.env.clipboard.writeText(entry.key);
    vscode.window.showInformationMessage(`Copied: ${entry.key}`);
}

/**
 * Copy full BibTeX entry to clipboard
 */
export async function copyBibtex(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const range = getEntryRange(editor.document, editor.selection.active);
    if (!range) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    const entryText = editor.document.getText(range);
    await vscode.env.clipboard.writeText(entryText);
    vscode.window.showInformationMessage('BibTeX entry copied');
}

/**
 * Delete (kill) the current entry
 */
export async function killEntry(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const range = getEntryRange(editor.document, editor.selection.active);
    if (!range) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    const entry = getEntryAtPosition(editor.document, editor.selection.active);
    const confirm = await vscode.window.showWarningMessage(
        `Delete entry "${entry?.key || 'unknown'}"?`,
        { modal: true },
        'Delete'
    );

    if (confirm !== 'Delete') return;

    // Copy to clipboard first
    const entryText = editor.document.getText(range);
    await vscode.env.clipboard.writeText(entryText);

    // Delete with trailing newlines
    let endLine = range.end.line;
    while (endLine + 1 < editor.document.lineCount &&
           editor.document.lineAt(endLine + 1).text.trim() === '') {
        endLine++;
    }

    const deleteRange = new vscode.Range(
        range.start,
        new vscode.Position(endLine + 1, 0)
    );

    await editor.edit(editBuilder => {
        editBuilder.delete(deleteRange);
    });

    vscode.window.showInformationMessage(`Deleted entry (copied to clipboard)`);
}

/**
 * Get all existing keys in the document (for uniqueness checking)
 */
function getAllKeysInDocument(document: vscode.TextDocument): Set<string> {
    const text = document.getText();
    const result = parseBibTeX(text);
    return new Set(result.entries.map(e => e.key));
}

/**
 * Extract the last name from an author string
 * Handles formats like "John Smith", "Smith, John", "John von Smith"
 */
function extractLastName(author: string | undefined): string {
    if (!author) return 'unknown';

    // Take first author if multiple (split by " and ")
    const firstAuthor = author.split(/\s+and\s+/i)[0].trim();

    // Handle "Last, First" format
    if (firstAuthor.includes(',')) {
        return firstAuthor.split(',')[0].trim();
    }

    // Handle "First Last" or "First von Last" format
    const parts = firstAuthor.split(/\s+/);
    if (parts.length === 0) return 'unknown';

    // Return last part, but skip common prefixes if they're at the end
    return parts[parts.length - 1];
}

/**
 * Extract meaningful words from a title for key generation
 */
function extractTitleWords(title: string | undefined, count: number = 2): string[] {
    if (!title) return [];

    // Words to skip in title
    const stopWords = new Set([
        'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
        'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
        'using', 'based', 'new', 'novel', 'approach', 'method', 'study',
        'analysis', 'via', 'into', 'upon', 'about', 'between', 'through'
    ]);

    // Remove braced content and special characters
    const cleaned = title
        .replace(/\{[^}]*\}/g, '') // Remove braced content
        .replace(/[^a-zA-Z0-9\s]/g, ' ') // Remove special chars
        .toLowerCase();

    const words = cleaned.split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

    return words.slice(0, count);
}

/**
 * Generate a unique citation key for the current entry
 */
export async function generateKey(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const document = editor.document;
    const range = getEntryRange(document, editor.selection.active);
    if (!range) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    const entry = getEntryAtPosition(document, editor.selection.active);
    if (!entry) {
        vscode.window.showWarningMessage('Could not parse entry');
        return;
    }

    // Extract components for key
    const lastName = extractLastName(entry.author || entry.fields.editor)
        .toLowerCase()
        .replace(/[^a-z]/g, ''); // Remove non-alpha chars

    const year = entry.year || '';
    const titleWords = extractTitleWords(entry.title);

    // Get existing keys (excluding current entry's key)
    const existingKeys = getAllKeysInDocument(document);
    existingKeys.delete(entry.key);

    // Offer key format options
    const baseKeys = [
        `${lastName}-${year}`,
        titleWords.length > 0 ? `${lastName}-${titleWords.join('-')}-${year}` : null,
        titleWords.length > 0 ? `${lastName}-${titleWords[0]}-${year}` : null,
    ].filter(Boolean) as string[];

    // Generate unique versions of each option
    const keyOptions: { label: string; description: string; key: string }[] = [];

    for (const baseKey of baseKeys) {
        let uniqueKey = baseKey;
        let suffix = '';
        let suffixNum = 0;

        // Check uniqueness and add suffix if needed
        while (existingKeys.has(uniqueKey)) {
            suffixNum++;
            suffix = String.fromCharCode(96 + suffixNum); // a, b, c, ...
            uniqueKey = `${baseKey}${suffix}`;
        }

        const description = suffix
            ? `(${suffix} added for uniqueness)`
            : existingKeys.size > 0 ? '(unique)' : '';

        keyOptions.push({
            label: uniqueKey,
            description,
            key: uniqueKey
        });
    }

    // Remove duplicates
    const seen = new Set<string>();
    const uniqueOptions = keyOptions.filter(opt => {
        if (seen.has(opt.key)) return false;
        seen.add(opt.key);
        return true;
    });

    // If current key matches one of the generated options, show message
    if (uniqueOptions.some(opt => opt.key === entry.key)) {
        vscode.window.showInformationMessage(`Key "${entry.key}" is already in standard format`);
        return;
    }

    // Let user choose
    const selected = await vscode.window.showQuickPick(uniqueOptions, {
        placeHolder: `Current key: ${entry.key} → Select new key format`
    });

    if (!selected) return;

    const newKey = selected.key;
    const oldKey = entry.key;

    // Replace the key in the entry
    const entryText = document.getText(range);
    const newEntryText = entryText.replace(
        new RegExp(`^(@\\w+\\s*\\{)${escapeRegex(oldKey)}(\\s*,)`, 'm'),
        `$1${newKey}$2`
    );

    if (newEntryText === entryText) {
        vscode.window.showWarningMessage('Could not replace key in entry');
        return;
    }

    await editor.edit(editBuilder => {
        editBuilder.replace(range, newEntryText);
    });

    vscode.window.showInformationMessage(`Key changed: ${oldKey} → ${newKey}`);
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * BibTeX vs BibLaTeX field mappings for mixed syntax detection
 */
const BIBTEX_BIBLATEX_FIELD_PAIRS: [string, string][] = [
    ['journal', 'journaltitle'],
    ['address', 'location'],
    ['school', 'institution'],
    ['key', 'sortkey'],
];

const BIBLATEX_ONLY_FIELDS = new Set([
    'journaltitle', 'location', 'institution', 'date', 'urldate',
    'eprint', 'eprinttype', 'eprintclass', 'primaryclass',
    'eventdate', 'eventtitle', 'venue', 'origdate', 'origlocation',
    'origpublisher', 'origtitle', 'pagetotal', 'bookpagination',
    'mainsubtitle', 'maintitle', 'maintitleaddon', 'booksubtitle',
    'booktitle', 'booktitleaddon', 'issuetitle', 'issuesubtitle',
    'language', 'origlanguage', 'crossref', 'entryset', 'execute',
    'gender', 'langid', 'langidopts', 'ids', 'indexsorttitle',
    'indextitle', 'isan', 'ismn', 'iswc', 'label', 'library',
    'nameaddon', 'options', 'origpublisher', 'pagination',
    'presort', 'related', 'relatedoptions', 'relatedstring',
    'relatedtype', 'shortauthor', 'shorteditor', 'shorthand',
    'shorthandintro', 'shortjournal', 'shortseries', 'shorttitle',
    'sortname', 'sortshorthand', 'sorttitle', 'sortyear', 'xdata',
    'xref', 'addendum', 'pubstate', 'annotation', 'verba', 'verbb', 'verbc'
]);

const BIBTEX_ONLY_ENTRY_TYPES = new Set([
    'conference', // BibTeX uses @conference, BibLaTeX prefers @inproceedings
]);

const BIBLATEX_ONLY_ENTRY_TYPES = new Set([
    'mvbook', 'mvcollection', 'mvproceedings', 'mvreference',
    'bookinbook', 'suppbook', 'collection', 'suppcollection',
    'online', 'patent', 'periodical', 'suppperiodical',
    'proceedings', 'reference', 'inreference', 'report', 'set',
    'software', 'thesis', 'xdata', 'artwork', 'audio', 'bibnote',
    'commentary', 'image', 'jurisdiction', 'legal', 'legislation',
    'letter', 'movie', 'music', 'performance', 'review', 'video'
]);

interface ValidationIssue {
    line: number;
    key?: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
}

interface FileStatistics {
    totalEntries: number;
    entryTypes: Map<string, number>;
    duplicateKeys: string[];
    syntaxStyle: 'bibtex' | 'biblatex' | 'mixed' | 'unknown';
    bibtexFields: string[];
    biblatexFields: string[];
    issues: ValidationIssue[];
}

/**
 * Analyze and validate a BibTeX file
 */
function analyzeFile(document: vscode.TextDocument): FileStatistics {
    const text = document.getText();
    const lines = text.split('\n');
    const result = parseBibTeX(text);

    const stats: FileStatistics = {
        totalEntries: result.entries.length,
        entryTypes: new Map(),
        duplicateKeys: [],
        syntaxStyle: 'unknown',
        bibtexFields: [],
        biblatexFields: [],
        issues: []
    };

    // Track keys for duplicate detection
    const keyOccurrences = new Map<string, number[]>();

    // Track field usage for syntax detection
    const bibtexFieldsUsed = new Set<string>();
    const biblatexFieldsUsed = new Set<string>();
    const bibtexEntryTypesUsed = new Set<string>();
    const biblatexEntryTypesUsed = new Set<string>();

    for (const entry of result.entries) {
        // Count entry types
        const type = entry.type.toLowerCase();
        stats.entryTypes.set(type, (stats.entryTypes.get(type) || 0) + 1);

        // Check entry type for syntax
        if (BIBTEX_ONLY_ENTRY_TYPES.has(type)) {
            bibtexEntryTypesUsed.add(type);
        }
        if (BIBLATEX_ONLY_ENTRY_TYPES.has(type)) {
            biblatexEntryTypesUsed.add(type);
        }

        // Track key occurrences for duplicate detection
        const lineNum = findEntryLine(lines, entry.key);
        if (!keyOccurrences.has(entry.key)) {
            keyOccurrences.set(entry.key, []);
        }
        keyOccurrences.get(entry.key)!.push(lineNum);

        // Analyze fields for syntax style
        for (const field of Object.keys(entry.fields)) {
            const fieldLower = field.toLowerCase();

            // Check paired fields
            for (const [bibtexField, biblatexField] of BIBTEX_BIBLATEX_FIELD_PAIRS) {
                if (fieldLower === bibtexField) {
                    bibtexFieldsUsed.add(bibtexField);
                }
                if (fieldLower === biblatexField) {
                    biblatexFieldsUsed.add(biblatexField);
                }
            }

            // Check BibLaTeX-only fields
            if (BIBLATEX_ONLY_FIELDS.has(fieldLower)) {
                biblatexFieldsUsed.add(fieldLower);
            }
        }

        // Validate entry
        validateEntry(entry, lineNum, stats.issues);
    }

    // Find duplicates
    for (const [key, occurrences] of keyOccurrences) {
        if (occurrences.length > 1) {
            stats.duplicateKeys.push(key);
            for (const line of occurrences) {
                stats.issues.push({
                    line,
                    key,
                    severity: 'error',
                    message: `Duplicate key "${key}" (appears ${occurrences.length} times)`
                });
            }
        }
    }

    // Determine syntax style
    stats.bibtexFields = Array.from(bibtexFieldsUsed);
    stats.biblatexFields = Array.from(biblatexFieldsUsed);

    const hasBibtex = bibtexFieldsUsed.size > 0 || bibtexEntryTypesUsed.size > 0;
    const hasBiblatex = biblatexFieldsUsed.size > 0 || biblatexEntryTypesUsed.size > 0;

    if (hasBibtex && hasBiblatex) {
        stats.syntaxStyle = 'mixed';
        // Add warnings for mixed syntax
        if (bibtexFieldsUsed.size > 0 && biblatexFieldsUsed.size > 0) {
            stats.issues.push({
                line: 0,
                severity: 'warning',
                message: `Mixed BibTeX/BibLaTeX fields: BibTeX (${stats.bibtexFields.join(', ')}), BibLaTeX (${stats.biblatexFields.join(', ')})`
            });
        }
    } else if (hasBiblatex) {
        stats.syntaxStyle = 'biblatex';
    } else if (hasBibtex) {
        stats.syntaxStyle = 'bibtex';
    } else {
        stats.syntaxStyle = 'unknown';
    }

    // Check for syntax errors in the raw text
    detectSyntaxErrors(lines, stats.issues);

    return stats;
}

/**
 * Find the line number for an entry by its key
 */
function findEntryLine(lines: string[], key: string): number {
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`{${key},`) || lines[i].includes(`{${key}`)) {
            return i + 1; // 1-indexed
        }
    }
    return 0;
}

/**
 * Validate a single entry
 */
function validateEntry(entry: BibEntry, line: number, issues: ValidationIssue[]): void {
    const type = entry.type.toLowerCase();

    // Check required fields based on entry type
    const requiredFields: Record<string, string[]> = {
        article: ['author', 'title', 'journal', 'year'],
        book: ['author', 'title', 'publisher', 'year'],
        inproceedings: ['author', 'title', 'booktitle', 'year'],
        incollection: ['author', 'title', 'booktitle', 'publisher', 'year'],
        phdthesis: ['author', 'title', 'school', 'year'],
        mastersthesis: ['author', 'title', 'school', 'year'],
        techreport: ['author', 'title', 'institution', 'year'],
        misc: [], // No required fields
        unpublished: ['author', 'title', 'note'],
    };

    const required = requiredFields[type];
    if (required) {
        for (const field of required) {
            // Check for field or its BibLaTeX equivalent
            const hasField = entry.fields[field] ||
                (field === 'journal' && entry.fields.journaltitle) ||
                (field === 'school' && entry.fields.institution) ||
                (field === 'address' && entry.fields.location);

            if (!hasField) {
                issues.push({
                    line,
                    key: entry.key,
                    severity: 'warning',
                    message: `Missing recommended field "${field}" in @${type}`
                });
            }
        }
    }

    // Check for empty key
    if (!entry.key || entry.key.trim() === '') {
        issues.push({
            line,
            severity: 'error',
            message: 'Entry has empty or missing key'
        });
    }
}

/**
 * Detect syntax errors in the raw BibTeX text
 */
function detectSyntaxErrors(lines: string[], issues: ValidationIssue[]): void {
    let braceDepth = 0;
    let inEntry = false;
    let entryStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for entry start
        if (/^@\w+\s*\{/i.test(line)) {
            if (inEntry && braceDepth > 0) {
                issues.push({
                    line: entryStartLine + 1,
                    severity: 'error',
                    message: `Unclosed entry starting at line ${entryStartLine + 1}`
                });
            }
            inEntry = true;
            entryStartLine = i;
            braceDepth = 0;
        }

        // Count braces
        for (const char of line) {
            if (char === '{') braceDepth++;
            if (char === '}') braceDepth--;
        }

        // Check for negative brace depth (too many closing braces)
        if (braceDepth < 0) {
            issues.push({
                line: i + 1,
                severity: 'error',
                message: 'Unmatched closing brace'
            });
            braceDepth = 0;
        }

        // Entry closed
        if (inEntry && braceDepth === 0 && line.includes('}')) {
            inEntry = false;
        }
    }

    // Check for unclosed entry at end of file
    if (inEntry && braceDepth > 0) {
        issues.push({
            line: entryStartLine + 1,
            severity: 'error',
            message: `Unclosed entry at end of file (missing ${braceDepth} closing brace${braceDepth > 1 ? 's' : ''})`
        });
    }
}

/**
 * Validate the current BibTeX file and show results
 */
export async function validateFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') {
        vscode.window.showWarningMessage('Not a BibTeX file');
        return;
    }

    const stats = analyzeFile(editor.document);

    // Sort issues by line number
    stats.issues.sort((a, b) => a.line - b.line);

    // Create output
    const output: string[] = [];
    output.push(`=== BibTeX File Validation ===`);
    output.push(``);
    output.push(`Total entries: ${stats.totalEntries}`);
    output.push(`Syntax style: ${stats.syntaxStyle}`);

    if (stats.syntaxStyle === 'mixed') {
        output.push(`  BibTeX fields: ${stats.bibtexFields.join(', ') || 'none'}`);
        output.push(`  BibLaTeX fields: ${stats.biblatexFields.join(', ') || 'none'}`);
    }

    output.push(``);
    output.push(`Entry types:`);
    for (const [type, count] of Array.from(stats.entryTypes.entries()).sort()) {
        output.push(`  @${type}: ${count}`);
    }

    if (stats.duplicateKeys.length > 0) {
        output.push(``);
        output.push(`Duplicate keys: ${stats.duplicateKeys.join(', ')}`);
    }

    const errors = stats.issues.filter(i => i.severity === 'error');
    const warnings = stats.issues.filter(i => i.severity === 'warning');

    output.push(``);
    output.push(`Issues: ${errors.length} errors, ${warnings.length} warnings`);

    if (stats.issues.length > 0) {
        output.push(``);
        for (const issue of stats.issues) {
            const prefix = issue.severity === 'error' ? '❌' : '⚠️';
            const keyStr = issue.key ? ` [${issue.key}]` : '';
            output.push(`${prefix} Line ${issue.line}${keyStr}: ${issue.message}`);
        }
    } else {
        output.push(``);
        output.push(`✅ No issues found`);
    }

    // Show in output channel
    const channel = vscode.window.createOutputChannel('BibTeX Validation');
    channel.clear();
    channel.appendLine(output.join('\n'));
    channel.show();

    // Also show summary in notification
    if (errors.length > 0) {
        vscode.window.showErrorMessage(
            `BibTeX: ${stats.totalEntries} entries, ${errors.length} errors, ${warnings.length} warnings`
        );
    } else if (warnings.length > 0) {
        vscode.window.showWarningMessage(
            `BibTeX: ${stats.totalEntries} entries, ${warnings.length} warnings`
        );
    } else {
        vscode.window.showInformationMessage(
            `BibTeX: ${stats.totalEntries} entries, no issues (${stats.syntaxStyle} style)`
        );
    }
}

/**
 * Show file statistics
 */
export async function showStatistics(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') {
        vscode.window.showWarningMessage('Not a BibTeX file');
        return;
    }

    const stats = analyzeFile(editor.document);

    // Build quick pick items
    const items: vscode.QuickPickItem[] = [
        { label: `$(file) Total entries: ${stats.totalEntries}`, description: '' },
        { label: `$(symbol-keyword) Style: ${stats.syntaxStyle}`, description: '' },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
    ];

    // Add entry types
    for (const [type, count] of Array.from(stats.entryTypes.entries()).sort()) {
        items.push({
            label: `@${type}`,
            description: `${count} ${count === 1 ? 'entry' : 'entries'}`
        });
    }

    if (stats.duplicateKeys.length > 0) {
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({
            label: `$(warning) Duplicates`,
            description: stats.duplicateKeys.join(', ')
        });
    }

    if (stats.syntaxStyle === 'mixed') {
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({
            label: `$(info) BibTeX fields`,
            description: stats.bibtexFields.join(', ') || 'none'
        });
        items.push({
            label: `$(info) BibLaTeX fields`,
            description: stats.biblatexFields.join(', ') || 'none'
        });
    }

    await vscode.window.showQuickPick(items, {
        placeHolder: `BibTeX Statistics - ${stats.totalEntries} entries (${stats.syntaxStyle})`
    });
}

/**
 * Show BibTeX speed commands help
 */
export async function showBibtexHelp(): Promise<void> {
    const items = BIBTEX_SPEED_COMMANDS.map(cmd => ({
        label: cmd.key,
        description: cmd.description
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'BibTeX Speed Commands - Press key at column 0 of @entry line',
        matchOnDescription: true
    });

    if (selected) {
        const cmd = BIBTEX_SPEED_COMMANDS.find(c => c.key === selected.label);
        if (cmd) {
            await vscode.commands.executeCommand(cmd.command);
        }
    }
}

/**
 * Convert string to Title Case
 */
function toTitleCase(str: string): string {
    // Words to keep lowercase (unless first word)
    const lowercaseWords = new Set([
        'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
        'as', 'at', 'by', 'for', 'in', 'of', 'on', 'to', 'up', 'via', 'with'
    ]);

    return str.split(' ').map((word, index) => {
        // Preserve braced content (like {DNA})
        if (word.startsWith('{') && word.endsWith('}')) {
            return word;
        }

        // Preserve words with braces inside
        if (word.includes('{')) {
            return word;
        }

        const lower = word.toLowerCase();

        // First word always capitalized
        if (index === 0) {
            return word.charAt(0).toUpperCase() + lower.slice(1);
        }

        // Keep small words lowercase
        if (lowercaseWords.has(lower)) {
            return lower;
        }

        // Capitalize first letter
        return word.charAt(0).toUpperCase() + lower.slice(1);
    }).join(' ');
}

/**
 * Convert string to Sentence case
 */
function toSentenceCase(str: string): string {
    return str.split(' ').map((word, index) => {
        // Preserve braced content (like {DNA})
        if (word.startsWith('{') && word.endsWith('}')) {
            return word;
        }

        // Preserve words with braces inside
        if (word.includes('{')) {
            return word;
        }

        // First word capitalized
        if (index === 0) {
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }

        // Everything else lowercase
        return word.toLowerCase();
    }).join(' ');
}

/**
 * Setup BibTeX speed command context tracking
 */
export function setupBibtexSpeedCommandContext(context: vscode.ExtensionContext): void {
    // Track cursor position for atBibtexEntryStart context
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            const editor = e.textEditor;
            const document = editor.document;

            if (document.languageId !== 'bibtex') {
                vscode.commands.executeCommand('setContext', 'scimax.atBibtexEntryStart', false);
                return;
            }

            const position = editor.selection.active;
            const isEmpty = editor.selection.isEmpty;
            const atEntryStart = isAtBibtexEntryStart(document, position) && isEmpty;

            vscode.commands.executeCommand('setContext', 'scimax.atBibtexEntryStart', atEntryStart);
        })
    );
}

/**
 * Register all BibTeX speed commands
 */
export function registerBibtexSpeedCommands(context: vscode.ExtensionContext): void {
    // Setup context tracking
    setupBibtexSpeedCommandContext(context);

    // Navigation commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.bibtex.nextEntry', nextEntry),
        vscode.commands.registerCommand('scimax.bibtex.previousEntry', previousEntry),
        vscode.commands.registerCommand('scimax.bibtex.jumpToEntry', jumpToEntry)
    );

    // Formatting commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.bibtex.sortFields', sortFields),
        vscode.commands.registerCommand('scimax.bibtex.downcaseEntry', downcaseEntry),
        vscode.commands.registerCommand('scimax.bibtex.titleCase', titleCaseTitle),
        vscode.commands.registerCommand('scimax.bibtex.sentenceCase', sentenceCaseTitle),
        vscode.commands.registerCommand('scimax.bibtex.cleanEntry', cleanEntry)
    );

    // Access commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.bibtex.openPdf', openPdf),
        vscode.commands.registerCommand('scimax.bibtex.openUrl', openUrl),
        vscode.commands.registerCommand('scimax.bibtex.openNotes', openNotes),
        vscode.commands.registerCommand('scimax.bibtex.googleScholar', googleScholar),
        vscode.commands.registerCommand('scimax.bibtex.crossref', openCrossref),
        vscode.commands.registerCommand('scimax.bibtex.webOfScience', openWebOfScience)
    );

    // Action commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.bibtex.copyKey', copyKey),
        vscode.commands.registerCommand('scimax.bibtex.copyBibtex', copyBibtex),
        vscode.commands.registerCommand('scimax.bibtex.killEntry', killEntry),
        vscode.commands.registerCommand('scimax.bibtex.generateKey', generateKey)
    );

    // Help command
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.bibtex.help', showBibtexHelp)
    );

    // File-wide commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.bibtex.validateFile', validateFile),
        vscode.commands.registerCommand('scimax.bibtex.showStatistics', showStatistics)
    );
}
