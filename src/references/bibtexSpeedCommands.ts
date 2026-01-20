/**
 * BibTeX Speed Commands
 *
 * Single-key commands for navigating and manipulating BibTeX entries
 * when cursor is at column 0 of an entry line (@article, @book, etc.)
 *
 * Inspired by org-ref-bibtex.el speed keys from org-ref.
 */

import * as vscode from 'vscode';
import * as https from 'https';
import { BibEntry, parseBibTeX, entryToBibTeX, formatAuthors } from './bibtexParser';
import { getFirstAuthorKeyName } from './authorUtils';
import {
    fetchOpenAlexWork,
    fetchCitingWorks,
    fetchRelatedWorks,
    formatCitationCount,
    getOAStatusIcon,
    reconstructAbstract,
    OpenAlexWork
} from './openalexService';
import {
    getJournalAbbreviationService,
    JournalAbbreviationService,
    ABBREVIATION_SOURCES,
    AbbreviationSourceKey
} from './journalAbbreviations';

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

    // OpenAlex integration
    { key: 'C', command: 'scimax.bibtex.showCitingWorks', description: 'Show citing works (OpenAlex)' },
    { key: 'R', command: 'scimax.bibtex.showRelatedWorks', description: 'Show related works (OpenAlex)' },
    { key: 'r', command: 'scimax.bibtex.showReferences', description: 'Show references (OpenAlex)' },

    // Actions
    { key: 'y', command: 'scimax.bibtex.copyKey', description: 'Copy citation key' },
    { key: 'b', command: 'scimax.bibtex.copyBibtex', description: 'Copy BibTeX entry' },
    { key: 'k', command: 'scimax.bibtex.killEntry', description: 'Kill (delete) entry' },
    { key: 'K', command: 'scimax.bibtex.generateKey', description: 'Generate citation key' },
    { key: 'U', command: 'scimax.bibtex.updateFromWeb', description: 'Update fields from DOI/arXiv' },

    // Journal abbreviation
    { key: 'A', command: 'scimax.bibtex.toggleJournalAbbreviation', description: 'Toggle journal abbreviation' },

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
 * Wrap selected text or word at cursor in curly braces for case protection
 * Works in any file type, but designed for BibTeX
 */
export async function wrapBraces(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;

    if (!selection.isEmpty) {
        // Wrap selected text
        const selectedText = editor.document.getText(selection);
        await editor.edit(editBuilder => {
            editBuilder.replace(selection, `{${selectedText}}`);
        });
    } else {
        // Wrap word at cursor
        const wordRange = editor.document.getWordRangeAtPosition(selection.active);
        if (wordRange) {
            const word = editor.document.getText(wordRange);
            await editor.edit(editBuilder => {
                editBuilder.replace(wordRange, `{${word}}`);
            });
        } else {
            vscode.window.showWarningMessage('No word at cursor to wrap');
        }
    }
}

/**
 * Extract raw field values from BibTeX entry text, preserving inner braces
 */
