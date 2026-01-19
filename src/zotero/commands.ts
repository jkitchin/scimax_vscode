/**
 * Zotero commands for inserting citations from Zotero
 */

import * as vscode from 'vscode';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { isZoteroRunning, openCitationPicker, exportBibTeX } from './zoteroService';
import { ReferenceManager } from '../references/referenceManager';
import { parseBibTeX, BibEntry } from '../references/bibtexParser';

/**
 * Find the bibliography file linked in the document
 * Returns the first bibliography path found, or null if none
 * Supports org-mode, markdown, and LaTeX formats
 * @internal Exported for testing
 */
export function findDocumentBibliography(documentText: string, documentPath: string, languageId?: string): string | null {
    const docDir = path.dirname(documentPath);
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';

    // Helper to resolve a path
    const resolvePath = (bibPath: string): string => {
        let resolved = bibPath.trim();
        if (resolved.startsWith('~')) {
            resolved = path.join(homeDir, resolved.slice(1));
        } else if (!path.isAbsolute(resolved)) {
            resolved = path.resolve(docDir, resolved);
        }
        if (!resolved.endsWith('.bib')) {
            resolved = resolved + '.bib';
        }
        return resolved;
    };

    // Org-mode patterns
    // Match bibliography:path (org-ref style)
    const bibLinkRegex = /bibliography:([^\s<>\[\](){}]+)/i;
    // Match #+BIBLIOGRAPHY: path
    const bibKeywordRegex = /^#\+BIBLIOGRAPHY:\s*(.+?\.bib)\s*$/im;

    // LaTeX patterns
    // Match \bibliography{path} or \bibliography{path1,path2}
    const latexBibRegex = /\\bibliography\{([^}]+)\}/;
    // Match \addbibresource{path.bib}
    const biblatexRegex = /\\addbibresource\{([^}]+)\}/;

    // Markdown/Pandoc patterns
    // Match bibliography: path in YAML frontmatter
    const yamlBibRegex = /^bibliography:\s*(.+\.bib)\s*$/im;
    // Match [bibliography]: path
    const mdRefBibRegex = /^\[bibliography\]:\s*(.+\.bib)\s*$/im;

    let match: RegExpExecArray | null;

    // Try org-mode patterns
    match = bibLinkRegex.exec(documentText);
    if (match) {
        const bibPaths = match[1].split(',');
        const firstPath = bibPaths[0].trim();
        if (firstPath) {
            return resolvePath(firstPath);
        }
    }

    match = bibKeywordRegex.exec(documentText);
    if (match) {
        return resolvePath(match[1]);
    }

    // Try LaTeX patterns
    match = latexBibRegex.exec(documentText);
    if (match) {
        const bibPaths = match[1].split(',');
        const firstPath = bibPaths[0].trim();
        if (firstPath) {
            return resolvePath(firstPath);
        }
    }

    match = biblatexRegex.exec(documentText);
    if (match) {
        return resolvePath(match[1]);
    }

    // Try Markdown/Pandoc patterns
    match = yamlBibRegex.exec(documentText);
    if (match) {
        return resolvePath(match[1]);
    }

    match = mdRefBibRegex.exec(documentText);
    if (match) {
        return resolvePath(match[1]);
    }

    return null;
}

/**
 * Check if a bibliography file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fsPromises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Append BibTeX entries to a file, avoiding duplicates
 * @returns Array of keys that were actually added (not duplicates)
 * @internal Exported for testing
 */
