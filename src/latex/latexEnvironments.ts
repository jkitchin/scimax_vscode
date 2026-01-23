/**
 * LaTeX Environment Commands
 * Select, change, wrap, and unwrap LaTeX environments
 */

import * as vscode from 'vscode';
import { getEnvironments, LaTeXEnvironment } from './latexDocumentSymbolProvider';
import { findCurrentEnvironment } from './latexNavigation';

// Common LaTeX environments for quick selection
const COMMON_ENVIRONMENTS = [
    // Math
    { name: 'equation', description: 'Numbered equation' },
    { name: 'equation*', description: 'Unnumbered equation' },
    { name: 'align', description: 'Aligned equations (numbered)' },
    { name: 'align*', description: 'Aligned equations (unnumbered)' },
    { name: 'gather', description: 'Gathered equations' },
    { name: 'multline', description: 'Multi-line equation' },
    // Floats
    { name: 'figure', description: 'Figure float' },
    { name: 'table', description: 'Table float' },
    { name: 'tabular', description: 'Table content' },
    // Lists
    { name: 'itemize', description: 'Bulleted list' },
    { name: 'enumerate', description: 'Numbered list' },
    { name: 'description', description: 'Description list' },
    // Text formatting
    { name: 'center', description: 'Centered content' },
    { name: 'flushleft', description: 'Left-aligned content' },
    { name: 'flushright', description: 'Right-aligned content' },
    { name: 'quote', description: 'Short quotation' },
    { name: 'quotation', description: 'Long quotation' },
    { name: 'verse', description: 'Poetry/verse' },
    // Code
    { name: 'verbatim', description: 'Verbatim text' },
    { name: 'lstlisting', description: 'Code listing (listings)' },
    { name: 'minted', description: 'Code listing (minted)' },
    // Theorems
    { name: 'theorem', description: 'Theorem' },
    { name: 'lemma', description: 'Lemma' },
    { name: 'proposition', description: 'Proposition' },
    { name: 'corollary', description: 'Corollary' },
    { name: 'definition', description: 'Definition' },
    { name: 'proof', description: 'Proof' },
    { name: 'example', description: 'Example' },
    { name: 'remark', description: 'Remark' },
    // Other
    { name: 'abstract', description: 'Abstract' },
    { name: 'minipage', description: 'Mini page' },
    { name: 'frame', description: 'Beamer frame' },
];

/**
 * Select the entire current environment
 */
export async function selectEnvironment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const env = findCurrentEnvironment(editor.document, editor.selection.active);

    if (!env) {
        vscode.window.setStatusBarMessage('Not in an environment', 2000);
        return;
    }

    const startLine = env.line;
    const endLine = env.endLine;

    const range = new vscode.Range(
        new vscode.Position(startLine, 0),
        new vscode.Position(endLine, editor.document.lineAt(endLine).text.length)
    );

    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

/**
 * Select just the content inside the environment (not \begin and \end)
 */