function extractRawFields(entryText: string): Record<string, string> {
    const fields: Record<string, string> = {};

    // Match field = {value} or field = "value" patterns
    const fieldRegex = /(\w+)\s*=\s*/g;
    let match;

    while ((match = fieldRegex.exec(entryText)) !== null) {
        const fieldName = match[1].toLowerCase();
        const valueStart = match.index + match[0].length;

        if (valueStart >= entryText.length) continue;

        const firstChar = entryText[valueStart];
        let value: string | null = null;

        if (firstChar === '{') {
            // Extract braced value preserving inner braces
            let depth = 1;
            let i = valueStart + 1;
            while (i < entryText.length && depth > 0) {
                if (entryText[i] === '{') depth++;
                else if (entryText[i] === '}') depth--;
                i++;
            }
            if (depth === 0) {
                value = entryText.slice(valueStart + 1, i - 1);
            }
        } else if (firstChar === '"') {
            // Extract quoted value
            let i = valueStart + 1;
            while (i < entryText.length && entryText[i] !== '"') {
                if (entryText[i] === '\\' && i + 1 < entryText.length) i++;
                i++;
            }
            if (i < entryText.length) {
                value = entryText.slice(valueStart + 1, i);
            }
        } else {
            // Numeric or bare value
            const endMatch = entryText.slice(valueStart).match(/^([^,}\n]+)/);
            if (endMatch) {
                value = endMatch[1].trim();
            }
        }

        if (value !== null) {
            fields[fieldName] = value;
        }
    }

    return fields;
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

    // Extract raw fields from document text to preserve inner braces
    const entryText = document.getText(range);
    const rawFields = extractRawFields(entryText);

    // Clean fields while preserving inner braces
    const cleanedFields: Record<string, string> = {};

    for (const [field, value] of Object.entries(rawFields)) {
        // Normalize field name
        const normalizedField = field.toLowerCase();

        // Clean value - only normalize whitespace, preserve braces
        let cleanedValue = value
            // Normalize whitespace
            .replace(/\s+/g, ' ')
            .trim();

        // Remove duplicate outer braces only (e.g., {{Title}} -> {Title})
        // But preserve inner braces for case protection
        while (cleanedValue.startsWith('{') && cleanedValue.endsWith('}')) {
            // Check if the braces are balanced and wrap the entire content
            let depth = 0;
            let isOuterBrace = true;
            for (let i = 0; i < cleanedValue.length - 1; i++) {
                if (cleanedValue[i] === '{') depth++;
                else if (cleanedValue[i] === '}') depth--;
                if (depth === 0 && i < cleanedValue.length - 1) {
                    isOuterBrace = false;
                    break;
                }
            }
            if (isOuterBrace && cleanedValue.startsWith('{{')) {
                cleanedValue = cleanedValue.slice(1, -1);
            } else {
                break;
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
 * Format OpenAlex work for QuickPick display
 */
interface WorkQuickPickItem extends vscode.QuickPickItem {
    work: OpenAlexWork;
}

function formatWorkForQuickPick(work: OpenAlexWork): WorkQuickPickItem {
    // Authors
    let authors = 'Unknown';
    if (work.authorships && work.authorships.length > 0) {
        authors = work.authorships.length > 2
            ? work.authorships.slice(0, 2).map(a => a.author.display_name).join(', ') + ' et al.'
            : work.authorships.map(a => a.author.display_name).join(', ');
    }

    // OA status icon
    const oaIcon = work.open_access ? getOAStatusIcon(work.open_access.oa_status) : '';

    // Citation count
    const citations = formatCitationCount(work.cited_by_count);

    return {
        label: `$(book) ${work.title.substring(0, 70)}${work.title.length > 70 ? '...' : ''}`,
        description: `${authors} (${work.publication_year || 'n.d.'})`,
        detail: `${oaIcon} ${citations} citations | ${work.primary_location?.source?.display_name || 'Unknown source'}`,
        work
    };
}

/**
 * Show actions for a selected OpenAlex work
 */
async function showWorkActions(work: OpenAlexWork): Promise<void> {
    const doi = work.doi?.replace('https://doi.org/', '');

    const actions: Array<{ label: string; description?: string; action: string }> = [
        { label: '$(link-external) Open DOI', description: doi, action: 'doi' },
        { label: '$(search) View Citing Works', description: `${work.cited_by_count} citations`, action: 'citing' },
        { label: '$(references) View Related Works', action: 'related' },
        { label: '$(clippy) Copy BibTeX', action: 'bibtex' }
    ];

    if (work.open_access?.oa_url) {
        actions.splice(1, 0, {
            label: '$(file-pdf) Open PDF',
            description: 'Open Access',
            action: 'pdf'
        });
    }

    const selected = await vscode.window.showQuickPick(actions, {
        placeHolder: work.title
    });

    if (!selected) return;

    switch (selected.action) {
        case 'doi':
            if (doi) {
                await vscode.env.openExternal(vscode.Uri.parse(`https://doi.org/${doi}`));
            }
            break;

        case 'pdf':
            if (work.open_access?.oa_url) {
                await vscode.env.openExternal(vscode.Uri.parse(work.open_access.oa_url));
            }
            break;

        case 'citing':
            if (work.id) {
                await showCitingWorksForWork(work);
            }
            break;

        case 'related':
            if (work.related_works && work.related_works.length > 0) {
                await showRelatedWorksForWork(work);
            } else {
                vscode.window.showInformationMessage('No related works available');
            }
            break;

        case 'bibtex':
            const bibtex = generateBibTeXFromOpenAlex(work);
            await vscode.env.clipboard.writeText(bibtex);
            vscode.window.showInformationMessage('BibTeX copied to clipboard');
            break;
    }
}

/**
 * Generate BibTeX from OpenAlex work
 */
function generateBibTeXFromOpenAlex(work: OpenAlexWork): string {
    const doi = work.doi?.replace('https://doi.org/', '');
    const firstAuthor = work.authorships?.[0]?.author.display_name.split(' ').pop() || 'unknown';
    const key = `${firstAuthor.toLowerCase()}${work.publication_year || ''}`;

    const type = work.type === 'book' ? 'book' : 'article';

    const fields: string[] = [];
    fields.push(`  title = {${work.title}}`);

    if (work.authorships && work.authorships.length > 0) {
        const authors = work.authorships.map(a => a.author.display_name).join(' and ');
        fields.push(`  author = {${authors}}`);
    }

    if (work.publication_year) {
        fields.push(`  year = {${work.publication_year}}`);
    }

    if (work.primary_location?.source?.display_name) {
        fields.push(`  journal = {${work.primary_location.source.display_name}}`);
    }

    if (work.biblio) {
        if (work.biblio.volume) fields.push(`  volume = {${work.biblio.volume}}`);
        if (work.biblio.issue) fields.push(`  number = {${work.biblio.issue}}`);
        if (work.biblio.first_page) {
            const pages = work.biblio.last_page
                ? `${work.biblio.first_page}--${work.biblio.last_page}`
                : work.biblio.first_page;
            fields.push(`  pages = {${pages}}`);
        }
    }

    if (doi) {
        fields.push(`  doi = {${doi}}`);
    }

    if (work.open_access?.oa_url) {
        fields.push(`  url = {${work.open_access.oa_url}}`);
    }

    return `@${type}{${key},\n${fields.join(',\n')}\n}`;
}

/**
 * Show citing works for a work (recursive navigation)
 */
async function showCitingWorksForWork(work: OpenAlexWork): Promise<void> {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Fetching citing works...',
        cancellable: false
    }, async () => {
        const citingWorks = await fetchCitingWorks(work.id, 25);

        if (citingWorks.length === 0) {
            vscode.window.showInformationMessage('No citing works found');
            return;
        }

        const items = citingWorks.map(w => formatWorkForQuickPick(w));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `${work.cited_by_count} total citations - showing top ${citingWorks.length}`,
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            await showWorkActions(selected.work);
        }
    });
}

/**
 * Show related works for a work (recursive navigation)
 */
async function showRelatedWorksForWork(work: OpenAlexWork): Promise<void> {
    if (!work.related_works || work.related_works.length === 0) {
        vscode.window.showInformationMessage('No related works available');
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Fetching related works...',
        cancellable: false
    }, async () => {
        const relatedWorks = await fetchRelatedWorks(work.related_works!, 10);

        if (relatedWorks.length === 0) {
            vscode.window.showInformationMessage('Could not fetch related works');
            return;
        }

        const items = relatedWorks.map(w => formatWorkForQuickPick(w));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Related works for "${work.title.substring(0, 50)}..."`,
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            await showWorkActions(selected.work);
        }
    });
}

/**
 * Show works that cite this entry (via OpenAlex)
 */
export async function showCitingWorks(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const entry = getEntryAtPosition(editor.document, editor.selection.active);
    if (!entry) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    const doi = entry.doi || entry.fields.doi;
    if (!doi) {
        vscode.window.showWarningMessage('Entry has no DOI - required for OpenAlex lookup');
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Fetching citing works from OpenAlex...',
        cancellable: false
    }, async () => {
        // First get the work to find its OpenAlex ID
        const work = await fetchOpenAlexWork(doi);
        if (!work) {
            vscode.window.showWarningMessage(`Work not found in OpenAlex: ${doi}`);
            return;
        }

        // Fetch citing works
        const citingWorks = await fetchCitingWorks(work.id, 25);

        if (citingWorks.length === 0) {
            vscode.window.showInformationMessage(`No citing works found for ${entry.key}`);
            return;
        }

        // Show in QuickPick
        const items = citingWorks.map(w => formatWorkForQuickPick(w));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `${work.cited_by_count} total citations of ${entry.key} - showing top ${citingWorks.length}`,
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            await showWorkActions(selected.work);
        }
    });
}

/**
 * Show related works for this entry (via OpenAlex)
 */
export async function showRelatedWorks(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const entry = getEntryAtPosition(editor.document, editor.selection.active);
    if (!entry) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    const doi = entry.doi || entry.fields.doi;
    if (!doi) {
        vscode.window.showWarningMessage('Entry has no DOI - required for OpenAlex lookup');
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Fetching related works from OpenAlex...',
        cancellable: false
    }, async () => {
        const work = await fetchOpenAlexWork(doi);
        if (!work) {
            vscode.window.showWarningMessage(`Work not found in OpenAlex: ${doi}`);
            return;
        }

        if (!work.related_works || work.related_works.length === 0) {
            vscode.window.showInformationMessage(`No related works found for ${entry.key}`);
            return;
        }

        const relatedWorks = await fetchRelatedWorks(work.related_works, 10);

        if (relatedWorks.length === 0) {
            vscode.window.showInformationMessage('Could not fetch related works');
            return;
        }

        const items = relatedWorks.map(w => formatWorkForQuickPick(w));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Related works for ${entry.key}`,
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            await showWorkActions(selected.work);
        }
    });
}

