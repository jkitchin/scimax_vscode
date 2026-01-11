import * as vscode from 'vscode';
import * as path from 'path';

interface LineItem extends vscode.QuickPickItem {
    filePath: string;
    lineNumber: number;
    lineText: string;
}

/**
 * Get all lines from a document with their line numbers
 */
function getDocumentLines(document: vscode.TextDocument): LineItem[] {
    const lines: LineItem[] = [];
    const fileName = path.basename(document.fileName);

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const text = line.text;

        // Skip empty lines
        if (text.trim().length === 0) {
            continue;
        }

        lines.push({
            label: `${i + 1}: ${text}`,
            description: fileName,
            filePath: document.uri.fsPath,
            lineNumber: i,
            lineText: text
        });
    }

    return lines;
}

/**
 * Filter lines by search query with highlighting
 */
function filterLines(lines: LineItem[], query: string): LineItem[] {
    if (!query || query.trim().length === 0) {
        return lines;
    }

    const lowerQuery = query.toLowerCase();
    const queryParts = lowerQuery.split(/\s+/).filter(p => p.length > 0);

    return lines.filter(item => {
        const lowerText = item.lineText.toLowerCase();
        // All query parts must match (AND logic for space-separated terms)
        return queryParts.every(part => lowerText.includes(part));
    }).map(item => {
        // Highlight matches in the label
        let highlightedLabel = item.label;
        for (const part of queryParts) {
            const regex = new RegExp(`(${escapeRegex(part)})`, 'gi');
            highlightedLabel = highlightedLabel.replace(regex, '**$1**');
        }
        return {
            ...item,
            label: highlightedLabel
        };
    });
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Navigate to a specific line in a file
 */
async function goToLine(filePath: string, lineNumber: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(document);

    const position = new vscode.Position(lineNumber, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
    );
}

/**
 * Swiper - Search current file with live preview
 * Similar to Emacs swiper, shows all matching lines as you type
 */
async function swiper(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const document = editor.document;
    const allLines = getDocumentLines(document);

    // Save original position to restore if cancelled
    const originalPosition = editor.selection.active;

    const quickPick = vscode.window.createQuickPick<LineItem>();
    quickPick.placeholder = 'Search current file (type to filter)';
    quickPick.matchOnDescription = false;
    quickPick.matchOnDetail = false;
    quickPick.items = allLines;

    // Live preview: navigate to selected line as user browses
    quickPick.onDidChangeActive(items => {
        if (items.length > 0) {
            const item = items[0];
            const position = new vscode.Position(item.lineNumber, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
        }
    });

    // Filter lines as user types
    quickPick.onDidChangeValue(value => {
        quickPick.items = filterLines(allLines, value);
    });

    // Handle selection
    quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
            goToLine(selected.filePath, selected.lineNumber);
        }
        quickPick.hide();
    });

    // Restore position if cancelled
    quickPick.onDidHide(() => {
        if (quickPick.selectedItems.length === 0) {
            // Cancelled - restore original position
            editor.selection = new vscode.Selection(originalPosition, originalPosition);
            editor.revealRange(
                new vscode.Range(originalPosition, originalPosition),
                vscode.TextEditorRevealType.InCenter
            );
        }
        quickPick.dispose();
    });

    quickPick.show();
}

/**
 * Swiper All - Search all open files with live preview
 * Similar to Emacs swiper-all, searches across all open buffers
 */
