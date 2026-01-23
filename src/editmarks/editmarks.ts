import * as vscode from 'vscode';

/**
 * Editmarks - Track Changes for Scientific Writing
 *
 * Inspired by scimax-editmarks for collaborative editing.
 * Provides markup for insertions, deletions, and comments
 * that works across org-mode, markdown, and LaTeX.
 *
 * Markup format (works in all formats):
 * - Insertion: @@+inserted text+@@
 * - Deletion:  @@-deleted text-@@
 * - Comment:   @@>comment text<@@
 * - Typo:      @@~old text|new text~@@
 *
 * Alternative markup for org-mode:
 * - Insertion: {++inserted text++}
 * - Deletion:  {--deleted text--}
 * - Comment:   {>>comment text<<}
 */

// Decoration types for editmarks
const insertionDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(0, 255, 0, 0.2)',
    border: '1px solid rgba(0, 200, 0, 0.5)',
    borderRadius: '2px'
});

const deletionDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 0, 0, 0.2)',
    textDecoration: 'line-through',
    border: '1px solid rgba(200, 0, 0, 0.5)',
    borderRadius: '2px'
});

const commentDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 255, 0, 0.2)',
    border: '1px solid rgba(200, 200, 0, 0.5)',
    borderRadius: '2px',
    fontStyle: 'italic'
});

const typoDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 165, 0, 0.2)',
    border: '1px solid rgba(200, 130, 0, 0.5)',
    borderRadius: '2px'
});

// Patterns for editmarks
const EDITMARK_PATTERNS = {
    // Universal format: @@+text+@@ @@-text-@@ @@>text<@@ @@~old|new~@@
    insertion: /@@\+([^+]*)\+@@/g,
    deletion: /@@-([^-]*)-@@/g,
    comment: /@@>([^<]*)<@@/g,
    typo: /@@~([^|]*)\|([^~]*)~@@/g,

    // CriticMarkup format: {++text++} {--text--} {>>text<<} {~~old~>new~~}
    insertionCritic: /\{\+\+([^+]*)\+\+\}/g,
    deletionCritic: /\{--([^-]*)--\}/g,
    commentCritic: /\{>>([^<]*)<<\}/g,
    typoCritic: /\{~~([^~]*)~>([^~]*)~~\}/g
};

interface EditMark {
    type: 'insertion' | 'deletion' | 'comment' | 'typo';
    range: vscode.Range;
    content: string;
    replacement?: string;  // For typos: the new text
    fullMatch: string;
}

/**
 * Find all editmarks in a document
 */
function findEditmarks(document: vscode.TextDocument): EditMark[] {
    const text = document.getText();
    const marks: EditMark[] = [];

    // Find insertions
    for (const pattern of [EDITMARK_PATTERNS.insertion, EDITMARK_PATTERNS.insertionCritic]) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            marks.push({
                type: 'insertion',
                range: new vscode.Range(startPos, endPos),
                content: match[1],
                fullMatch: match[0]
            });
        }
    }

    // Find deletions
    for (const pattern of [EDITMARK_PATTERNS.deletion, EDITMARK_PATTERNS.deletionCritic]) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            marks.push({
                type: 'deletion',
                range: new vscode.Range(startPos, endPos),
                content: match[1],
                fullMatch: match[0]
            });
        }
    }

    // Find comments
    for (const pattern of [EDITMARK_PATTERNS.comment, EDITMARK_PATTERNS.commentCritic]) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            marks.push({
                type: 'comment',
                range: new vscode.Range(startPos, endPos),
                content: match[1],
                fullMatch: match[0]
            });
        }
    }

    // Find typos
    for (const pattern of [EDITMARK_PATTERNS.typo, EDITMARK_PATTERNS.typoCritic]) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            marks.push({
                type: 'typo',
                range: new vscode.Range(startPos, endPos),
                content: match[1],
                replacement: match[2],
                fullMatch: match[0]
            });
        }
    }

    return marks;
}

/**
 * Update decorations for editmarks
 */