/**
 * Show references (works cited by this entry) via OpenAlex
 */
export async function showReferences(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const entry = getEntryAtPosition(editor.document, editor.selection.active);
    if (!entry) {
        vscode.window.showWarningMessage('Not in a BibTeX entry');
        return;
    }

    const doi = entry.doi || entry.fields.doi;
    if (!doi) {
        vscode.window.showWarningMessage('Entry has no DOI - required for OpenAlex lookup');
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Fetching references from OpenAlex...',
        cancellable: false
    }, async () => {
        const work = await fetchOpenAlexWork(doi);
        if (!work) {
            vscode.window.showWarningMessage(`Work not found in OpenAlex: ${doi}`);
            return;
        }

        if (!work.referenced_works || work.referenced_works.length === 0) {
            vscode.window.showInformationMessage(`No references found for ${entry.key}`);
            return;
        }

        // Fetch the referenced works
        const referencedWorks = await fetchRelatedWorks(work.referenced_works, 25);

        if (referencedWorks.length === 0) {
            vscode.window.showInformationMessage('Could not fetch references');
            return;
        }

        const items = referencedWorks.map(w => formatWorkForQuickPick(w));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `${work.referenced_works.length} references in ${entry.key} - showing ${referencedWorks.length}`,
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            await showWorkActions(selected.work);
        }
    });
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

    // Extract components for key using citation-js for proper BibTeX name parsing
    const lastName = getFirstAuthorKeyName(entry.author || entry.fields.editor || '');

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

interface CrossRefSearchResult {
    doi: string;
    title: string;
    author: string;
    year: string;
    journal?: string;
    type: string;
    score: number;
}

/**
 * Search CrossRef by title/author and return multiple results
 */
async function searchCrossRef(query: string, author?: string): Promise<CrossRefSearchResult[]> {
    return new Promise((resolve, reject) => {
        // Build query - prioritize author+title combination
        let searchQuery = encodeURIComponent(query);
        if (author) {
            searchQuery = `query.title=${encodeURIComponent(query)}&query.author=${encodeURIComponent(author)}`;
        } else {
            searchQuery = `query=${encodeURIComponent(query)}`;
        }

        const options = {
            hostname: 'api.crossref.org',
            path: `/works?${searchQuery}&rows=10&select=DOI,title,author,issued,container-title,type,score`,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'scimax-vscode/1.0 (https://github.com/jkitchin/scimax_vscode)'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        const items = json.message?.items || [];
                        const results: CrossRefSearchResult[] = items.map((item: any) => {
                            // Format authors
                            const authors = item.author || [];
                            const authorStr = authors
                                .slice(0, 3)
                                .map((a: any) => a.family || a.name || 'Unknown')
                                .join(', ');

                            // Get year from issued date
                            const dateParts = item.issued?.['date-parts']?.[0] || [];
                            const year = dateParts[0]?.toString() || '';

                            return {
                                doi: item.DOI,
                                title: Array.isArray(item.title) ? item.title[0] : item.title || 'Untitled',
                                author: authorStr + (authors.length > 3 ? ' et al.' : ''),
                                year,
                                journal: Array.isArray(item['container-title'])
                                    ? item['container-title'][0]
                                    : item['container-title'],
                                type: item.type || 'unknown',
                                score: item.score || 0
                            };
                        });
                        resolve(results);
                    } catch {
                        resolve([]);
                    }
                } else {
                    resolve([]);
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });

        req.end();
    });
}

/**
 * Fetch BibTeX entry from CrossRef using DOI
 */
