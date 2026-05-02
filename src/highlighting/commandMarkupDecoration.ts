/**
 * Theme-independent decoration for Emacs-style `command' markup in org files.
 *
 * The TextMate grammar tags these ranges as markup.command.{content,delimiter}.org
 * but only the Leuven theme styles those scopes. This provider renders the same
 * coloring on every theme using ThemeColor refs registered in package.json
 * (scimax.commandMarkupForeground, scimax.commandMarkupDelimiterForeground),
 * which users can override via workbench.colorCustomizations.
 */

import * as vscode from 'vscode';

const COMMAND_PATTERN = /`([^`'\n]+)'/g;

let contentDecoration: vscode.TextEditorDecorationType | undefined;
let delimiterDecoration: vscode.TextEditorDecorationType | undefined;

function createDecorationTypes(): void {
    contentDecoration?.dispose();
    delimiterDecoration?.dispose();

    contentDecoration = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('scimax.commandMarkupForeground'),
    });
    delimiterDecoration = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('scimax.commandMarkupDelimiterForeground'),
    });
}

function updateDecorations(editor: vscode.TextEditor): void {
    if (editor.document.languageId !== 'org' || !contentDecoration || !delimiterDecoration) {
        return;
    }

    const contentRanges: vscode.Range[] = [];
    const delimiterRanges: vscode.Range[] = [];

    const lineCount = editor.document.lineCount;
    for (let lineNum = 0; lineNum < lineCount; lineNum++) {
        const lineText = editor.document.lineAt(lineNum).text;
        if (lineText.indexOf('`') < 0 || lineText.indexOf("'") < 0) {
            continue;
        }
        const re = new RegExp(COMMAND_PATTERN.source, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(lineText)) !== null) {
            const start = m.index;
            const end = m.index + m[0].length;
            delimiterRanges.push(new vscode.Range(lineNum, start, lineNum, start + 1));
            contentRanges.push(new vscode.Range(lineNum, start + 1, lineNum, end - 1));
            delimiterRanges.push(new vscode.Range(lineNum, end - 1, lineNum, end));
        }
    }

    editor.setDecorations(contentDecoration, contentRanges);
    editor.setDecorations(delimiterDecoration, delimiterRanges);
}

const updateTimeouts = new WeakMap<vscode.TextEditor, NodeJS.Timeout>();

function triggerUpdateDecorations(editor: vscode.TextEditor): void {
    const existing = updateTimeouts.get(editor);
    if (existing) {
        clearTimeout(existing);
    }
    const timeout = setTimeout(() => updateDecorations(editor), 100);
    updateTimeouts.set(editor, timeout);
}

export function registerCommandMarkupDecorations(context: vscode.ExtensionContext): void {
    createDecorationTypes();

    for (const editor of vscode.window.visibleTextEditors) {
        triggerUpdateDecorations(editor);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(editors => {
            for (const editor of editors) {
                triggerUpdateDecorations(editor);
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document === event.document) {
                    triggerUpdateDecorations(editor);
                }
            }
        }),
        {
            dispose: () => {
                contentDecoration?.dispose();
                delimiterDecoration?.dispose();
            },
        }
    );
}