function updateDecorations(editor: vscode.TextEditor): void {
    const marks = findEditmarks(editor.document);

    const insertions: vscode.DecorationOptions[] = [];
    const deletions: vscode.DecorationOptions[] = [];
    const comments: vscode.DecorationOptions[] = [];
    const typos: vscode.DecorationOptions[] = [];

    for (const mark of marks) {
        const decoration: vscode.DecorationOptions = {
            range: mark.range,
            hoverMessage: getHoverMessage(mark)
        };

        switch (mark.type) {
            case 'insertion':
                insertions.push(decoration);
                break;
            case 'deletion':
                deletions.push(decoration);
                break;
            case 'comment':
                comments.push(decoration);
                break;
            case 'typo':
                typos.push(decoration);
                break;
        }
    }

    editor.setDecorations(insertionDecorationType, insertions);
    editor.setDecorations(deletionDecorationType, deletions);
    editor.setDecorations(commentDecorationType, comments);
    editor.setDecorations(typoDecorationType, typos);
}

/**
 * Get hover message for an editmark
 */
function getHoverMessage(mark: EditMark): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    switch (mark.type) {
        case 'insertion':
            md.appendMarkdown(`**Insertion:** "${mark.content}"\n\n`);
            md.appendMarkdown(`[Accept](command:scimax.editmarks.accept) | [Reject](command:scimax.editmarks.reject)`);
            break;
        case 'deletion':
            md.appendMarkdown(`**Deletion:** "${mark.content}"\n\n`);
            md.appendMarkdown(`[Accept](command:scimax.editmarks.accept) | [Reject](command:scimax.editmarks.reject)`);
            break;
        case 'comment':
            md.appendMarkdown(`**Comment:** ${mark.content}\n\n`);
            md.appendMarkdown(`[Delete Comment](command:scimax.editmarks.accept)`);
            break;
        case 'typo':
            md.appendMarkdown(`**Typo correction:** "${mark.content}" → "${mark.replacement}"\n\n`);
            md.appendMarkdown(`[Accept](command:scimax.editmarks.accept) | [Reject](command:scimax.editmarks.reject)`);
            break;
    }

    return md;
}

/**
 * Insert an insertion mark around selected text
 */
async function insertInsertion(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;

    if (selection.isEmpty) {
        // No selection - prompt for text
        const text = await vscode.window.showInputBox({
            prompt: 'Enter text to insert',
            placeHolder: 'inserted text'
        });

        if (text) {
            await editor.edit(editBuilder => {
                editBuilder.insert(selection.start, `@@+${text}+@@`);
            });
        }
    } else {
        // Wrap selection
        const selectedText = editor.document.getText(selection);
        await editor.edit(editBuilder => {
            editBuilder.replace(selection, `@@+${selectedText}+@@`);
        });
    }

    updateDecorations(editor);
}

/**
 * Mark selected text for deletion
 */
async function insertDeletion(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;

    if (selection.isEmpty) {
        vscode.window.showInformationMessage('Select text to mark for deletion');
        return;
    }

    const selectedText = editor.document.getText(selection);
    await editor.edit(editBuilder => {
        editBuilder.replace(selection, `@@-${selectedText}-@@`);
    });

    updateDecorations(editor);
}

/**
 * Insert a comment mark
 */
async function insertComment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;
    let commentText: string | undefined;

    if (selection.isEmpty) {
        // No selection - prompt for comment
        commentText = await vscode.window.showInputBox({
            prompt: 'Enter comment',
            placeHolder: 'Your comment here'
        });
    } else {
        // Selection becomes the comment
        commentText = editor.document.getText(selection);
    }

    if (commentText) {
        await editor.edit(editBuilder => {
            if (selection.isEmpty) {
                editBuilder.insert(selection.start, `@@>${commentText}<@@`);
            } else {
                editBuilder.replace(selection, `@@>${commentText}<@@`);
            }
        });
    }

    updateDecorations(editor);
}

/**
 * Mark a typo correction (select wrong text, enter correct text)
 * If no selection, uses the word at cursor position
 */
async function insertTypo(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    let selection = editor.selection;

    // If no selection, select the word at cursor
    if (selection.isEmpty) {
        const position = selection.active;
        const wordRange = editor.document.getWordRangeAtPosition(position);
        if (!wordRange) {
            vscode.window.showInformationMessage('No word at cursor position');
            return;
        }
        selection = new vscode.Selection(wordRange.start, wordRange.end);
    }

    const wrongText = editor.document.getText(selection);
    const correctText = await vscode.window.showInputBox({
        prompt: `Replace "${wrongText}" with:`,
        placeHolder: 'correct text'
    });

    if (correctText) {
        await editor.edit(editBuilder => {
            editBuilder.replace(selection, `@@~${wrongText}|${correctText}~@@`);
        });
    }

    updateDecorations(editor);
}

/**
 * Find editmark at cursor position
 */