async function fetchFromCrossRef(doi: string): Promise<BibEntry | null> {
    // Clean DOI
    doi = doi.replace(/^https?:\/\/doi\.org\//, '').trim();

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.crossref.org',
            path: `/works/${encodeURIComponent(doi)}/transform/application/x-bibtex`,
            method: 'GET',
            headers: {
                'Accept': 'application/x-bibtex',
                'User-Agent': 'scimax-vscode/1.0 (https://github.com/jkitchin/scimax_vscode)'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    const result = parseBibTeX(data);
                    if (result.entries.length > 0) {
                        resolve(result.entries[0]);
                    } else {
                        resolve(null);
                    }
                } else if (res.statusCode === 404) {
                    resolve(null);
                } else {
                    reject(new Error(`CrossRef returned status ${res.statusCode}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });

        req.end();
    });
}

/**
 * Fetch BibTeX entry from arXiv API using eprint ID
 */
async function fetchFromArxiv(arxivId: string): Promise<BibEntry | null> {
    // Clean arXiv ID (handle various formats)
    arxivId = arxivId
        .replace(/^https?:\/\/arxiv\.org\/abs\//, '')
        .replace(/^arXiv:/, '')
        .replace(/v\d+$/, '') // Remove version suffix
        .trim();

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'export.arxiv.org',
            path: `/api/query?id_list=${encodeURIComponent(arxivId)}`,
            method: 'GET',
            headers: {
                'User-Agent': 'scimax-vscode/1.0 (https://github.com/jkitchin/scimax_vscode)'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    const entry = parseArxivResponse(data, arxivId);
                    resolve(entry);
                } else {
                    resolve(null);
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });

        req.end();
    });
}

/**
 * Parse arXiv API XML response into a BibEntry
 */
function parseArxivResponse(xml: string, arxivId: string): BibEntry | null {
    // Simple XML parsing for arXiv response
    const getTagContent = (tag: string): string | undefined => {
        const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
        const match = xml.match(regex);
        return match ? match[1].trim() : undefined;
    };

    const getAllTagContents = (tag: string): string[] => {
        const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
        const matches: string[] = [];
        let match;
        while ((match = regex.exec(xml)) !== null) {
            matches.push(match[1].trim());
        }
        return matches;
    };

    // Check if entry was found
    if (xml.includes('<opensearch:totalResults>0</opensearch:totalResults>')) {
        return null;
    }

    const title = getTagContent('title');
    if (!title) return null;

    // Get authors (in <author><name>...</name></author> format)
    const authorNames = getAllTagContents('name');
    const authors = authorNames.length > 0 ? authorNames.join(' and ') : undefined;

    // Get published date
    const published = getTagContent('published');
    const year = published ? published.substring(0, 4) : undefined;

    // Get abstract
    const summary = getTagContent('summary');
    const abstract = summary?.replace(/\s+/g, ' ').trim();

    // Get DOI if present
    const doiLink = xml.match(/href="https?:\/\/dx\.doi\.org\/([^"]+)"/);
    const doi = doiLink ? doiLink[1] : undefined;

    // Get primary category
    const primaryCategory = xml.match(/term="([^"]+)"[^>]*scheme="http:\/\/arxiv\.org\/schemas\/atom"/);
    const category = primaryCategory ? primaryCategory[1] : undefined;

    // Build the entry
    const entry: BibEntry = {
        key: arxivId.replace(/[^a-zA-Z0-9]/g, '_'),
        type: 'article',
        fields: {
            title: title.replace(/\s+/g, ' ').trim(),
            eprint: arxivId,
            archiveprefix: 'arXiv',
            eprinttype: 'arxiv',
        },
        raw: ''
    };

    if (authors) entry.fields.author = authors;
    if (year) entry.fields.year = year;
    if (abstract) entry.fields.abstract = abstract;
    if (doi) entry.fields.doi = doi;
    if (category) entry.fields.primaryclass = category;

    // Copy common fields to top-level
    entry.author = entry.fields.author;
    entry.title = entry.fields.title;
    entry.year = entry.fields.year;
    entry.doi = entry.fields.doi;
    entry.abstract = entry.fields.abstract;

    return entry;
}

/**
 * Update entry fields from web sources (CrossRef/arXiv)
 * Preserves the citation key and only fills in missing fields
 */
export async function updateFromWeb(): Promise<void> {
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

    // Determine source based on available identifiers
    let fetchedEntry: BibEntry | null = null;
    let source = '';

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Fetching metadata...',
        cancellable: false
    }, async () => {
        // Try DOI first (most reliable)
        if (entry.doi || entry.fields.doi) {
            const doi = entry.doi || entry.fields.doi;
            source = 'CrossRef';
            try {
                fetchedEntry = await fetchFromCrossRef(doi);
            } catch (e) {
                // Fall through to try arXiv
            }
        }

        // Try arXiv if no DOI result
        if (!fetchedEntry && (entry.fields.eprint || entry.fields.arxivid)) {
            const arxivId = entry.fields.eprint || entry.fields.arxivid;
            source = 'arXiv';
            try {
                fetchedEntry = await fetchFromArxiv(arxivId);
            } catch {
                // Continue
            }
        }

        // Try to extract arXiv ID from URL field
        if (!fetchedEntry && entry.url) {
            const arxivMatch = entry.url.match(/arxiv\.org\/abs\/([^\s/]+)/);
            if (arxivMatch) {
                source = 'arXiv';
                try {
                    fetchedEntry = await fetchFromArxiv(arxivMatch[1]);
                } catch {
                    // Continue
                }
            }
        }
    });

    // If still no result, try CrossRef search by title/author
    if (!fetchedEntry && (entry.title || entry.author)) {
        const searchResults = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Searching CrossRef...',
            cancellable: false
        }, async () => {
            try {
                return await searchCrossRef(entry.title || '', entry.author);
            } catch {
                return [];
            }
        });

        if (searchResults.length > 0) {
            // Let user choose from results
            const items = searchResults.map((r, idx) => ({
                label: r.title.length > 60 ? r.title.substring(0, 60) + '...' : r.title,
                description: `${r.author} (${r.year || 'n.d.'})`,
                detail: r.journal ? `${r.journal} | DOI: ${r.doi}` : `DOI: ${r.doi}`,
                result: r
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Found ${searchResults.length} result(s) - select the correct one`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                // Fetch full entry using the DOI
                source = 'CrossRef';
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Fetching full metadata...',
                    cancellable: false
                }, async () => {
                    try {
                        fetchedEntry = await fetchFromCrossRef(selected.result.doi);
                    } catch {
                        // Failed to fetch
                    }
                });
            }
        }
    }

    if (!fetchedEntry) {
        vscode.window.showWarningMessage(
            'Could not fetch metadata. Try adding a DOI or arXiv ID to the entry.'
        );
        return;
    }

    // TypeScript doesn't track assignments in async callbacks well, so use assertion
    const fetched = fetchedEntry as BibEntry;

    // Find fields to update (only update empty/missing fields)
    const updates: { field: string; oldValue: string; newValue: string }[] = [];
    const fieldsToCheck = [
        'author', 'title', 'journal', 'journaltitle', 'booktitle',
        'year', 'volume', 'number', 'pages', 'publisher', 'doi',
        'url', 'abstract', 'issn', 'isbn'
    ];

    for (const field of fieldsToCheck) {
        const currentValue = entry.fields[field]?.trim() || '';
        const newValue = fetched.fields[field]?.trim() || '';

        if (!currentValue && newValue) {
            updates.push({ field, oldValue: currentValue, newValue });
        }
    }

    if (updates.length === 0) {
        vscode.window.showInformationMessage(
            `No missing fields to update from ${source}`
        );
        return;
    }

    // Show what will be updated
    const items = updates.map(u => ({
        label: u.field,
        description: u.newValue.length > 50 ? u.newValue.substring(0, 50) + '...' : u.newValue,
        picked: true,
        update: u
    }));

    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: `Select fields to update from ${source} (${updates.length} available)`
    });

    if (!selected || selected.length === 0) return;

    // Build updated entry
    const updatedFields = { ...entry.fields };
    for (const item of selected) {
        updatedFields[item.update.field] = item.update.newValue;
    }

    // Sort and rebuild the entry (preserve the original key!)
    const sortedFields: [string, string][] = [];

    for (const field of BIBTEX_FIELD_ORDER) {
        if (updatedFields[field] !== undefined) {
            sortedFields.push([field, updatedFields[field]]);
            delete updatedFields[field];
        }
    }

    // Add remaining fields
    for (const [field, value] of Object.entries(updatedFields)) {
        sortedFields.push([field, value]);
    }

    // Build new entry text (preserve the original key)
    let newEntry = `@${entry.type.toLowerCase()}{${entry.key},\n`;
    for (const [field, value] of sortedFields) {
        newEntry += `  ${field} = {${value}},\n`;
    }
    newEntry += '}';

    await editor.edit(editBuilder => {
        editBuilder.replace(range, newEntry);
    });

    vscode.window.showInformationMessage(
        `Updated ${selected.length} field(s) from ${source}: ${selected.map(s => s.label).join(', ')}`
    );
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
 * Sort criteria for BibTeX entries
 */
type SortCriteria = 'key' | 'year' | 'author';

/**
 * Sort all entries in the BibTeX file
 * User selects sort criteria from a menu
 */
