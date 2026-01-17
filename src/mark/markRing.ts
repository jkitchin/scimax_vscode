import * as vscode from 'vscode';

/**
 * Emacs-style mark ring for VS Code
 *
 * Provides commands to:
 * - Push current position onto a mark ring
 * - Pop back to previous positions
 * - Exchange point and mark
 *
 * Each document has its own mark ring, plus there's a global mark ring
 * that tracks positions across all documents.
 */

interface Mark {
    uri: vscode.Uri;
    position: vscode.Position;
    timestamp: number;
}

// Configuration
const DEFAULT_RING_SIZE = 16;

// Per-document mark rings
const documentMarkRings: Map<string, Mark[]> = new Map();

// Global mark ring (across all documents)
const globalMarkRing: Mark[] = [];

// Last mark for exchange-point-and-mark
let lastMark: Mark | undefined;

// Selection mode state (Emacs transient mark mode)
let selectionModeActive = false;
let selectionAnchor: vscode.Position | undefined;

/**
 * Get the mark ring size from configuration
 */
function getRingSize(): number {
    const config = vscode.workspace.getConfiguration('scimax.mark');
    return config.get<number>('ringSize', DEFAULT_RING_SIZE);
}

/**
 * Get or create mark ring for a document
 */
function getDocumentRing(uri: vscode.Uri): Mark[] {
    const key = uri.toString();
    if (!documentMarkRings.has(key)) {
        documentMarkRings.set(key, []);
    }
    return documentMarkRings.get(key)!;
}

/**
 * Push a mark onto a ring, maintaining max size
 */
function pushToRing(ring: Mark[], mark: Mark, maxSize: number): void {
    ring.push(mark);
    while (ring.length > maxSize) {
        ring.shift();
    }
}

/**
 * Set mark for selection (Emacs C-SPC behavior)
 * After calling this, cursor movement will extend the selection
 */
export async function setMarkForSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const currentPos = editor.selection.active;

    // If selection mode is already active and we're at the same position,
    // deactivate it (toggle behavior like Emacs C-g)
    if (selectionModeActive && selectionAnchor &&
        currentPos.isEqual(editor.selection.anchor) &&
        !editor.selection.isEmpty) {
        // Deactivate: collapse selection to cursor
        selectionModeActive = false;
        selectionAnchor = undefined;
        editor.selection = new vscode.Selection(currentPos, currentPos);
        vscode.window.setStatusBarMessage('Mark deactivated', 2000);
        return;
    }

    // Set the anchor for selection
    selectionAnchor = currentPos;
    selectionModeActive = true;

    // Also push to mark ring for later use
    const mark: Mark = {
        uri: editor.document.uri,
        position: currentPos,
        timestamp: Date.now()
    };
    const ringSize = getRingSize();
    const docRing = getDocumentRing(editor.document.uri);
    pushToRing(docRing, mark, ringSize);
    pushToRing(globalMarkRing, mark, ringSize);
    lastMark = mark;

    // Use VS Code's selection anchor feature
    await vscode.commands.executeCommand('editor.action.setSelectionAnchor');

    // Visual feedback
    const line = currentPos.line + 1;
    const col = currentPos.character + 1;
    vscode.window.setStatusBarMessage(`Mark set at line ${line}, col ${col} - move cursor to select`, 3000);

    // Brief highlight at mark position
    await flashMark(editor, currentPos);
}

/**
 * Cancel selection mode (like Emacs C-g)
 */
export function cancelSelection(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    if (selectionModeActive || !editor.selection.isEmpty) {
        selectionModeActive = false;
        selectionAnchor = undefined;
        const pos = editor.selection.active;
        editor.selection = new vscode.Selection(pos, pos);
        vscode.window.setStatusBarMessage('Selection cancelled', 1000);
    }
}

/**
 * Select to the anchor/mark (like VS Code's Ctrl+K Ctrl+K)
 */
export async function selectToMark(): Promise<void> {
    await vscode.commands.executeCommand('editor.action.selectFromAnchorToCursor');
}

/**
 * Push current position onto the mark ring
 */
