/**
 * Block Decorations for org-mode
 * Adds background colors to source blocks, example blocks, etc.
 */

import * as vscode from 'vscode';

// Decoration types for different block backgrounds
let srcBlockDecoration: vscode.TextEditorDecorationType;
let srcBlockHeaderDecoration: vscode.TextEditorDecorationType;
let exampleBlockDecoration: vscode.TextEditorDecorationType;
let quoteBlockDecoration: vscode.TextEditorDecorationType;
let resultsDecoration: vscode.TextEditorDecorationType;
let tableDecoration: vscode.TextEditorDecorationType;

/**
 * Initialize decoration types with theme-configurable colors
 * Colors can be set in theme files or workbench.colorCustomizations
 */
function createDecorationTypes(): void {
    // Dispose existing decorations if any
    srcBlockDecoration?.dispose();
    srcBlockHeaderDecoration?.dispose();
    exampleBlockDecoration?.dispose();
    quoteBlockDecoration?.dispose();
    resultsDecoration?.dispose();
    tableDecoration?.dispose();

    // Source block body - uses theme color 'scimax.srcBlockBackground'
    srcBlockDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('scimax.srcBlockBackground'),
        isWholeLine: true,
    });

    // Source block header/footer - uses theme color 'scimax.srcBlockHeaderBackground'
    srcBlockHeaderDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('scimax.srcBlockHeaderBackground'),
        isWholeLine: true,
    });

    // Example block - uses theme color 'scimax.exampleBlockBackground'
    exampleBlockDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('scimax.exampleBlockBackground'),
        isWholeLine: true,
    });

    // Quote block - uses theme color 'scimax.quoteBlockBackground'
    quoteBlockDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('scimax.quoteBlockBackground'),
        isWholeLine: true,
    });

    // Results block - uses theme color 'scimax.resultsBackground'
    resultsDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('scimax.resultsBackground'),
        isWholeLine: true,
    });

    // Table - uses theme color 'scimax.tableBackground'
    tableDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('scimax.tableBackground'),
        isWholeLine: true,
    });
}

/**
 * Update decorations for the given editor
 */
