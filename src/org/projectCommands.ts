/**
 * Commands to insert the project-management dynamic blocks (task table, Gantt).
 * Each inserts a skeleton `#+BEGIN: … #+END:` at the cursor and immediately
 * populates it via the existing dynamic-block update command.
 */
import * as vscode from 'vscode';

function isOrg(doc: vscode.TextDocument): boolean {
    return doc.languageId === 'org' || doc.fileName.endsWith('.org');
}

async function insertBlock(header: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isOrg(editor.document)) {
        vscode.window.showWarningMessage('Open an org file first.');
        return;
    }
    const pos = editor.selection.active;
    const lineStart = new vscode.Position(pos.line, 0);
    const skeleton = `${header}\n#+END:\n`;
    await editor.edit(edit => edit.insert(lineStart, skeleton));
    // Put the cursor on the BEGIN line so the update command finds the block.
    const begin = new vscode.Position(pos.line, 0);
    editor.selection = new vscode.Selection(begin, begin);
    await vscode.commands.executeCommand('scimax.org.updateDynamicBlock');
}

export function registerProjectCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.insertProjectTable', () =>
            insertBlock('#+BEGIN: project-table :columns task,todo,priority,assignee,deadline,effort,blocked')
        ),
        vscode.commands.registerCommand('scimax.org.insertGantt', () =>
            insertBlock('#+BEGIN: gantt :sections assignee')
        )
    );
}