export async function pushMark(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const mark: Mark = {
        uri: editor.document.uri,
        position: editor.selection.active,
        timestamp: Date.now()
    };

    const ringSize = getRingSize();

    // Push to document-local ring
    const docRing = getDocumentRing(editor.document.uri);
    pushToRing(docRing, mark, ringSize);

    // Push to global ring
    pushToRing(globalMarkRing, mark, ringSize);

    // Save as last mark for exchange
    lastMark = mark;

    // Visual feedback
    const line = mark.position.line + 1;
    const col = mark.position.character + 1;
    vscode.window.setStatusBarMessage(`Mark set at line ${line}, col ${col}`, 2000);

    // Brief highlight at mark position
    await flashMark(editor, mark.position);
}

/**
 * Pop mark and jump to it (document-local ring)
 */
export async function popMark(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const docRing = getDocumentRing(editor.document.uri);

    if (docRing.length === 0) {
        vscode.window.showInformationMessage('Mark ring is empty');
        return;
    }

    // Pop the most recent mark
    const mark = docRing.pop()!;

    // Before jumping, push current position so we can return
    const currentMark: Mark = {
        uri: editor.document.uri,
        position: editor.selection.active,
        timestamp: Date.now()
    };
    lastMark = currentMark;

    // Jump to the mark
    await jumpToMark(mark);
}

/**
 * Pop mark from global ring (can jump across documents)
 */
export async function popGlobalMark(): Promise<void> {
    if (globalMarkRing.length === 0) {
        vscode.window.showInformationMessage('Global mark ring is empty');
        return;
    }

    // Save current position before jumping
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        lastMark = {
            uri: editor.document.uri,
            position: editor.selection.active,
            timestamp: Date.now()
        };
    }

    // Pop and jump
    const mark = globalMarkRing.pop()!;
    await jumpToMark(mark);
}

/**
 * Exchange point and mark (like Emacs C-x C-x)
 * Swaps current position with the last mark
 */
export async function exchangePointAndMark(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    if (!lastMark) {
        vscode.window.showInformationMessage('No mark set');
        return;
    }

    // Save current position
    const currentPosition = editor.selection.active;
    const currentUri = editor.document.uri;

    // If mark is in same document, do the exchange
    if (lastMark.uri.toString() === currentUri.toString()) {
        // Jump to mark
        editor.selection = new vscode.Selection(lastMark.position, lastMark.position);
        editor.revealRange(
            new vscode.Range(lastMark.position, lastMark.position),
            vscode.TextEditorRevealType.InCenterIfOutsideViewport
        );

        // Update mark to previous position
        lastMark = {
            uri: currentUri,
            position: currentPosition,
            timestamp: Date.now()
        };

        vscode.window.setStatusBarMessage('Exchanged point and mark', 2000);
    } else {
        // Mark is in different document - just jump to it
        await jumpToMark(lastMark);
        lastMark = {
            uri: currentUri,
            position: currentPosition,
            timestamp: Date.now()
        };
    }
}

/**
 * Show the mark ring contents
 */
export async function showMarkRing(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    // Combine document-local and global rings for display
    const items: vscode.QuickPickItem[] = [];

    // Add document-local marks
    if (editor) {
        const docRing = getDocumentRing(editor.document.uri);
        if (docRing.length > 0) {
            items.push({
                label: '$(file) Local Marks',
                kind: vscode.QuickPickItemKind.Separator
            });

            for (let i = docRing.length - 1; i >= 0; i--) {
                const mark = docRing[i];
                const lineText = await getLinePreview(mark);
                items.push({
                    label: `Line ${mark.position.line + 1}, Col ${mark.position.character + 1}`,
                    description: lineText,
                    detail: `$(clock) ${formatTimestamp(mark.timestamp)}`
                });
            }
        }
    }

    // Add global marks
    if (globalMarkRing.length > 0) {
        items.push({
            label: '$(globe) Global Marks',
            kind: vscode.QuickPickItemKind.Separator
        });

        for (let i = globalMarkRing.length - 1; i >= 0; i--) {
            const mark = globalMarkRing[i];
            const filename = vscode.workspace.asRelativePath(mark.uri);
            const lineText = await getLinePreview(mark);
            items.push({
                label: `${filename}:${mark.position.line + 1}`,
                description: lineText,
                detail: `$(clock) ${formatTimestamp(mark.timestamp)}`
            });
        }
    }

    if (items.length === 0) {
        vscode.window.showInformationMessage('Mark ring is empty');
        return;
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a mark to jump to',
        title: 'Mark Ring'
    });

    if (selected && selected.kind !== vscode.QuickPickItemKind.Separator) {
        // Find the corresponding mark
        // Check local marks first
        if (editor) {
            const docRing = getDocumentRing(editor.document.uri);
            for (const mark of docRing) {
                const label = `Line ${mark.position.line + 1}, Col ${mark.position.character + 1}`;
                if (selected.label === label) {
                    await jumpToMark(mark);
                    return;
                }
            }
        }

        // Check global marks
        for (const mark of globalMarkRing) {
            const filename = vscode.workspace.asRelativePath(mark.uri);
            const label = `${filename}:${mark.position.line + 1}`;
            if (selected.label === label) {
                await jumpToMark(mark);
                return;
            }
        }
    }
}