export async function appendBibTeXEntries(
    bibPath: string,
    bibtexContent: string,
    existingKeys: Set<string>
): Promise<string[]> {
    // Parse the new BibTeX content
    const result = parseBibTeX(bibtexContent);
    const addedKeys: string[] = [];

    // Filter out entries that already exist
    const newEntries: BibEntry[] = [];
    for (const entry of result.entries) {
        if (!existingKeys.has(entry.key)) {
            newEntries.push(entry);
            addedKeys.push(entry.key);
        }
    }

    if (newEntries.length === 0) {
        return addedKeys;
    }

    // Read existing content atomically (avoiding race condition between exists check and read)
    let existingContent = '';
    try {
        existingContent = await fsPromises.readFile(bibPath, 'utf8');
    } catch (err) {
        // File doesn't exist - that's fine, we'll create it
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err;
        }
    }

    // Build the content to append (use raw BibTeX from Zotero for each entry)
    // We need to extract the raw entry from the bibtex content
    const entriesToAdd: string[] = [];
    for (const entry of newEntries) {
        // Find this entry in the original BibTeX content
        const entryRegex = new RegExp(`@\\w+\\s*\\{\\s*${escapeRegExp(entry.key)}\\s*,`, 'i');
        const match = entryRegex.exec(bibtexContent);
        if (match) {
            // Extract the full entry by finding the matching closing brace
            const startIdx = match.index;
            let braceCount = 0;
            let endIdx = startIdx;
            let inEntry = false;

            for (let i = startIdx; i < bibtexContent.length; i++) {
                const char = bibtexContent[i];
                if (char === '{') {
                    braceCount++;
                    inEntry = true;
                } else if (char === '}') {
                    braceCount--;
                    if (inEntry && braceCount === 0) {
                        endIdx = i + 1;
                        break;
                    }
                }
            }

            entriesToAdd.push(bibtexContent.substring(startIdx, endIdx));
        }
    }

    // Append to file
    const separator = existingContent.trim() ? '\n\n' : '';
    const newContent = existingContent + separator + entriesToAdd.join('\n\n') + '\n';

    try {
        await fsPromises.writeFile(bibPath, newContent, 'utf8');
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to write bibliography file: ${errorMsg}`);
    }

    return addedKeys;
}

/**
 * Escape special regex characters
 * @internal Exported for testing
 */
export function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Add bibliography link to the document based on language
 */
async function addBibliographyLink(
    editor: vscode.TextEditor,
    bibPath: string,
    documentPath: string
): Promise<void> {
    const docDir = path.dirname(documentPath);
    const languageId = editor.document.languageId;

    // Make path relative if possible
    let relativePath = bibPath;
    if (bibPath.startsWith(docDir)) {
        relativePath = path.relative(docDir, bibPath);
        if (!relativePath.startsWith('.')) {
            relativePath = './' + relativePath;
        }
    }

    const document = editor.document;
    const lastLine = document.lineAt(document.lineCount - 1);

    let insertText: string;
    let position: vscode.Position;

    if (languageId === 'latex') {
        // LaTeX: add \bibliographystyle and \bibliography at end of file
        // Remove .bib extension for \bibliography command
        const bibName = relativePath.replace(/\.bib$/, '');
        position = new vscode.Position(document.lineCount - 1, lastLine.text.length);
        insertText = lastLine.text.trim() === ''
            ? `\\bibliographystyle{unsrtnat}\n\\bibliography{${bibName}}\n`
            : `\n\n\\bibliographystyle{unsrtnat}\n\\bibliography{${bibName}}\n`;
    } else if (languageId === 'markdown') {
        // Markdown: add YAML frontmatter or append to existing frontmatter
        const text = document.getText();
        const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
            // Add to existing frontmatter
            const frontmatterEnd = text.indexOf('---', 4);
            position = document.positionAt(frontmatterEnd);
            insertText = `bibliography: ${relativePath}\n`;
        } else {
            // Add new frontmatter at the beginning
            position = new vscode.Position(0, 0);
            insertText = `---\nbibliography: ${relativePath}\n---\n\n`;
        }
    } else {
        // Org-mode: add bibliography link at the end
        position = new vscode.Position(document.lineCount - 1, lastLine.text.length);
        insertText = lastLine.text.trim() === ''
            ? `bibliography:${relativePath}\n`
            : `\n\nbibliography:${relativePath}\n`;
    }

    await editor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.insert(position, insertText);
    });
}

/**
 * Format citation for insertion based on document language
 * @internal Exported for testing
 */
export function formatCitation(keys: string[], languageId: string): string {
    const config = vscode.workspace.getConfiguration('scimax.ref');

    if (languageId === 'latex') {
        // LaTeX format: \cite{key1,key2}
        const style = config.get<string>('latexCiteStyle') || 'cite';
        return `\\${style}{${keys.join(',')}}`;
    } else if (languageId === 'markdown') {
        // Pandoc markdown format: [@key1; @key2]
        return `[${keys.map(k => `@${k}`).join('; ')}]`;
    } else {
        // Org-mode format (default)
        const syntax = config.get<string>('citationSyntax') || 'org-ref-v3';
        const style = config.get<string>('defaultCiteStyle') || 'cite';

        if (syntax === 'org-ref-v3') {
            // v3 format: cite:&key1;&key2
            return `${style}:${keys.map(k => `&${k}`).join(';')}`;
        } else {
            // v2 format: cite:key1,key2
            return `${style}:${keys.join(',')}`;
        }
    }
}

/**
 * Format citation for insertion using org-ref syntax (legacy, for compatibility)
 * @internal Exported for testing
 */
export function formatOrgRefCitation(keys: string[]): string {
    return formatCitation(keys, 'org');
}

/**
 * Result of finding a citation at cursor position
 */
export interface CitationAtCursor {
    /** The citation format type */
    format: 'org-v3' | 'org-v2' | 'latex' | 'markdown';
    /** The citation style (cite, citep, citet, etc.) */
    style: string;
    /** Start position of the citation in the line */
    startColumn: number;
    /** End position of the citation in the line (where cursor should be for append) */
    endColumn: number;
    /** The existing keys in the citation */
    existingKeys: string[];
    /** Whether the citation uses v3 syntax (for org-mode compatibility) */
    isV3: boolean;
}

/**
 * Check if cursor is at the end of an existing citation
 * Returns citation info if at end of citation, null otherwise
 * Supports org-mode, LaTeX, and Markdown citation formats
 * @internal Exported for testing
 */
export function findCitationAtCursor(
    lineText: string,
    cursorColumn: number,
    languageId?: string
): CitationAtCursor | null {
    // Common citation styles for org/LaTeX
    const citeStyles = ['cite', 'citep', 'citet', 'citeauthor', 'citeyear', 'citenum', 'citealp', 'citealt', 'nocite', 'textcite', 'parencite', 'autocite'];
    const stylePattern = citeStyles.join('|');

    let match: RegExpExecArray | null;

    // Try LaTeX format: \cite{key1,key2}
    const latexRegex = new RegExp(`\\\\(${stylePattern})\\{([^}]+)\\}`, 'gi');
    while ((match = latexRegex.exec(lineText)) !== null) {
        const citationEnd = match.index + match[0].length;
        if (cursorColumn === citationEnd) {
            const style = match[1];
            const keysStr = match[2];
            const existingKeys = keysStr.split(',').map(k => k.trim());
            return {
                format: 'latex',
                style,
                isV3: false,
                startColumn: match.index,
                endColumn: citationEnd,
                existingKeys
            };
        }
    }

    // Try Markdown/Pandoc format: [@key1; @key2]
    const markdownRegex = /\[(@[\w:._-]+(?:;\s*@[\w:._-]+)*)\]/g;
    while ((match = markdownRegex.exec(lineText)) !== null) {
        const citationEnd = match.index + match[0].length;
        if (cursorColumn === citationEnd) {
            const keysStr = match[1];
            const existingKeys = keysStr.split(';').map(k => k.trim().replace(/^@/, ''));
            return {
                format: 'markdown',
                style: 'pandoc',
                isV3: false,
                startColumn: match.index,
                endColumn: citationEnd,
                existingKeys
            };
        }
    }

    // Try org-mode formats
    // v3 pattern: style:&key1;&key2 (keys start with &, separated by ;)
    // v2 pattern: style:key1,key2 (keys without &, separated by ,)
    const orgRegex = new RegExp(
        `(${stylePattern}):` +           // style:
        `(&[\\w:._-]+(?:;&[\\w:._-]+)*` + // v3: &key1;&key2
        `|[\\w:._-]+(?:,[\\w:._-]+)*)`,   // v2: key1,key2
        'gi'
    );

    while ((match = orgRegex.exec(lineText)) !== null) {
        const citationStart = match.index;
        const citationEnd = match.index + match[0].length;

        if (cursorColumn === citationEnd) {
            const style = match[1];
            const keysStr = match[2];
            const isV3 = keysStr.startsWith('&');

            let existingKeys: string[];
            if (isV3) {
                existingKeys = keysStr.split(';').map(k => k.replace(/^&/, ''));
            } else {
                existingKeys = keysStr.split(',');
            }

            return {
                format: isV3 ? 'org-v3' : 'org-v2',
                style,
                isV3,
                startColumn: citationStart,
                endColumn: citationEnd,
                existingKeys
            };
        }
    }

    return null;
}

/**
 * Format keys to append to an existing citation
 * @internal Exported for testing
 */
export function formatKeysForAppend(keys: string[], citation: CitationAtCursor): string {
    switch (citation.format) {
        case 'latex':
            // LaTeX: we need to insert before the closing brace
            // Return just the keys to add with comma prefix
            return keys.map(k => `,${k}`).join('');
        case 'markdown':
            // Markdown: insert before closing bracket
            // Return keys with semicolon and @ prefix
            return keys.map(k => `; @${k}`).join('');
        case 'org-v3':
            // v3: append ;&key1;&key2
            return keys.map(k => `;&${k}`).join('');
        case 'org-v2':
        default:
            // v2: append ,key1,key2
            return keys.map(k => `,${k}`).join('');
    }
}

/**
 * Register Zotero commands
 */
export function registerZoteroCommands(
    context: vscode.ExtensionContext,
    referenceManager: ReferenceManager
): void {
    // Insert citation from Zotero
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.zotero.insertCitation', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            // Check if this is an org or markdown file
            const languageId = editor.document.languageId;
            if (!['org', 'markdown', 'latex'].includes(languageId)) {
                vscode.window.showWarningMessage('Zotero citations work best in org, markdown, or LaTeX files');
            }

            // Check if Zotero is running
            const zoteroRunning = await isZoteroRunning();
            if (!zoteroRunning) {
                vscode.window.showErrorMessage(
                    'Zotero is not running or Better BibTeX is not installed. Please start Zotero with Better BibTeX enabled.'
                );
                return;
            }

            // Show status while waiting for user to select in Zotero
            const result = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Waiting for Zotero citation selection...',
                cancellable: true
            }, async (_progress: vscode.Progress<{ message?: string }>, token: vscode.CancellationToken) => {
                return await openCitationPicker({
                    isCancellationRequested: token.isCancellationRequested,
                    onCancellationRequested: (callback: () => void) => token.onCancellationRequested(callback)
                });
            });

            if (!result || result.keys.length === 0) {
                // User cancelled or no selection
                return;
            }

            const documentPath = editor.document.uri.fsPath;
            const documentDir = path.dirname(documentPath);
            const documentText = editor.document.getText();

            // Find or create bibliography file
            let bibPath = findDocumentBibliography(documentText, documentPath);
            let needToAddLink = false;

            if (!bibPath) {
                // No bibliography link in document - use references.bib (create if needed)
                const defaultBibPath = path.join(documentDir, 'references.bib');
                bibPath = defaultBibPath;
                needToAddLink = true;
            }

            // At this point bibPath is guaranteed to be set
            if (!bibPath) {
                vscode.window.showErrorMessage('No bibliography file selected');
                return;
            }

            // Fetch BibTeX from Zotero for selected items
            const bibtex = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Fetching BibTeX from Zotero...',
                cancellable: false
            }, async () => {
                return await exportBibTeX(result.keys);
            });

            if (!bibtex) {
                vscode.window.showErrorMessage('Failed to fetch BibTeX from Zotero');
                return;
            }

            // Get existing keys from the bib file to avoid duplicates
            const existingKeys = new Set<string>();
            if (await fileExists(bibPath)) {
                const existingContent = await fsPromises.readFile(bibPath, 'utf8');
                const parsed = parseBibTeX(existingContent);
                for (const entry of parsed.entries) {
                    existingKeys.add(entry.key);
                }
            }

            // Append entries to bib file
            let addedKeys: string[];
            try {
                addedKeys = await appendBibTeXEntries(bibPath, bibtex, existingKeys);
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Failed to update bibliography: ${errorMsg}`);
                return;
            }

            // Add bibliography link if needed
            if (needToAddLink) {
                await addBibliographyLink(editor, bibPath, documentPath);
            }

            // Check if cursor is at end of an existing citation
            const cursorPos = editor.selection.active;
            const currentLine = editor.document.lineAt(cursorPos.line);
            const existingCitation = findCitationAtCursor(currentLine.text, cursorPos.character, languageId);

            let insertedText: string;
            let insertPosition = editor.selection.active;

            if (existingCitation) {
                // Append to existing citation
                insertedText = formatKeysForAppend(result.keys, existingCitation);

                // For LaTeX and Markdown, we need to insert BEFORE the closing brace/bracket
                if (existingCitation.format === 'latex' || existingCitation.format === 'markdown') {
                    // Move insert position back by 1 (before } or ])
                    insertPosition = new vscode.Position(cursorPos.line, cursorPos.character - 1);
                }
            } else {
                // Insert new citation using language-specific format
                insertedText = formatCitation(result.keys, languageId);
            }

            await editor.edit((editBuilder: vscode.TextEditorEdit) => {
                editBuilder.insert(insertPosition, insertedText);
            });

            // Move cursor to end of citation
            let newPosition: vscode.Position;
            if (existingCitation && (existingCitation.format === 'latex' || existingCitation.format === 'markdown')) {
                // Cursor should be at the end of the citation (after the closing brace/bracket)
                newPosition = new vscode.Position(
                    cursorPos.line,
                    cursorPos.character + insertedText.length
                );
            } else {
                newPosition = new vscode.Position(
                    editor.selection.active.line,
                    editor.selection.active.character + insertedText.length
                );
            }
            editor.selection = new vscode.Selection(newPosition, newPosition);

            // Restore focus to editor (Zotero picker takes focus)
            // Note: VS Code extensions cannot bring the window to foreground on macOS
            await vscode.window.showTextDocument(editor.document, {
                viewColumn: editor.viewColumn,
                preserveFocus: false,
                preview: false
            });

            // Show feedback
            const duplicateCount = result.keys.length - addedKeys.length;
            const action = existingCitation ? 'Appended' : 'Inserted';
            let message = `${action} ${result.keys.length} citation(s)`;
            if (addedKeys.length > 0) {
                message += `, added ${addedKeys.length} to ${path.basename(bibPath)}`;
            }
            if (duplicateCount > 0) {
                message += ` (${duplicateCount} already existed)`;
            }
            vscode.window.showInformationMessage(message);

            // Reload bibliographies to pick up new entries
            await referenceManager.loadBibliographies();
        })
    );
}