function findEditmarkAtCursor(editor: vscode.TextEditor): EditMark | null {
    const position = editor.selection.active;
    const marks = findEditmarks(editor.document);

    for (const mark of marks) {
        if (mark.range.contains(position)) {
            return mark;
        }
    }

    return null;
}

/**
 * Accept the editmark at cursor
 */
async function acceptEditmark(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const mark = findEditmarkAtCursor(editor);
    if (!mark) {
        vscode.window.showInformationMessage('No editmark at cursor');
        return;
    }

    await editor.edit(editBuilder => {
        switch (mark.type) {
            case 'insertion':
                // Keep the inserted text, remove markup
                editBuilder.replace(mark.range, mark.content);
                break;
            case 'deletion':
                // Accept deletion - remove the text entirely
                editBuilder.replace(mark.range, '');
                break;
            case 'comment':
                // Remove the comment
                editBuilder.replace(mark.range, '');
                break;
            case 'typo':
                // Accept the correction
                editBuilder.replace(mark.range, mark.replacement || '');
                break;
        }
    });

    updateDecorations(editor);
}

/**
 * Reject the editmark at cursor
 */
async function rejectEditmark(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const mark = findEditmarkAtCursor(editor);
    if (!mark) {
        vscode.window.showInformationMessage('No editmark at cursor');
        return;
    }

    await editor.edit(editBuilder => {
        switch (mark.type) {
            case 'insertion':
                // Reject insertion - remove entirely
                editBuilder.replace(mark.range, '');
                break;
            case 'deletion':
                // Reject deletion - keep the original text
                editBuilder.replace(mark.range, mark.content);
                break;
            case 'comment':
                // Keep the comment (or remove it)
                editBuilder.replace(mark.range, '');
                break;
            case 'typo':
                // Reject correction - keep original
                editBuilder.replace(mark.range, mark.content);
                break;
        }
    });

    updateDecorations(editor);
}

/**
 * Accept all editmarks in document
 */
async function acceptAllEditmarks(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const marks = findEditmarks(editor.document);
    if (marks.length === 0) {
        vscode.window.showInformationMessage('No editmarks in document');
        return;
    }

    const confirm = await vscode.window.showWarningMessage(
        `Accept all ${marks.length} editmarks?`,
        'Yes',
        'No'
    );

    if (confirm !== 'Yes') return;

    // Sort marks by position (reverse order to edit from end to start)
    marks.sort((a, b) => b.range.start.compareTo(a.range.start));

    await editor.edit(editBuilder => {
        for (const mark of marks) {
            switch (mark.type) {
                case 'insertion':
                    editBuilder.replace(mark.range, mark.content);
                    break;
                case 'deletion':
                    editBuilder.replace(mark.range, '');
                    break;
                case 'comment':
                    editBuilder.replace(mark.range, '');
                    break;
                case 'typo':
                    editBuilder.replace(mark.range, mark.replacement || '');
                    break;
            }
        }
    });

    updateDecorations(editor);
    vscode.window.showInformationMessage(`Accepted ${marks.length} editmarks`);
}

/**
 * Reject all editmarks in document
 */
async function rejectAllEditmarks(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const marks = findEditmarks(editor.document);
    if (marks.length === 0) {
        vscode.window.showInformationMessage('No editmarks in document');
        return;
    }

    const confirm = await vscode.window.showWarningMessage(
        `Reject all ${marks.length} editmarks?`,
        'Yes',
        'No'
    );

    if (confirm !== 'Yes') return;

    // Sort marks by position (reverse order)
    marks.sort((a, b) => b.range.start.compareTo(a.range.start));

    await editor.edit(editBuilder => {
        for (const mark of marks) {
            switch (mark.type) {
                case 'insertion':
                    editBuilder.replace(mark.range, '');
                    break;
                case 'deletion':
                    editBuilder.replace(mark.range, mark.content);
                    break;
                case 'comment':
                    editBuilder.replace(mark.range, '');
                    break;
                case 'typo':
                    editBuilder.replace(mark.range, mark.content);
                    break;
            }
        }
    });

    updateDecorations(editor);
    vscode.window.showInformationMessage(`Rejected ${marks.length} editmarks`);
}

/**
 * Navigate to next editmark
 */