export async function sortEntries(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') {
        vscode.window.showWarningMessage('Not a BibTeX file');
        return;
    }

    // Show sort options menu
    const sortOptions: Array<{ label: string; description: string; criteria: SortCriteria }> = [
        { label: '$(key) By Key', description: 'Sort alphabetically by citation key', criteria: 'key' },
        { label: '$(calendar) By Year', description: 'Sort by publication year (oldest first)', criteria: 'year' },
        { label: '$(person) By Author', description: 'Sort alphabetically by first author last name', criteria: 'author' },
    ];

    const selected = await vscode.window.showQuickPick(sortOptions, {
        placeHolder: 'Select sort order for BibTeX entries',
        matchOnDescription: true,
    });

    if (!selected) {
        return; // User cancelled
    }

    const document = editor.document;
    const text = document.getText();
    const result = parseBibTeX(text);

    if (result.entries.length === 0) {
        vscode.window.showInformationMessage('No BibTeX entries found');
        return;
    }

    // Sort entries based on selected criteria
    const sortedEntries = [...result.entries].sort((a, b) => {
        switch (selected.criteria) {
            case 'key':
                return a.key.toLowerCase().localeCompare(b.key.toLowerCase());

            case 'year': {
                const yearA = parseInt(a.year || '9999', 10);
                const yearB = parseInt(b.year || '9999', 10);
                // If years are equal, sort by key as secondary
                if (yearA === yearB) {
                    return a.key.toLowerCase().localeCompare(b.key.toLowerCase());
                }
                return yearA - yearB;
            }

            case 'author': {
                const authorA = getFirstAuthorKeyName(a.author || a.fields.editor || '');
                const authorB = getFirstAuthorKeyName(b.author || b.fields.editor || '');
                // If authors are equal, sort by year, then key
                if (authorA === authorB) {
                    const yearA = parseInt(a.year || '9999', 10);
                    const yearB = parseInt(b.year || '9999', 10);
                    if (yearA === yearB) {
                        return a.key.toLowerCase().localeCompare(b.key.toLowerCase());
                    }
                    return yearA - yearB;
                }
                return authorA.localeCompare(authorB);
            }

            default:
                return 0;
        }
    });

    // Find any content before the first entry (preambles, comments, @string definitions)
    const firstEntryMatch = text.match(/@\w+\s*\{/);
    const preamble = firstEntryMatch ? text.substring(0, firstEntryMatch.index).trim() : '';

    // Rebuild the file with sorted entries
    let newContent = preamble ? preamble + '\n\n' : '';

    for (let i = 0; i < sortedEntries.length; i++) {
        const entry = sortedEntries[i];
        newContent += entryToBibTeX(entry);
        if (i < sortedEntries.length - 1) {
            newContent += '\n';
        }
    }

    // Replace entire document content
    const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length)
    );

    await editor.edit(editBuilder => {
        editBuilder.replace(fullRange, newContent);
    });

    const criteriaLabel = selected.criteria === 'key' ? 'key' :
                          selected.criteria === 'year' ? 'year' : 'author';
    vscode.window.showInformationMessage(
        `Sorted ${sortedEntries.length} entries by ${criteriaLabel}`
    );
}

/**
 * Operation types for batch processing
 */
type BatchOperation = 'clean' | 'titleCase' | 'sentenceCase' | 'standardizeKey' | 'sortFields' | 'downcase';

/**
 * Apply a transformation to a single entry and return the new entry text
 */
function transformEntry(entry: BibEntry, entryText: string, operation: BatchOperation): string {
    switch (operation) {
        case 'clean': {
            // Clean entry: normalize whitespace, sort fields, lowercase field names
            const rawFields = extractRawFields(entryText);
            const cleanedFields: Record<string, string> = {};

            for (const [field, value] of Object.entries(rawFields)) {
                const normalizedField = field.toLowerCase();
                let cleanedValue = value.replace(/\s+/g, ' ').trim();

                // Remove duplicate outer braces
                while (cleanedValue.startsWith('{') && cleanedValue.endsWith('}')) {
                    let depth = 0;
                    let isOuterBrace = true;
                    for (let i = 0; i < cleanedValue.length - 1; i++) {
                        if (cleanedValue[i] === '{') depth++;
                        else if (cleanedValue[i] === '}') depth--;
                        if (depth === 0 && i < cleanedValue.length - 1) {
                            isOuterBrace = false;
                            break;
                        }
                    }
                    if (isOuterBrace && cleanedValue.startsWith('{{')) {
                        cleanedValue = cleanedValue.slice(1, -1);
                    } else {
                        break;
                    }
                }
                cleanedFields[normalizedField] = cleanedValue;
            }

            // Sort fields
            const sortedFields: [string, string][] = [];
            for (const field of BIBTEX_FIELD_ORDER) {
                if (cleanedFields[field] !== undefined) {
                    sortedFields.push([field, cleanedFields[field]]);
                    delete cleanedFields[field];
                }
            }
            for (const [field, value] of Object.entries(cleanedFields)) {
                sortedFields.push([field, value]);
            }

            let newEntry = `@${entry.type.toLowerCase()}{${entry.key},\n`;
            for (const [field, value] of sortedFields) {
                newEntry += `  ${field} = {${value}},\n`;
            }
            newEntry += '}';
            return newEntry;
        }

        case 'titleCase': {
            // Convert title to Title Case
            return entryText.replace(
                /(\btitle\s*=\s*\{)([^}]+)(\})/gi,
                (_, prefix, title, suffix) => `${prefix}${toTitleCase(title)}${suffix}`
            );
        }

        case 'sentenceCase': {
            // Convert title to sentence case
            return entryText.replace(
                /(\btitle\s*=\s*\{)([^}]+)(\})/gi,
                (_, prefix, title, suffix) => `${prefix}${toSentenceCase(title)}${suffix}`
            );
        }

        case 'standardizeKey': {
            // Generate a new standardized key
            const newKey = getFirstAuthorKeyName(entry.author || entry.fields.editor || '');
            const year = entry.year || '';
            const titleWords = (entry.title || '')
                .toLowerCase()
                .replace(/[^a-z\s]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 3 && !['the', 'and', 'for', 'with', 'from'].includes(w));
            const titleWord = titleWords[0] || 'untitled';
            const standardKey = `${newKey}${year}${titleWord}`;

            // Replace the key in the entry text
            return entryText.replace(
                /^(@\w+\s*\{)\s*[^,\s]+/,
                `$1${standardKey}`
            );
        }

        case 'sortFields': {
            // Sort fields in standard order
            const rawFields = extractRawFields(entryText);
            const sortedFields: [string, string][] = [];
            const seenFields = new Set<string>();

            for (const field of BIBTEX_FIELD_ORDER) {
                const value = rawFields[field.toLowerCase()] || rawFields[field];
                if (value !== undefined) {
                    sortedFields.push([field.toLowerCase(), value]);
                    seenFields.add(field.toLowerCase());
                }
            }

            for (const [field, value] of Object.entries(rawFields)) {
                if (!seenFields.has(field.toLowerCase())) {
                    sortedFields.push([field.toLowerCase(), value]);
                }
            }

            let newEntry = `@${entry.type.toLowerCase()}{${entry.key},\n`;
            for (const [field, value] of sortedFields) {
                newEntry += `  ${field} = {${value}},\n`;
            }
            newEntry += '}';
            return newEntry;
        }

        case 'downcase': {
            // Lowercase entry type and field names
            return entryText
                .replace(/^@(\w+)/i, (_, type) => `@${type.toLowerCase()}`)
                .replace(/^\s*(\w+)\s*=/gm, (_, field) => `  ${field.toLowerCase()} =`);
        }

        default:
            return entryText;
    }
}

