/**
 * Block Decorations for org-mode
 * Adds background colors to source blocks, example blocks, etc.
 * Supports per-language colors for source blocks
 */

import * as vscode from 'vscode';

// Decoration types for different block backgrounds
let srcBlockDecoration: vscode.TextEditorDecorationType;
let srcBlockHeaderDecoration: vscode.TextEditorDecorationType;
let exampleBlockDecoration: vscode.TextEditorDecorationType;
let quoteBlockDecoration: vscode.TextEditorDecorationType;
let resultsDecoration: vscode.TextEditorDecorationType;
let tableDecoration: vscode.TextEditorDecorationType;

// Per-language decoration types for source blocks
const languageDecorations: Map<string, vscode.TextEditorDecorationType> = new Map();
const languageHeaderDecorations: Map<string, vscode.TextEditorDecorationType> = new Map();

// Languages with specific colors (others fall back to default)
const SUPPORTED_LANGUAGES = [
    'python',
    'jupyter-python',
    'jupyter-julia',
    'jupyter-r',
    'bash',
    'shell',
    'sh',
    'emacs-lisp',
    'elisp',
    'javascript',
    'js',
    'typescript',
    'ts',
    'sql',
    'r',
    'julia',
    'rust',
    'go',
    'c',
    'cpp',
    'java',
];

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

    // Dispose language-specific decorations
    for (const decoration of languageDecorations.values()) {
        decoration.dispose();
    }
    languageDecorations.clear();

    for (const decoration of languageHeaderDecorations.values()) {
        decoration.dispose();
    }
    languageHeaderDecorations.clear();

    // Default source block body - uses theme color 'scimax.srcBlockBackground'
    srcBlockDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('scimax.srcBlockBackground'),
        isWholeLine: true,
    });

    // Default source block header/footer - uses theme color 'scimax.srcBlockHeaderBackground'
    srcBlockHeaderDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('scimax.srcBlockHeaderBackground'),
        isWholeLine: true,
    });

    // Create per-language decoration types
    for (const lang of SUPPORTED_LANGUAGES) {
        // Normalize language name for theme color key (replace hyphens with camelCase)
        const colorKey = normalizeLanguageKey(lang);

        // Body decoration for this language
        languageDecorations.set(lang, vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor(`scimax.srcBlock.${colorKey}Background`),
            isWholeLine: true,
        }));

        // Header decoration for this language
        languageHeaderDecorations.set(lang, vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor(`scimax.srcBlock.${colorKey}HeaderBackground`),
            isWholeLine: true,
        }));
    }

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
 * Normalize language name to camelCase for theme color keys
 * e.g., 'jupyter-python' -> 'jupyterPython', 'emacs-lisp' -> 'emacsLisp'
 */
function normalizeLanguageKey(lang: string): string {
    return lang.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
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

    // Default source block decorations (for languages without specific colors)
    const srcBlockHeaders: vscode.DecorationOptions[] = [];
    const srcBlockBodies: vscode.DecorationOptions[] = [];

    // Per-language source block decorations
    const languageBlockHeaders: Map<string, vscode.DecorationOptions[]> = new Map();
    const languageBlockBodies: Map<string, vscode.DecorationOptions[]> = new Map();

    // Initialize arrays for each supported language
    for (const lang of SUPPORTED_LANGUAGES) {
        languageBlockHeaders.set(lang, []);
        languageBlockBodies.set(lang, []);
    }

    const exampleBlocks: vscode.DecorationOptions[] = [];
    const quoteBlocks: vscode.DecorationOptions[] = [];
    const resultsBlocks: vscode.DecorationOptions[] = [];
    const tableRows: vscode.DecorationOptions[] = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const lineLower = line.toLowerCase();

        // Source blocks
        const srcMatch = line.match(/^#\+begin_src\s+(\S+)/i);
        if (srcMatch || lineLower.match(/^#\+begin_src\s*$/i)) {
            const language = srcMatch ? srcMatch[1].toLowerCase() : '';
            const hasLanguageColor = languageDecorations.has(language);

            // Header line
            if (hasLanguageColor) {
                languageBlockHeaders.get(language)!.push({
                    range: new vscode.Range(i, 0, i, line.length),
                });
            } else {
                srcBlockHeaders.push({
                    range: new vscode.Range(i, 0, i, line.length),
                });
            }
            i++;

            // Body lines
            while (i < lines.length && !lines[i].toLowerCase().match(/^#\+end_src/i)) {
                if (hasLanguageColor) {
                    languageBlockBodies.get(language)!.push({
                        range: new vscode.Range(i, 0, i, lines[i].length),
                    });
                } else {
                    srcBlockBodies.push({
                        range: new vscode.Range(i, 0, i, lines[i].length),
                    });
                }
                i++;
            }

            // Footer line
            if (i < lines.length) {
                if (hasLanguageColor) {
                    languageBlockHeaders.get(language)!.push({
                        range: new vscode.Range(i, 0, i, lines[i].length),
                    });
                } else {
                    srcBlockHeaders.push({
                        range: new vscode.Range(i, 0, i, lines[i].length),
                    });
                }
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

    // Apply default source block decorations
    editor.setDecorations(srcBlockHeaderDecoration, srcBlockHeaders);
    editor.setDecorations(srcBlockDecoration, srcBlockBodies);

    // Apply per-language source block decorations
    for (const lang of SUPPORTED_LANGUAGES) {
        const headerDecoration = languageHeaderDecorations.get(lang);
        const bodyDecoration = languageDecorations.get(lang);
        const headers = languageBlockHeaders.get(lang) || [];
        const bodies = languageBlockBodies.get(lang) || [];

        if (headerDecoration) {
            editor.setDecorations(headerDecoration, headers);
        }
        if (bodyDecoration) {
            editor.setDecorations(bodyDecoration, bodies);
        }
    }

    // Apply other block decorations
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

            // Dispose language-specific decorations
            for (const decoration of languageDecorations.values()) {
                decoration.dispose();
            }
            for (const decoration of languageHeaderDecorations.values()) {
                decoration.dispose();
            }
        }
    });

    console.log('Scimax: Block decorations registered');
}