async function swiperAll(): Promise<void> {
    // Get all open text documents
    const openDocuments = vscode.workspace.textDocuments.filter(doc => {
        // Filter out internal VS Code documents
        return doc.uri.scheme === 'file' && !doc.isClosed;
    });

    if (openDocuments.length === 0) {
        vscode.window.showWarningMessage('No open files');
        return;
    }

    // Collect lines from all open documents
    const allLines: LineItem[] = [];
    const separators: Map<string, vscode.QuickPickItem> = new Map();

    for (const doc of openDocuments) {
        const fileName = path.basename(doc.fileName);
        separators.set(doc.uri.fsPath, {
            label: fileName,
            kind: vscode.QuickPickItemKind.Separator
        });
        allLines.push(...getDocumentLines(doc));
    }

    // Build items with separators grouped by file
    function buildItemsWithSeparators(lines: LineItem[]): (LineItem | vscode.QuickPickItem)[] {
        const items: (LineItem | vscode.QuickPickItem)[] = [];
        let currentFile = '';

        for (const line of lines) {
            if (line.filePath !== currentFile) {
                currentFile = line.filePath;
                const sep = separators.get(currentFile);
                if (sep) {
                    items.push(sep);
                }
            }
            items.push(line);
        }

        return items;
    }

    const quickPick = vscode.window.createQuickPick<LineItem | vscode.QuickPickItem>();
    quickPick.placeholder = `Search ${openDocuments.length} open files (type to filter)`;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = false;
    quickPick.items = buildItemsWithSeparators(allLines);

    // Live preview: navigate to selected line
    quickPick.onDidChangeActive(items => {
        if (items.length > 0) {
            const item = items[0] as LineItem;
            if (item.filePath && item.lineNumber !== undefined) {
                goToLine(item.filePath, item.lineNumber);
            }
        }
    });

    // Filter lines as user types
    quickPick.onDidChangeValue(value => {
        const filtered = filterLines(allLines, value);
        quickPick.items = buildItemsWithSeparators(filtered);
    });

    // Handle selection
    quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0] as LineItem;
        if (selected && selected.filePath) {
            goToLine(selected.filePath, selected.lineNumber);
        }
        quickPick.hide();
    });

    quickPick.onDidHide(() => {
        quickPick.dispose();
    });

    quickPick.show();
}

/**
 * Swiper Symbol - Search headings/symbols in current file
 * Like swiper but focused on structure (headings, functions, etc.)
 */
async function swiperSymbol(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const document = editor.document;
    const lines: LineItem[] = [];
    const fileName = path.basename(document.fileName);

    // Patterns for different file types
    const isOrg = document.languageId === 'org';
    const isMarkdown = document.languageId === 'markdown';

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const text = line.text;

        let isHeading = false;
        let icon = '';

        if (isOrg) {
            // Org-mode headings start with *
            if (/^\*+ /.test(text)) {
                isHeading = true;
                const level = text.match(/^\*+/)?.[0].length || 1;
                icon = '$(symbol-class) '.repeat(Math.min(level, 3));
            }
        } else if (isMarkdown) {
            // Markdown headings start with #
            if (/^#{1,6} /.test(text)) {
                isHeading = true;
                const level = text.match(/^#+/)?.[0].length || 1;
                icon = '$(symbol-class) '.repeat(Math.min(level, 3));
            }
        } else {
            // For other files, look for function definitions
            if (/^(function|def|class|interface|type|const|let|var|export|async|public|private|protected)\s/.test(text)) {
                isHeading = true;
                icon = '$(symbol-method) ';
            }
        }

        if (isHeading) {
            lines.push({
                label: `${icon}${i + 1}: ${text.trim()}`,
                description: fileName,
                filePath: document.uri.fsPath,
                lineNumber: i,
                lineText: text
            });
        }
    }

    if (lines.length === 0) {
        vscode.window.showInformationMessage('No headings or symbols found');
        return;
    }

    const originalPosition = editor.selection.active;

    const quickPick = vscode.window.createQuickPick<LineItem>();
    quickPick.placeholder = 'Search headings/symbols (type to filter)';
    quickPick.matchOnDescription = false;
    quickPick.items = lines;

    quickPick.onDidChangeActive(items => {
        if (items.length > 0) {
            const item = items[0];
            const position = new vscode.Position(item.lineNumber, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
        }
    });

    quickPick.onDidChangeValue(value => {
        quickPick.items = filterLines(lines, value);
    });

    quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
            goToLine(selected.filePath, selected.lineNumber);
        }
        quickPick.hide();
    });

    quickPick.onDidHide(() => {
        if (quickPick.selectedItems.length === 0) {
            editor.selection = new vscode.Selection(originalPosition, originalPosition);
            editor.revealRange(
                new vscode.Range(originalPosition, originalPosition),
                vscode.TextEditorRevealType.InCenter
            );
        }
        quickPick.dispose();
    });

    quickPick.show();
}

/**
 * Register all swiper commands
 */
export function registerSwiperCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.swiper', swiper),
        vscode.commands.registerCommand('scimax.swiperAll', swiperAll),
        vscode.commands.registerCommand('scimax.swiperSymbol', swiperSymbol)
    );

    console.log('Scimax: Swiper commands registered');
}