/**
 * Apply an operation to all entries in the BibTeX file
 * User selects the operation from a menu
 */
export async function applyToAllEntries(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') {
        vscode.window.showWarningMessage('Not a BibTeX file');
        return;
    }

    // Show operation menu
    const operations: Array<{ label: string; description: string; operation: BatchOperation }> = [
        { label: '$(tools) Clean Entries', description: 'Normalize whitespace, sort fields, lowercase field names', operation: 'clean' },
        { label: '$(text-size) Title Case Titles', description: 'Convert titles to Title Case', operation: 'titleCase' },
        { label: '$(whole-word) Sentence Case Titles', description: 'Convert titles to sentence case', operation: 'sentenceCase' },
        { label: '$(key) Standardize Keys', description: 'Regenerate keys as author-year-word format', operation: 'standardizeKey' },
        { label: '$(list-ordered) Sort Fields', description: 'Reorder fields in standard BibTeX order', operation: 'sortFields' },
        { label: '$(case-sensitive) Downcase Entries', description: 'Lowercase entry types and field names', operation: 'downcase' },
    ];

    const selected = await vscode.window.showQuickPick(operations, {
        placeHolder: 'Select operation to apply to all entries',
        matchOnDescription: true,
    });

    if (!selected) {
        return; // User cancelled
    }

    const document = editor.document;
    const text = document.getText();
    const result = parseBibTeX(text);

    if (result.entries.length === 0) {
        vscode.window.showInformationMessage('No BibTeX entries found');
        return;
    }

    // Confirm with user for destructive operations
    if (selected.operation === 'standardizeKey') {
        const confirm = await vscode.window.showWarningMessage(
            `This will regenerate keys for ${result.entries.length} entries. This may break existing citations. Continue?`,
            { modal: true },
            'Yes', 'No'
        );
        if (confirm !== 'Yes') {
            return;
        }
    }

    // Find all entry ranges and transform them
    // We need to work with the raw text to preserve formatting
    const entryPattern = /@(\w+)\s*\{([^,\s]+)\s*,/g;
    const entryStarts: { index: number; type: string; key: string }[] = [];
    let match;

    while ((match = entryPattern.exec(text)) !== null) {
        const type = match[1].toLowerCase();
        // Skip @string, @preamble, @comment
        if (!['string', 'preamble', 'comment'].includes(type)) {
            entryStarts.push({
                index: match.index,
                type: match[1],
                key: match[2]
            });
        }
    }

    // Find end of each entry by matching braces
    const entryRanges: { start: number; end: number; text: string }[] = [];
    for (const start of entryStarts) {
        let braceCount = 0;
        let foundStart = false;
        let endIndex = start.index;

        for (let i = start.index; i < text.length; i++) {
            if (text[i] === '{') {
                braceCount++;
                foundStart = true;
            } else if (text[i] === '}') {
                braceCount--;
            }

            if (foundStart && braceCount === 0) {
                endIndex = i + 1;
                break;
            }
        }

        entryRanges.push({
            start: start.index,
            end: endIndex,
            text: text.substring(start.index, endIndex)
        });
    }

    // Track keys to detect duplicates when standardizing
    const usedKeys = new Set<string>();
    let duplicateCount = 0;

    // Transform each entry
    const transformedEntries: string[] = [];
    for (let i = 0; i < entryRanges.length; i++) {
        const range = entryRanges[i];
        const entry = result.entries[i];

        if (!entry) {
            transformedEntries.push(range.text);
            continue;
        }

        let transformed = transformEntry(entry, range.text, selected.operation);

        // Handle duplicate keys when standardizing
        if (selected.operation === 'standardizeKey') {
            const keyMatch = transformed.match(/^@\w+\s*\{\s*([^,\s]+)/);
            if (keyMatch) {
                let newKey = keyMatch[1];
                let suffix = '';
                let counter = 0;

                while (usedKeys.has(newKey + suffix)) {
                    counter++;
                    suffix = String.fromCharCode(96 + counter); // a, b, c, ...
                    duplicateCount++;
                }

                if (suffix) {
                    transformed = transformed.replace(
                        /^(@\w+\s*\{)\s*[^,\s]+/,
                        `$1${newKey}${suffix}`
                    );
                }
                usedKeys.add(newKey + suffix);
            }
        }

        transformedEntries.push(transformed);
    }

    // Find content before first entry (preambles, comments)
    const firstEntryStart = entryRanges.length > 0 ? entryRanges[0].start : text.length;
    const preamble = text.substring(0, firstEntryStart).trim();

    // Rebuild the file
    let newContent = preamble ? preamble + '\n\n' : '';
    newContent += transformedEntries.join('\n\n');

    // Replace entire document
    const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length)
    );

    await editor.edit(editBuilder => {
        editBuilder.replace(fullRange, newContent);
    });

    let message = `Applied "${selected.label.replace(/\$\([^)]+\)\s*/g, '')}" to ${result.entries.length} entries`;
    if (duplicateCount > 0) {
        message += ` (${duplicateCount} duplicate keys resolved with suffixes)`;
    }
    vscode.window.showInformationMessage(message);
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

// ============================================================================
// Journal Abbreviation Commands
// ============================================================================

/**
 * Service instance - lazy initialized
 */
let journalAbbrevService: JournalAbbreviationService | undefined;

/**
 * Get or initialize the journal abbreviation service
 */
async function getAbbrevService(context: vscode.ExtensionContext): Promise<JournalAbbreviationService> {
    if (!journalAbbrevService) {
        journalAbbrevService = getJournalAbbreviationService(context);
        await journalAbbrevService.initialize();
    }
    return journalAbbrevService;
}

/**
 * Toggle journal abbreviation for current entry
 * Switches between full journal name and abbreviated form
 */
async function toggleJournalAbbreviation(context: vscode.ExtensionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const document = editor.document;
    const position = editor.selection.active;
    const entryRange = getEntryRange(document, position);

    if (!entryRange) {
        vscode.window.showWarningMessage('Cursor not in a BibTeX entry');
        return;
    }

    const entryText = document.getText(entryRange);
    const result = parseBibTeX(entryText);

    if (result.entries.length === 0) {
        vscode.window.showWarningMessage('Could not parse BibTeX entry');
        return;
    }

    const entry = result.entries[0];
    const journalField = entry.fields.journal || entry.fields.journaltitle;

    if (!journalField) {
        vscode.window.showWarningMessage('Entry has no journal field');
        return;
    }

    const service = await getAbbrevService(context);
    const toggleResult = service.toggle(journalField);

    if (!toggleResult) {
        // Not found - offer to add custom abbreviation
        const action = await vscode.window.showWarningMessage(
            `Journal "${journalField}" not found in abbreviation database`,
            'Add Custom Abbreviation',
            'Search Database'
        );

        if (action === 'Add Custom Abbreviation') {
            await addCustomAbbreviationDialog(context, journalField);
        } else if (action === 'Search Database') {
            await searchJournalAbbreviations(context);
        }
        return;
    }

    // Find and replace the journal field in the entry text
    const fieldName = entry.fields.journal ? 'journal' : 'journaltitle';

    // Regex to match journal = {value} or journal = "value"
    const journalRegex = new RegExp(
        `(${fieldName}\\s*=\\s*)(?:\\{([^{}]*(?:\\{[^{}]*\\}[^{}]*)*)\\}|"([^"]*)")`,
        'i'
    );

    const match = entryText.match(journalRegex);
    if (!match) {
        vscode.window.showWarningMessage('Could not locate journal field in entry');
        return;
    }

    const newEntryText = entryText.replace(
        journalRegex,
        `$1{${toggleResult.result}}`
    );

    await editor.edit(editBuilder => {
        editBuilder.replace(entryRange, newEntryText);
    });

    const action = toggleResult.wasAbbreviated ? 'Expanded' : 'Abbreviated';
    vscode.window.showInformationMessage(`${action}: "${toggleResult.result}"`);
}

/**
 * Toggle journal abbreviations for all entries in the file
 * Validates BibTeX syntax before and after changes
 */
async function toggleAllJournalAbbreviations(context: vscode.ExtensionContext, abbreviate: boolean): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'bibtex') return;

    const document = editor.document;
    const text = document.getText();
    const result = parseBibTeX(text);

    if (result.entries.length === 0) {
        vscode.window.showWarningMessage('No BibTeX entries found');
        return;
    }

    // Validate syntax before starting
    if (result.errors.length > 0) {
        const proceed = await vscode.window.showWarningMessage(
            `File has ${result.errors.length} parse error(s). Proceed anyway?`,
            'Proceed',
            'Cancel'
        );
        if (proceed !== 'Proceed') return;
    }

    const service = await getAbbrevService(context);
    let changed = 0;
    let notFound: string[] = [];

    // We need to process entries from bottom to top to maintain correct ranges
    let newText = text;

    for (const entry of result.entries.reverse()) {
        const journalField = entry.fields.journal || entry.fields.journaltitle;
        if (!journalField) continue;

        const entryInfo = service.getEntry(journalField);
        if (!entryInfo) {
            notFound.push(journalField);
            continue;
        }

        // Determine if we need to change
        const isCurrentlyAbbreviated = service.getFullName(journalField) !== undefined;

        if (abbreviate && !isCurrentlyAbbreviated) {
            // Need to abbreviate
            const abbrev = service.getAbbreviation(journalField);
            if (abbrev) {
                newText = replaceJournalInEntry(newText, entry.raw, journalField, abbrev);
                changed++;
            }
        } else if (!abbreviate && isCurrentlyAbbreviated) {
            // Need to expand
            const full = service.getFullName(journalField);
            if (full) {
                newText = replaceJournalInEntry(newText, entry.raw, journalField, full);
                changed++;
            }
        }
    }

    if (changed > 0) {
        // Validate the new text before applying
        const newResult = parseBibTeX(newText);
        if (newResult.entries.length !== result.entries.length) {
            vscode.window.showErrorMessage(
                `Validation failed: modified text has ${newResult.entries.length} entries, original has ${result.entries.length}. Changes not applied.`
            );
            return;
        }

        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(text.length)
        );
        await editor.edit(editBuilder => {
            editBuilder.replace(fullRange, newText);
        });

        // Verify after edit
        const afterText = document.getText();
        const afterResult = parseBibTeX(afterText);
        if (afterResult.errors.length > result.errors.length) {
            vscode.window.showWarningMessage(
                `Warning: new parse errors detected after changes. Use Ctrl+Z to undo.`
            );
        }
    }

    let message = `${abbreviate ? 'Abbreviated' : 'Expanded'} ${changed} journal(s)`;
    if (notFound.length > 0) {
        message += `. ${notFound.length} not found in database`;
    }
    vscode.window.showInformationMessage(message);
}

