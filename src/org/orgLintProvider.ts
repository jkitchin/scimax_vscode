/**
 * Org-lint VS Code integration
 * Provides diagnostics and commands for org-mode syntax checking
 */

import * as vscode from 'vscode';
import { lintOrgDocument, LintIssue, getCheckerDescriptions } from './orgLint';

export class OrgLintProvider implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('org-lint');
    }

    /**
     * Run lint on the current document and update diagnostics
     */
    public async runLintCommand(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }

        const document = editor.document;
        if (document.languageId !== 'org') {
            vscode.window.showWarningMessage('Not an org-mode file');
            return;
        }

        await this.updateDiagnostics(document);

        const diagnostics = this.diagnosticCollection.get(document.uri);
        const count = diagnostics?.length ?? 0;

        if (count === 0) {
            vscode.window.showInformationMessage('Org-lint: No issues found');
        } else {
            vscode.window.showInformationMessage(`Org-lint: Found ${count} issue${count === 1 ? '' : 's'}`);
            // Focus the Problems panel
            vscode.commands.executeCommand('workbench.actions.view.problems');
        }
    }

    /**
     * Update diagnostics for a document
     */
    public async updateDiagnostics(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== 'org') {
            return;
        }

        const config = vscode.workspace.getConfiguration('scimax.org.lint');
        const disabledCheckers = config.get<string[]>('disabledCheckers', []);

        const text = document.getText();
        const issues = lintOrgDocument(text, { disabledCheckers });

        const diagnostics = issues.map(issue => this.issueToDiagnostic(issue));
        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Clear diagnostics for a document
     */
    public clearDiagnostics(uri: vscode.Uri): void {
        this.diagnosticCollection.delete(uri);
    }

    /**
     * Show list of available checkers
     */
    public async showCheckers(): Promise<void> {
        const checkers = getCheckerDescriptions();
        const config = vscode.workspace.getConfiguration('scimax.org.lint');
        const disabledCheckers = new Set(config.get<string[]>('disabledCheckers', []));

        const items = checkers.map(c => ({
            label: `${disabledCheckers.has(c.id) ? '$(circle-slash)' : '$(check)'} ${c.name}`,
            description: c.id,
            detail: c.description,
            checker: c
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select checker to toggle',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            const newDisabled = [...disabledCheckers];
            if (disabledCheckers.has(selected.checker.id)) {
                // Enable it
                const idx = newDisabled.indexOf(selected.checker.id);
                if (idx >= 0) newDisabled.splice(idx, 1);
            } else {
                // Disable it
                newDisabled.push(selected.checker.id);
            }

            await config.update('disabledCheckers', newDisabled, vscode.ConfigurationTarget.Workspace);
            vscode.window.showInformationMessage(
                `Checker "${selected.checker.id}" ${disabledCheckers.has(selected.checker.id) ? 'enabled' : 'disabled'}`
            );
        }
    }

    private issueToDiagnostic(issue: LintIssue): vscode.Diagnostic {
        const diagnostic = new vscode.Diagnostic(
            issue.range,
            issue.message,
            issue.severity
        );
        diagnostic.source = 'org-lint';
        diagnostic.code = issue.code;
        return diagnostic;
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

/**
 * Register org-lint commands
 */
export function registerOrgLintCommands(
    context: vscode.ExtensionContext,
    provider: OrgLintProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.lint', () => provider.runLintCommand()),
        vscode.commands.registerCommand('scimax.org.lintCheckers', () => provider.showCheckers())
    );

    // Clear diagnostics when documents close
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(doc => {
            if (doc.languageId === 'org') {
                provider.clearDiagnostics(doc.uri);
            }
        })
    );

    console.log('Scimax: Org-lint commands registered');
}