/**
 * Clear the mark ring for current document
 */
export function clearMarkRing(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const key = editor.document.uri.toString();
        documentMarkRings.delete(key);
        vscode.window.setStatusBarMessage('Mark ring cleared', 2000);
    }
}

/**
 * Clear all mark rings
 */
export function clearAllMarkRings(): void {
    documentMarkRings.clear();
    globalMarkRing.length = 0;
    lastMark = undefined;
    vscode.window.setStatusBarMessage('All mark rings cleared', 2000);
}

/**
 * Jump to a mark position
 */
async function jumpToMark(mark: Mark): Promise<void> {
    // Open document if needed
    const document = await vscode.workspace.openTextDocument(mark.uri);
    const editor = await vscode.window.showTextDocument(document);

    // Validate position is still valid
    const maxLine = document.lineCount - 1;
    const line = Math.min(mark.position.line, maxLine);
    const maxCol = document.lineAt(line).text.length;
    const col = Math.min(mark.position.character, maxCol);
    const safePosition = new vscode.Position(line, col);

    // Jump to position
    editor.selection = new vscode.Selection(safePosition, safePosition);
    editor.revealRange(
        new vscode.Range(safePosition, safePosition),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );

    // Flash the position
    await flashMark(editor, safePosition);
}

/**
 * Flash highlight at a position for visual feedback
 */
async function flashMark(editor: vscode.TextEditor, position: vscode.Position): Promise<void> {
    const decoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '2px solid',
        borderColor: new vscode.ThemeColor('focusBorder'),
        isWholeLine: true
    });

    editor.setDecorations(decoration, [
        new vscode.Range(position, position)
    ]);

    // Remove after brief delay
    setTimeout(() => {
        decoration.dispose();
    }, 300);
}

/**
 * Get a preview of the line at a mark
 */
async function getLinePreview(mark: Mark): Promise<string> {
    try {
        const document = await vscode.workspace.openTextDocument(mark.uri);
        if (mark.position.line < document.lineCount) {
            const line = document.lineAt(mark.position.line).text.trim();
            return line.length > 60 ? line.substring(0, 60) + '...' : line;
        }
    } catch {
        // Document may no longer exist
    }
    return '(line not available)';
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ago`;
    } else if (minutes > 0) {
        return `${minutes}m ago`;
    } else {
        return 'just now';
    }
}

/**
 * Register all mark ring commands
 */
export function registerMarkCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.mark.push', pushMark),
        vscode.commands.registerCommand('scimax.mark.set', setMarkForSelection),
        vscode.commands.registerCommand('scimax.mark.cancel', cancelSelection),
        vscode.commands.registerCommand('scimax.mark.selectToMark', selectToMark),
        vscode.commands.registerCommand('scimax.mark.pop', popMark),
        vscode.commands.registerCommand('scimax.mark.popGlobal', popGlobalMark),
        vscode.commands.registerCommand('scimax.mark.exchange', exchangePointAndMark),
        vscode.commands.registerCommand('scimax.mark.show', showMarkRing),
        vscode.commands.registerCommand('scimax.mark.clear', clearMarkRing),
        vscode.commands.registerCommand('scimax.mark.clearAll', clearAllMarkRings)
    );

    // Clean up document rings when documents are closed
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(document => {
            const key = document.uri.toString();
            documentMarkRings.delete(key);
        })
    );

    console.log('Scimax: Mark ring commands registered');
}