export async function selectEnvironmentContent(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const env = findCurrentEnvironment(editor.document, editor.selection.active);

    if (!env) {
        vscode.window.setStatusBarMessage('Not in an environment', 2000);
        return;
    }

    // Content starts after \begin line, ends before \end line
    const startLine = env.line + 1;
    const endLine = env.endLine - 1;

    if (startLine > endLine) {
        // Empty environment
        const pos = new vscode.Position(env.line, editor.document.lineAt(env.line).text.length);
        editor.selection = new vscode.Selection(pos, pos);
        return;
    }

    const range = new vscode.Range(
        new vscode.Position(startLine, 0),
        new vscode.Position(endLine, editor.document.lineAt(endLine).text.length)
    );

    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

/**
 * Change the environment type
 */
export async function changeEnvironment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const env = findCurrentEnvironment(document, editor.selection.active);

    if (!env) {
        vscode.window.setStatusBarMessage('Not in an environment', 2000);
        return;
    }

    // Show QuickPick with common environments
    const items = COMMON_ENVIRONMENTS.map(e => ({
        label: e.name,
        description: e.description,
        name: e.name
    }));

    // Add current environment at top if not in list
    if (!COMMON_ENVIRONMENTS.find(e => e.name === env.name)) {
        items.unshift({
            label: env.name,
            description: '(current)',
            name: env.name
        });
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Change ${env.name} to...`,
        matchOnDescription: true
    });

    if (!selected || selected.name === env.name) {
        return;
    }

    const newEnvName = selected.name;

    // Update both \begin and \end
    await editor.edit(editBuilder => {
        // Update \begin line
        const beginLine = document.lineAt(env.line).text;
        const newBeginLine = beginLine.replace(
            `\\begin{${env.name}}`,
            `\\begin{${newEnvName}}`
        );
        editBuilder.replace(
            new vscode.Range(
                new vscode.Position(env.line, 0),
                new vscode.Position(env.line, beginLine.length)
            ),
            newBeginLine
        );

        // Update \end line
        const endLine = document.lineAt(env.endLine).text;
        const newEndLine = endLine.replace(
            `\\end{${env.name}}`,
            `\\end{${newEnvName}}`
        );
        editBuilder.replace(
            new vscode.Range(
                new vscode.Position(env.endLine, 0),
                new vscode.Position(env.endLine, endLine.length)
            ),
            newEndLine
        );
    });

    vscode.window.setStatusBarMessage(`Changed to ${newEnvName}`, 2000);
}

/**
 * Wrap selection in an environment
 */
export async function wrapInEnvironment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);

    // Show QuickPick with common environments
    const items = COMMON_ENVIRONMENTS.map(e => ({
        label: e.name,
        description: e.description,
        name: e.name
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Wrap selection in environment...',
        matchOnDescription: true
    });

    if (!selected) {
        return;
    }

    const envName = selected.name;

    // Determine indentation from first line of selection
    const startLine = editor.document.lineAt(selection.start.line).text;
    const indent = startLine.match(/^(\s*)/)?.[1] || '';

    // Build the wrapped text
    let wrappedText: string;
    if (selection.isEmpty) {
        // No selection, create empty environment
        wrappedText = `\\begin{${envName}}\n${indent}  \n${indent}\\end{${envName}}`;
    } else {
        // Indent the content
        const lines = selectedText.split('\n');
        const indentedContent = lines.map(line => `${indent}  ${line}`).join('\n');
        wrappedText = `\\begin{${envName}}\n${indentedContent}\n${indent}\\end{${envName}}`;
    }

    await editor.edit(editBuilder => {
        editBuilder.replace(selection, wrappedText);
    });

    // Position cursor inside if empty
    if (selection.isEmpty) {
        const newPos = new vscode.Position(selection.start.line + 1, indent.length + 2);
        editor.selection = new vscode.Selection(newPos, newPos);
    }

    vscode.window.setStatusBarMessage(`Wrapped in ${envName}`, 2000);
}

/**
 * Unwrap environment (remove \begin and \end, keep content)
 */
export async function unwrapEnvironment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const env = findCurrentEnvironment(document, editor.selection.active);

    if (!env) {
        vscode.window.setStatusBarMessage('Not in an environment', 2000);
        return;
    }

    // Get the content between \begin and \end
    let content = '';
    if (env.endLine > env.line + 1) {
        const contentRange = new vscode.Range(
            new vscode.Position(env.line + 1, 0),
            new vscode.Position(env.endLine - 1, document.lineAt(env.endLine - 1).text.length)
        );
        content = document.getText(contentRange);

        // Remove one level of indentation if present
        const lines = content.split('\n');
        const dedentedLines = lines.map(line => {
            if (line.startsWith('  ')) return line.substring(2);
            if (line.startsWith('\t')) return line.substring(1);
            return line;
        });
        content = dedentedLines.join('\n');
    }

    // Replace the entire environment with just the content
    const envRange = new vscode.Range(
        new vscode.Position(env.line, 0),
        new vscode.Position(env.endLine, document.lineAt(env.endLine).text.length)
    );

    await editor.edit(editBuilder => {
        editBuilder.replace(envRange, content);
    });

    vscode.window.setStatusBarMessage(`Unwrapped ${env.name}`, 2000);
}

/**
 * Delete the current environment (content and delimiters)
 */
export async function deleteEnvironment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const env = findCurrentEnvironment(document, editor.selection.active);

    if (!env) {
        vscode.window.setStatusBarMessage('Not in an environment', 2000);
        return;
    }

    // Copy to clipboard first
    const envRange = new vscode.Range(
        new vscode.Position(env.line, 0),
        new vscode.Position(env.endLine, document.lineAt(env.endLine).text.length)
    );
    const envText = document.getText(envRange);
    await vscode.env.clipboard.writeText(envText);

    // Delete with trailing newline if present
    const deleteRange = new vscode.Range(
        new vscode.Position(env.line, 0),
        env.endLine < document.lineCount - 1
            ? new vscode.Position(env.endLine + 1, 0)
            : new vscode.Position(env.endLine, document.lineAt(env.endLine).text.length)
    );

    await editor.edit(editBuilder => {
        editBuilder.delete(deleteRange);
    });

    vscode.window.setStatusBarMessage(`Deleted ${env.name} (copied to clipboard)`, 2000);
}

/**
 * Toggle starred variant of environment (e.g., equation <-> equation*)
 */
export async function toggleEnvironmentStar(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const env = findCurrentEnvironment(document, editor.selection.active);

    if (!env) {
        vscode.window.setStatusBarMessage('Not in an environment', 2000);
        return;
    }

    let newName: string;
    if (env.name.endsWith('*')) {
        newName = env.name.slice(0, -1);
    } else {
        newName = env.name + '*';
    }

    // Update both \begin and \end
    await editor.edit(editBuilder => {
        // Update \begin line
        const beginLine = document.lineAt(env.line).text;
        const newBeginLine = beginLine.replace(
            `\\begin{${env.name}}`,
            `\\begin{${newName}}`
        );
        editBuilder.replace(
            new vscode.Range(
                new vscode.Position(env.line, 0),
                new vscode.Position(env.line, beginLine.length)
            ),
            newBeginLine
        );

        // Update \end line
        const endLine = document.lineAt(env.endLine).text;
        const newEndLine = endLine.replace(
            `\\end{${env.name}}`,
            `\\end{${newName}}`
        );
        editBuilder.replace(
            new vscode.Range(
                new vscode.Position(env.endLine, 0),
                new vscode.Position(env.endLine, endLine.length)
            ),
            newEndLine
        );
    });

    vscode.window.setStatusBarMessage(`Changed to ${newName}`, 2000);
}

/**
 * Add a label to the current environment
 * If there's an existing label, it will be pre-filled and replaced
 */
export async function addLabelToEnvironment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const env = findCurrentEnvironment(document, editor.selection.active);

    if (!env) {
        vscode.window.setStatusBarMessage('Not in an environment', 2000);
        return;
    }

    // Check for existing label within the environment
    let existingLabel: { name: string; line: number; start: number; end: number } | null = null;
    const labelPattern = /\\label\{([^}]+)\}/;

    // Find the end of the environment
    let envEndLine = env.line;
    for (let i = env.line + 1; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text;
        if (lineText.includes(`\\end{${env.name}}`)) {
            envEndLine = i;
            break;
        }
    }

    // Search for label within environment bounds
    for (let i = env.line; i <= envEndLine; i++) {
        const lineText = document.lineAt(i).text;
        const match = labelPattern.exec(lineText);
        if (match) {
            existingLabel = {
                name: match[1],
                line: i,
                start: match.index,
                end: match.index + match[0].length
            };
            break;
        }
    }

    // Determine default value for input
    let defaultValue = '';
    let valueSelection: [number, number] = [0, 0];

    if (existingLabel) {
        // Pre-fill with existing label
        defaultValue = existingLabel.name;
        valueSelection = [0, defaultValue.length];
    } else {
        // Suggest a label prefix based on environment type
        switch (env.name.replace('*', '')) {
            case 'figure':
                defaultValue = 'fig:';
                break;
            case 'table':
                defaultValue = 'tab:';
                break;
            case 'equation':
            case 'align':
            case 'gather':
            case 'multline':
                defaultValue = 'eq:';
                break;
            case 'theorem':
                defaultValue = 'thm:';
                break;
            case 'lemma':
                defaultValue = 'lem:';
                break;
            case 'definition':
                defaultValue = 'def:';
                break;
            case 'proposition':
                defaultValue = 'prop:';
                break;
            case 'corollary':
                defaultValue = 'cor:';
                break;
            case 'lstlisting':
            case 'minted':
                defaultValue = 'lst:';
                break;
            default:
                defaultValue = '';
        }
        valueSelection = [defaultValue.length, defaultValue.length];
    }

    const labelName = await vscode.window.showInputBox({
        prompt: existingLabel ? 'Edit label name' : 'Enter label name',
        value: defaultValue,
        valueSelection: valueSelection
    });

    if (!labelName) {
        return;
    }

    if (existingLabel) {
        // Replace existing label
        const labelLine = document.lineAt(existingLabel.line);
        const range = new vscode.Range(
            existingLabel.line, existingLabel.start,
            existingLabel.line, existingLabel.end
        );
        await editor.edit(editBuilder => {
            editBuilder.replace(range, `\\label{${labelName}}`);
        });
        vscode.window.setStatusBarMessage(`Updated \\label{${labelName}}`, 2000);
    } else {
        // Insert label after \begin line
        const insertLine = env.line;
        const beginLine = document.lineAt(insertLine).text;
        const indent = beginLine.match(/^(\s*)/)?.[1] || '';

        await editor.edit(editBuilder => {
            editBuilder.insert(
                new vscode.Position(insertLine + 1, 0),
                `${indent}  \\label{${labelName}}\n`
            );
        });
        vscode.window.setStatusBarMessage(`Added \\label{${labelName}}`, 2000);
    }
}

/**
 * Add a caption to the current environment (for figures/tables)
 */
export async function addCaptionToEnvironment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const env = findCurrentEnvironment(document, editor.selection.active);

    if (!env) {
        vscode.window.setStatusBarMessage('Not in an environment', 2000);
        return;
    }

    // Check if it's a float environment
    const floatEnvs = ['figure', 'figure*', 'table', 'table*', 'subfigure', 'subtable'];
    if (!floatEnvs.includes(env.name)) {
        vscode.window.setStatusBarMessage(`\\caption only works in float environments`, 2000);
        return;
    }

    const caption = await vscode.window.showInputBox({
        prompt: 'Enter caption text'
    });

    if (!caption) {
        return;
    }

    // Insert caption before \end line
    const insertLine = env.endLine;
    const endLine = document.lineAt(insertLine).text;
    const indent = endLine.match(/^(\s*)/)?.[1] || '';

    await editor.edit(editBuilder => {
        editBuilder.insert(
            new vscode.Position(insertLine, 0),
            `${indent}  \\caption{${caption}}\n`
        );
    });

    vscode.window.setStatusBarMessage('Added caption', 2000);
}

/**
 * Show information about the current environment
 */
export async function environmentInfo(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const env = findCurrentEnvironment(editor.document, editor.selection.active);

    if (!env) {
        vscode.window.setStatusBarMessage('Not in an environment', 2000);
        return;
    }

    // Find description
    const envInfo = COMMON_ENVIRONMENTS.find(e => e.name === env.name || e.name === env.name.replace('*', ''));
    const description = envInfo?.description || 'Custom environment';

    const lines = env.endLine - env.line + 1;
    let info = `${env.name}: ${description}\n`;
    info += `Lines: ${env.line + 1}-${env.endLine + 1} (${lines} lines)\n`;
    if (env.label) {
        info += `Label: ${env.label}\n`;
    }
    if (env.caption) {
        info += `Caption: ${env.caption}\n`;
    }

    vscode.window.showInformationMessage(info, { modal: false });
}
