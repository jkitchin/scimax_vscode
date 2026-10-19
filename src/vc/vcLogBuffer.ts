/**
 * VC Log Buffer - an Emacs *vc-log* style buffer for writing commit messages
 *
 * The buffer is an untitled git-commit document. C-c C-c (scimax.vc.logFinish)
 * commits with the buffer text as the message and C-c C-k
 * (scimax.vc.logCancel) closes it without committing.
 */

import * as vscode from 'vscode';
import { setContextKey } from '../utils/contextKeys';
import { cleanCommitMessage } from './vcManager';

export interface VcLogRequest {
    /** Lines describing the commit, shown as # comments below the message */
    summary: string[];
    /** Perform the commit; a rejection keeps the buffer open for another try */
    onCommit: (message: string) => Promise<void>;
}

export class VcLogBuffer implements vscode.Disposable {
    private pending = new Map<string, VcLogRequest>();
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => this.updateContext(editor)),
            vscode.workspace.onDidCloseTextDocument((doc) => this.pending.delete(doc.uri.toString()))
        );
    }

    static template(summary: string[]): string {
        return [
            '',
            '',
            '# Write the commit message above. Lines starting with # are ignored.',
            '# C-c C-c to commit, C-c C-k to cancel.',
            '#',
            ...summary.map((line) => (line ? `# ${line}` : '#')),
            '',
        ].join('\n');
    }

    async open(request: VcLogRequest): Promise<void> {
        const content = VcLogBuffer.template(request.summary);
        let doc: vscode.TextDocument;
        try {
            doc = await vscode.workspace.openTextDocument({ language: 'git-commit', content });
        } catch {
            // git-commit is contributed by the built-in git extension
            doc = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
        }
        this.pending.set(doc.uri.toString(), request);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        editor.selection = new vscode.Selection(0, 0, 0, 0);
        this.updateContext(editor);
    }

    /** C-c C-c: commit using the active log buffer's text */
    async finish(): Promise<void> {
        const doc = vscode.window.activeTextEditor?.document;
        const request = doc && this.pending.get(doc.uri.toString());
        if (!doc || !request) {
            vscode.window.showWarningMessage('Not in a VC log buffer');
            return;
        }
        const message = cleanCommitMessage(doc.getText());
        if (!message) {
            vscode.window.showWarningMessage('Empty commit message; nothing committed');
            return;
        }
        try {
            await request.onCommit(message);
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
            return;
        }
        await this.close(doc);
    }

    /** C-c C-k: discard the active log buffer */
    async cancel(): Promise<void> {
        const doc = vscode.window.activeTextEditor?.document;
        if (!doc || !this.pending.has(doc.uri.toString())) {
            vscode.window.showWarningMessage('Not in a VC log buffer');
            return;
        }
        await this.close(doc);
        vscode.window.setStatusBarMessage('Commit cancelled', 3000);
    }

    private async close(doc: vscode.TextDocument): Promise<void> {
        this.pending.delete(doc.uri.toString());
        // Revert first so VS Code does not offer to save the untitled buffer
        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        this.updateContext(vscode.window.activeTextEditor);
    }

    private updateContext(editor: vscode.TextEditor | undefined): void {
        setContextKey('scimax.vcLogActive', !!editor && this.pending.has(editor.document.uri.toString()));
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        this.pending.clear();
    }
}