/**
 * Replace journal name in an entry's raw text
 */
function replaceJournalInEntry(fullText: string, entryRaw: string, oldJournal: string, newJournal: string): string {
    // Find the entry in the full text
    const entryStart = fullText.indexOf(entryRaw);
    if (entryStart === -1) return fullText;

    // Replace in the entry
    const journalRegex = new RegExp(
        `(journal(?:title)?\\s*=\\s*)(?:\\{${escapeRegExp(oldJournal)}\\}|"${escapeRegExp(oldJournal)}")`,
        'i'
    );
    const newEntry = entryRaw.replace(journalRegex, `$1{${newJournal}}`);

    return fullText.slice(0, entryStart) + newEntry + fullText.slice(entryStart + entryRaw.length);
}

/**
 * Escape special regex characters
 */
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Add a custom journal abbreviation
 */
async function addCustomAbbreviationDialog(context: vscode.ExtensionContext, prefillFullName?: string): Promise<void> {
    const fullName = await vscode.window.showInputBox({
        prompt: 'Enter full journal name',
        value: prefillFullName,
        placeHolder: 'e.g., Journal of the American Chemical Society'
    });

    if (!fullName) return;

    const abbreviation = await vscode.window.showInputBox({
        prompt: 'Enter abbreviation',
        placeHolder: 'e.g., J. Am. Chem. Soc.'
    });

    if (!abbreviation) return;

    const service = await getAbbrevService(context);
    await service.addCustomAbbreviation(fullName, abbreviation);

    vscode.window.showInformationMessage(
        `Added custom abbreviation: "${fullName}" → "${abbreviation}"`
    );
}

/**
 * Search journal abbreviations database
 */
async function searchJournalAbbreviations(context: vscode.ExtensionContext): Promise<void> {
    const service = await getAbbrevService(context);

    const query = await vscode.window.showInputBox({
        prompt: 'Search journals by name or abbreviation',
        placeHolder: 'e.g., chemistry, J. Am.'
    });

    if (!query) return;

    const results = service.search(query, 50);

    if (results.length === 0) {
        vscode.window.showInformationMessage(`No journals found matching "${query}"`);
        return;
    }

    const items = results.map(entry => ({
        label: entry.fullName,
        description: entry.abbreviation,
        detail: `Source: ${entry.source}`,
        entry
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `${results.length} results for "${query}"`,
        matchOnDescription: true
    });

    if (!selected) return;

    // Copy abbreviation to clipboard
    await vscode.env.clipboard.writeText(selected.entry.abbreviation);
    vscode.window.showInformationMessage(
        `Copied "${selected.entry.abbreviation}" to clipboard`
    );
}

/**
 * Update journal abbreviations from online sources
 */
async function updateJournalAbbreviations(context: vscode.ExtensionContext): Promise<void> {
    const service = await getAbbrevService(context);

    const sources = service.getAvailableSources();
    const items = sources.map(s => ({
        label: s.name,
        description: s.installed ? '$(check) Installed' : '$(cloud-download) Not installed',
        detail: s.description,
        picked: true,
        key: s.key as AbbreviationSourceKey
    }));

    // Add "All sources" option at top
    const selectedItems = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select abbreviation sources to download/update',
        canPickMany: true
    });

    if (!selectedItems || selectedItems.length === 0) return;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Updating journal abbreviations',
        cancellable: false
    }, async (progress) => {
        const total = selectedItems.length;
        let current = 0;

        for (const item of selectedItems) {
            current++;
            progress.report({
                message: `Downloading ${item.label} (${current}/${total})...`,
                increment: (1 / total) * 100
            });

            try {
                await service.downloadAbbreviations(item.key);
            } catch (error) {
                vscode.window.showWarningMessage(`Failed to download ${item.label}: ${error}`);
            }
        }

        // Reload abbreviations
        await service.loadAllAbbreviations();
    });

    const stats = service.getStats();
    vscode.window.showInformationMessage(
        `Updated journal abbreviations. Total: ${stats.total} entries`
    );
}