async function nextEditmark(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const marks = findEditmarks(editor.document);
    if (marks.length === 0) {
        vscode.window.showInformationMessage('No editmarks in document');
        return;
    }

    const position = editor.selection.active;

    // Sort by position
    marks.sort((a, b) => a.range.start.compareTo(b.range.start));

    // Find next mark after cursor
    let nextMark = marks.find(m => m.range.start.isAfter(position));

    // Wrap around if no mark found after cursor
    if (!nextMark) {
        nextMark = marks[0];
    }

    editor.selection = new vscode.Selection(nextMark.range.start, nextMark.range.start);
    editor.revealRange(nextMark.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/**
 * Navigate to previous editmark
 */
async function prevEditmark(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const marks = findEditmarks(editor.document);
    if (marks.length === 0) {
        vscode.window.showInformationMessage('No editmarks in document');
        return;
    }

    const position = editor.selection.active;

    // Sort by position (reverse)
    marks.sort((a, b) => b.range.start.compareTo(a.range.start));

    // Find previous mark before cursor
    let prevMark = marks.find(m => m.range.start.isBefore(position));

    // Wrap around
    if (!prevMark) {
        prevMark = marks[0];
    }

    editor.selection = new vscode.Selection(prevMark.range.start, prevMark.range.start);
    editor.revealRange(prevMark.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/**
 * Show summary of all editmarks in document
 */
async function showEditmarkSummary(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const marks = findEditmarks(editor.document);

    if (marks.length === 0) {
        vscode.window.showInformationMessage('No editmarks in document');
        return;
    }

    const insertions = marks.filter(m => m.type === 'insertion').length;
    const deletions = marks.filter(m => m.type === 'deletion').length;
    const comments = marks.filter(m => m.type === 'comment').length;
    const typos = marks.filter(m => m.type === 'typo').length;

    const items: (vscode.QuickPickItem & { mark?: EditMark })[] = [
        { label: `$(info) Summary`, description: `${marks.length} total editmarks`, kind: vscode.QuickPickItemKind.Separator },
        { label: `$(add) Insertions: ${insertions}`, description: 'Green' },
        { label: `$(remove) Deletions: ${deletions}`, description: 'Red' },
        { label: `$(comment) Comments: ${comments}`, description: 'Yellow' },
        { label: `$(edit) Typos: ${typos}`, description: 'Orange' },
        { label: '', kind: vscode.QuickPickItemKind.Separator }
    ];

    // Add individual marks
    for (const mark of marks) {
        const icon = mark.type === 'insertion' ? '$(add)' :
                     mark.type === 'deletion' ? '$(remove)' :
                     mark.type === 'comment' ? '$(comment)' : '$(edit)';
        const preview = mark.content.slice(0, 40) + (mark.content.length > 40 ? '...' : '');

        items.push({
            label: `${icon} ${preview}`,
            description: `Line ${mark.range.start.line + 1}`,
            mark
        });
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Editmarks Summary - Select to navigate',
        matchOnDescription: true
    });

    if (selected?.mark) {
        editor.selection = new vscode.Selection(selected.mark.range.start, selected.mark.range.start);
        editor.revealRange(selected.mark.range, vscode.TextEditorRevealType.InCenter);
    }
}

/**
 * Register editmark commands
 */
export function registerEditmarkCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        // Insert marks
        vscode.commands.registerCommand('scimax.editmarks.insertion', insertInsertion),
        vscode.commands.registerCommand('scimax.editmarks.deletion', insertDeletion),
        vscode.commands.registerCommand('scimax.editmarks.comment', insertComment),
        vscode.commands.registerCommand('scimax.editmarks.typo', insertTypo),

        // Accept/reject
        vscode.commands.registerCommand('scimax.editmarks.accept', acceptEditmark),
        vscode.commands.registerCommand('scimax.editmarks.reject', rejectEditmark),
        vscode.commands.registerCommand('scimax.editmarks.acceptAll', acceptAllEditmarks),
        vscode.commands.registerCommand('scimax.editmarks.rejectAll', rejectAllEditmarks),

        // Navigation
        vscode.commands.registerCommand('scimax.editmarks.next', nextEditmark),
        vscode.commands.registerCommand('scimax.editmarks.prev', prevEditmark),

        // Summary
        vscode.commands.registerCommand('scimax.editmarks.summary', showEditmarkSummary)
    );

    // Update decorations on editor change
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                updateDecorations(editor);
            }
        }),
        vscode.workspace.onDidChangeTextDocument(e => {
            const editor = vscode.window.activeTextEditor;
            if (editor && e.document === editor.document) {
                updateDecorations(editor);
            }
        })
    );

    // Initial decoration update
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        updateDecorations(editor);
    }

    console.log('Scimax: Editmark commands registered');
}
