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
        vscode.commands.registerCommand('scimax.bibtex.killEntry', killEntry)
    );

    // Help command
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.bibtex.help', showBibtexHelp)
    );
}