/**
 * Show journal abbreviation statistics
 */
async function showJournalAbbreviationStats(context: vscode.ExtensionContext): Promise<void> {
    const service = await getAbbrevService(context);
    const stats = service.getStats();

    const sources = Object.entries(stats.bySources)
        .sort((a, b) => b[1] - a[1])
        .map(([source, count]) => `${source}: ${count}`)
        .join('\n');

    vscode.window.showInformationMessage(
        `Journal Abbreviations: ${stats.total} total entries\n\n${sources}`,
        { modal: true }
    );
}

/**
 * Manage custom journal abbreviations
 */
async function manageCustomAbbreviations(context: vscode.ExtensionContext): Promise<void> {
    const service = await getAbbrevService(context);
    const customEntries = await service.getCustomAbbreviations();

    const actions = [
        { label: '$(add) Add New Abbreviation', action: 'add' },
        ...(customEntries.length > 0 ? [
            { label: '$(list-unordered) View/Remove Custom Abbreviations', action: 'view' }
        ] : [])
    ];

    const selected = await vscode.window.showQuickPick(actions, {
        placeHolder: `${customEntries.length} custom abbreviation(s)`
    });

    if (!selected) return;

    if (selected.action === 'add') {
        await addCustomAbbreviationDialog(context);
    } else if (selected.action === 'view') {
        const items = customEntries.map(entry => ({
            label: entry.fullName,
            description: entry.abbreviation,
            entry
        }));

        const selectedEntry = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select to remove'
        });

        if (selectedEntry) {
            const confirm = await vscode.window.showWarningMessage(
                `Remove custom abbreviation for "${selectedEntry.entry.fullName}"?`,
                'Remove',
                'Cancel'
            );

            if (confirm === 'Remove') {
                await service.removeCustomAbbreviation(selectedEntry.entry.fullName);
                vscode.window.showInformationMessage('Custom abbreviation removed');
            }
        }
    }
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
        vscode.commands.registerCommand('scimax.bibtex.cleanEntry', cleanEntry),
        vscode.commands.registerCommand('scimax.bibtex.wrapBraces', wrapBraces)
    );

    // Access commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.bibtex.openPdf', openPdf),
        vscode.commands.registerCommand('scimax.bibtex.openUrl', openUrl),
        vscode.commands.registerCommand('scimax.bibtex.openNotes', openNotes),
        vscode.commands.registerCommand('scimax.bibtex.googleScholar', googleScholar),
        vscode.commands.registerCommand('scimax.bibtex.crossref', openCrossref),
        vscode.commands.registerCommand('scimax.bibtex.webOfScience', openWebOfScience),
        // OpenAlex commands
        vscode.commands.registerCommand('scimax.bibtex.showCitingWorks', showCitingWorks),
        vscode.commands.registerCommand('scimax.bibtex.showRelatedWorks', showRelatedWorks),
        vscode.commands.registerCommand('scimax.bibtex.showReferences', showReferences)
    );

    // Action commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.bibtex.copyKey', copyKey),
        vscode.commands.registerCommand('scimax.bibtex.copyBibtex', copyBibtex),
        vscode.commands.registerCommand('scimax.bibtex.killEntry', killEntry),
        vscode.commands.registerCommand('scimax.bibtex.generateKey', generateKey),
        vscode.commands.registerCommand('scimax.bibtex.updateFromWeb', updateFromWeb)
    );

    // Help command
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.bibtex.help', showBibtexHelp)
    );

    // File-wide commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.bibtex.validateFile', validateFile),
        vscode.commands.registerCommand('scimax.bibtex.showStatistics', showStatistics),
        vscode.commands.registerCommand('scimax.bibtex.sortEntries', sortEntries),
        vscode.commands.registerCommand('scimax.bibtex.applyToAllEntries', applyToAllEntries)
    );

    // Journal abbreviation commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.bibtex.toggleJournalAbbreviation',
            () => toggleJournalAbbreviation(context)),
        vscode.commands.registerCommand('scimax.bibtex.abbreviateAllJournals',
            () => toggleAllJournalAbbreviations(context, true)),
        vscode.commands.registerCommand('scimax.bibtex.expandAllJournals',
            () => toggleAllJournalAbbreviations(context, false)),
        vscode.commands.registerCommand('scimax.bibtex.searchJournalAbbreviations',
            () => searchJournalAbbreviations(context)),
        vscode.commands.registerCommand('scimax.bibtex.updateJournalAbbreviations',
            () => updateJournalAbbreviations(context)),
        vscode.commands.registerCommand('scimax.bibtex.addJournalAbbreviation',
            () => addCustomAbbreviationDialog(context)),
        vscode.commands.registerCommand('scimax.bibtex.manageJournalAbbreviations',
            () => manageCustomAbbreviations(context)),
        vscode.commands.registerCommand('scimax.bibtex.journalAbbreviationStats',
            () => showJournalAbbreviationStats(context))
    );

    // Register code lens provider for file-wide actions
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'bibtex', scheme: 'file' },
            new BibtexFileCodeLensProvider()
        )
    );
}

/**
 * Code lens provider that shows file-wide actions at the top of BibTeX files
 */
export class BibtexFileCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const codeLenses: vscode.CodeLens[] = [];

        // Only show at the very top of the file (line 0)
        const topRange = new vscode.Range(0, 0, 0, 0);

        // Quick stats
        const text = document.getText();
        const result = parseBibTeX(text);
        const entryCount = result.entries.length;

        // Validate button
        codeLenses.push(new vscode.CodeLens(topRange, {
            title: `$(check) Validate`,
            command: 'scimax.bibtex.validateFile',
            tooltip: 'Validate BibTeX file for errors and warnings'
        }));

        // Statistics button with entry count
        codeLenses.push(new vscode.CodeLens(topRange, {
            title: `$(list-unordered) ${entryCount} entries`,
            command: 'scimax.bibtex.showStatistics',
            tooltip: 'Show file statistics'
        }));

        return codeLenses;
    }
}