function updateDecorations(editor: vscode.TextEditor): void {
    if (editor.document.languageId !== 'org') {
        return;
    }

    const text = editor.document.getText();
    const lines = text.split('\n');

    const srcBlockHeaders: vscode.DecorationOptions[] = [];
    const srcBlockBodies: vscode.DecorationOptions[] = [];
    const exampleBlocks: vscode.DecorationOptions[] = [];
    const quoteBlocks: vscode.DecorationOptions[] = [];
    const resultsBlocks: vscode.DecorationOptions[] = [];
    const tableRows: vscode.DecorationOptions[] = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const lineLower = line.toLowerCase();

        // Source blocks
        if (lineLower.match(/^#\+begin_src/i)) {
            // Header line
            srcBlockHeaders.push({
                range: new vscode.Range(i, 0, i, line.length),
            });
            i++;

            // Body lines
            while (i < lines.length && !lines[i].toLowerCase().match(/^#\+end_src/i)) {
                srcBlockBodies.push({
                    range: new vscode.Range(i, 0, i, lines[i].length),
                });
                i++;
            }

            // Footer line
            if (i < lines.length) {
                srcBlockHeaders.push({
                    range: new vscode.Range(i, 0, i, lines[i].length),
                });
            }
            i++;
            continue;
        }

        // Example blocks
        if (lineLower.match(/^#\+begin_example/i)) {
            exampleBlocks.push({
                range: new vscode.Range(i, 0, i, line.length),
            });
            i++;

            while (i < lines.length && !lines[i].toLowerCase().match(/^#\+end_example/i)) {
                exampleBlocks.push({
                    range: new vscode.Range(i, 0, i, lines[i].length),
                });
                i++;
            }

            if (i < lines.length) {
                exampleBlocks.push({
                    range: new vscode.Range(i, 0, i, lines[i].length),
                });
            }
            i++;
            continue;
        }

        // Quote blocks
        if (lineLower.match(/^#\+begin_quote/i)) {
            quoteBlocks.push({
                range: new vscode.Range(i, 0, i, line.length),
            });
            i++;

            while (i < lines.length && !lines[i].toLowerCase().match(/^#\+end_quote/i)) {
                quoteBlocks.push({
                    range: new vscode.Range(i, 0, i, lines[i].length),
                });
                i++;
            }

            if (i < lines.length) {
                quoteBlocks.push({
                    range: new vscode.Range(i, 0, i, lines[i].length),
                });
            }
            i++;
            continue;
        }

        // Results blocks (#+RESULTS: and following content)
        if (line.match(/^#\+RESULTS:/i)) {
            resultsBlocks.push({
                range: new vscode.Range(i, 0, i, line.length),
            });
            i++;

            // Include following lines that are part of results
            // (: prefixed lines, or lines until blank line or next element)
            while (i < lines.length) {
                const resultLine = lines[i];
                // Results can be: lines, drawer, table, or other output
                if (resultLine.match(/^:/)) {
                    // : prefixed result lines
                    resultsBlocks.push({
                        range: new vscode.Range(i, 0, i, resultLine.length),
                    });
                    i++;
                } else if (resultLine.match(/^#\+begin_/i)) {
                    // Result in a drawer/block
                    resultsBlocks.push({
                        range: new vscode.Range(i, 0, i, resultLine.length),
                    });
                    i++;
                    const endPattern = resultLine.match(/^#\+begin_(\w+)/i)?.[1];
                    while (i < lines.length && !lines[i].toLowerCase().match(new RegExp(`^#\\+end_${endPattern}`, 'i'))) {
                        resultsBlocks.push({
                            range: new vscode.Range(i, 0, i, lines[i].length),
                        });
                        i++;
                    }
                    if (i < lines.length) {
                        resultsBlocks.push({
                            range: new vscode.Range(i, 0, i, lines[i].length),
                        });
                        i++;
                    }
                } else if (resultLine.match(/^\s*\|/)) {
                    // Table result
                    while (i < lines.length && lines[i].match(/^\s*\|/)) {
                        resultsBlocks.push({
                            range: new vscode.Range(i, 0, i, lines[i].length),
                        });
                        i++;
                    }
                } else if (resultLine.trim() === '') {
                    // Blank line ends simple results
                    break;
                } else {
                    // Other content - might be single line result
                    break;
                }
            }
            continue;
        }

        // Tables (not inside results blocks)
        if (line.match(/^\s*\|/)) {
            while (i < lines.length && lines[i].match(/^\s*\|/)) {
                tableRows.push({
                    range: new vscode.Range(i, 0, i, lines[i].length),
                });
                i++;
            }
            continue;
        }

        i++;
    }

    // Apply decorations
    editor.setDecorations(srcBlockHeaderDecoration, srcBlockHeaders);
    editor.setDecorations(srcBlockDecoration, srcBlockBodies);
    editor.setDecorations(exampleBlockDecoration, exampleBlocks);
    editor.setDecorations(quoteBlockDecoration, quoteBlocks);
    editor.setDecorations(resultsDecoration, resultsBlocks);
    editor.setDecorations(tableDecoration, tableRows);
}

/**
 * Trigger decoration update with debouncing
 */
let updateTimeout: NodeJS.Timeout | undefined;

function triggerUpdateDecorations(editor: vscode.TextEditor): void {
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }
    updateTimeout = setTimeout(() => updateDecorations(editor), 100);
}

/**
 * Register block decorations
 */
export function registerBlockDecorations(context: vscode.ExtensionContext): void {
    createDecorationTypes();

    // Update decorations for active editor
    if (vscode.window.activeTextEditor) {
        triggerUpdateDecorations(vscode.window.activeTextEditor);
    }

    // Update when active editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                triggerUpdateDecorations(editor);
            }
        })
    );

    // Update when document changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document) {
                triggerUpdateDecorations(editor);
            }
        })
    );

    // Update when configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('scimax.org')) {
                createDecorationTypes();
                if (vscode.window.activeTextEditor) {
                    updateDecorations(vscode.window.activeTextEditor);
                }
            }
        })
    );

    // Dispose decoration types on deactivation
    context.subscriptions.push({
        dispose: () => {
            srcBlockDecoration?.dispose();
            srcBlockHeaderDecoration?.dispose();
            exampleBlockDecoration?.dispose();
            quoteBlockDecoration?.dispose();
            resultsDecoration?.dispose();
            tableDecoration?.dispose();
        }
    });

    console.log('Scimax: Block decorations registered');
}
