import * as vscode from 'vscode';

/**
 * Jump to visible text - avy-style navigation
 * Inspired by https://github.com/abo-abo/avy
 */

// Jump label characters (ordered by ease of typing on home row)
const JUMP_CHARS = 'asdfjklghqweruiopzxcvbnmty';

interface JumpTarget {
    position: vscode.Position;
    label: string;
    lineText: string;
    matchText: string;
}

/**
 * Generate jump labels for targets
 * Uses single chars for small sets, double chars for larger sets
 */
function generateLabels(count: number): string[] {
    const labels: string[] = [];

    if (count <= JUMP_CHARS.length) {
        // Single character labels
        for (let i = 0; i < count && i < JUMP_CHARS.length; i++) {
            labels.push(JUMP_CHARS[i]);
        }
    } else {
        // Two character labels for more targets
        for (let i = 0; i < JUMP_CHARS.length && labels.length < count; i++) {
            for (let j = 0; j < JUMP_CHARS.length && labels.length < count; j++) {
                labels.push(JUMP_CHARS[i] + JUMP_CHARS[j]);
            }
        }
    }

    return labels;
}

/**
 * Find all visible positions matching a pattern
 */
function findVisibleMatches(
    editor: vscode.TextEditor,
    pattern: RegExp
): Array<{ position: vscode.Position; matchText: string; lineText: string }> {
    const matches: Array<{ position: vscode.Position; matchText: string; lineText: string }> = [];
    const visibleRanges = editor.visibleRanges;

    for (const range of visibleRanges) {
        for (let line = range.start.line; line <= range.end.line; line++) {
            const lineText = editor.document.lineAt(line).text;
            let match;

            // Reset regex for each line
            const localPattern = new RegExp(pattern.source, pattern.flags);

            while ((match = localPattern.exec(lineText)) !== null) {
                matches.push({
                    position: new vscode.Position(line, match.index),
                    matchText: match[0],
                    lineText
                });

                // Prevent infinite loop for zero-width matches
                if (match[0].length === 0) {
                    localPattern.lastIndex++;
                }
            }
        }
    }

    return matches;
}

/**
 * Show jump labels using QuickPick and decorations
 */
async function showJumpTargets(
    editor: vscode.TextEditor,
    matches: Array<{ position: vscode.Position; matchText: string; lineText: string }>
): Promise<vscode.Position | undefined> {
    if (matches.length === 0) {
        vscode.window.showInformationMessage('No matches found');
        return undefined;
    }

    if (matches.length === 1) {
        // Only one match, jump directly
        return matches[0].position;
    }

    const labels = generateLabels(matches.length);
    const targets: JumpTarget[] = matches.map((match, i) => ({
        position: match.position,
        label: labels[i],
        lineText: match.lineText,
        matchText: match.matchText
    }));

    // Create decoration type for highlighting matches
    const highlightDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder')
    });

    // Highlight all match positions
    const decorations: vscode.DecorationOptions[] = targets.map(target => ({
        range: new vscode.Range(
            target.position,
            target.position.translate(0, target.matchText.length || 1)
        )
    }));

    editor.setDecorations(highlightDecoration, decorations);

    try {
        // Build QuickPick items
        const items = targets.map(target => ({
            label: `[${target.label}] ${target.lineText.trim()}`,
            description: `Line ${target.position.line + 1}, Col ${target.position.character + 1}`,
            detail: target.matchText !== target.lineText.trim() ? `Match: "${target.matchText}"` : undefined,
            target
        }));

        // Create QuickPick
        const quickPick = vscode.window.createQuickPick<typeof items[0]>();
        quickPick.items = items;
        quickPick.placeholder = `Type label (${labels[0]}, ${labels[1]}...) or select from list`;
        quickPick.matchOnDescription = false;
        quickPick.matchOnDetail = false;

        return new Promise((resolve) => {
            let resolved = false;

            // Custom filtering: match against labels
            quickPick.onDidChangeValue(value => {
                if (resolved) return;

                const lowerValue = value.toLowerCase();

                // Check for exact label match
                const exactMatch = targets.find(t => t.label === lowerValue);
                if (exactMatch) {
                    resolved = true;
                    quickPick.hide();
                    resolve(exactMatch.position);
                    return;
                }

                // Filter items by label prefix
                if (lowerValue.length > 0) {
                    const filtered = items.filter(item =>
                        item.target.label.startsWith(lowerValue)
                    );
                    quickPick.items = filtered.length > 0 ? filtered : items;
                } else {
                    quickPick.items = items;
                }
            });

            // Handle selection
            quickPick.onDidAccept(() => {
                if (resolved) return;
                resolved = true;

                const selected = quickPick.selectedItems[0];
                quickPick.hide();

                if (selected) {
                    resolve(selected.target.position);
                } else {
                    resolve(undefined);
                }
            });

            // Handle cancel
            quickPick.onDidHide(() => {
                if (!resolved) {
                    resolved = true;
                    resolve(undefined);
                }
                quickPick.dispose();
            });

            quickPick.show();
        });
    } finally {
        // Clean up decorations
        highlightDecoration.dispose();
    }
}

/**
 * Jump to position
 */
function jumpToPosition(editor: vscode.TextEditor, position: vscode.Position): void {
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
}

/**
 * Jump to char - jump to any occurrence of a character
 */
async function jumpGotoChar(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const char = await vscode.window.showInputBox({
        prompt: 'Jump: Enter character to jump to',
        placeHolder: 'Enter a character to jump to',
        validateInput: (value) => value.length > 1 ? 'Enter a single character' : null
    });

    if (!char) return;

    // Escape special regex characters
    const escaped = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'gi');

    const matches = findVisibleMatches(editor, pattern);
    const target = await showJumpTargets(editor, matches);

    if (target) {
        jumpToPosition(editor, target);
    }
}

/**
 * Jump to char 2 - jump to two-character sequence
 */
async function jumpGotoChar2(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const chars = await vscode.window.showInputBox({
        prompt: 'Jump: Enter 2-char sequence',
        placeHolder: 'Enter two characters',
        validateInput: (value) => {
            if (value.length < 2) return 'Enter 2 characters';
            if (value.length > 2) return 'Enter exactly 2 characters';
            return null;
        }
    });

    if (!chars || chars.length !== 2) return;

    const escaped = chars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'gi');

    const matches = findVisibleMatches(editor, pattern);
    const target = await showJumpTargets(editor, matches);

    if (target) {
        jumpToPosition(editor, target);
    }
}

/**
 * Jump to word - jump to word starts
 */
async function jumpGotoWord(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const char = await vscode.window.showInputBox({
        prompt: 'Jump: Enter starting character (or leave empty for all words)',
        placeHolder: 'Enter starting character (or leave empty for all words)',
    });

    // Pattern for word starts
    let pattern: RegExp;
    if (char && char.length >= 1) {
        const escaped = char[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = new RegExp(`\\b${escaped}\\w*`, 'gi');
    } else {
        pattern = /\b\w+/g;
    }

    const matches = findVisibleMatches(editor, pattern);
    const target = await showJumpTargets(editor, matches);

    if (target) {
        jumpToPosition(editor, target);
    }
}

/**
 * Jump to line - jump to any visible line
 */
async function jumpGotoLine(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const matches: Array<{ position: vscode.Position; matchText: string; lineText: string }> = [];
    const visibleRanges = editor.visibleRanges;

    for (const range of visibleRanges) {
        for (let line = range.start.line; line <= range.end.line; line++) {
            const lineText = editor.document.lineAt(line).text;
            // Find first non-whitespace character
            const firstNonWhitespace = lineText.search(/\S/);
            const col = firstNonWhitespace >= 0 ? firstNonWhitespace : 0;

            matches.push({
                position: new vscode.Position(line, col),
                matchText: lineText.trim().substring(0, 20) || '(empty line)',
                lineText
            });
        }
    }

    const target = await showJumpTargets(editor, matches);

    if (target) {
        jumpToPosition(editor, target);
    }
}

/**
 * Jump to symbol - jump to symbol/heading definitions
 */
async function jumpGotoSymbol(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const matches: Array<{ position: vscode.Position; matchText: string; lineText: string }> = [];
    const visibleRanges = editor.visibleRanges;

    // Patterns for symbols/headings
    const symbolPatterns = [
        /^(\s*)(function|def|class|interface|type|const|let|var|export|async|public|private|protected)\s+(\w+)/,
        /^(\s*)(\*+)\s+(.+)$/,  // Org headings
        /^(\s*)(#{1,6})\s+(.+)$/,   // Markdown headings
        /^(\s*)(\/\/|#|\/\*)\s*(TODO|FIXME|NOTE|HACK|XXX)/i, // Comment markers
    ];

    for (const range of visibleRanges) {
        for (let line = range.start.line; line <= range.end.line; line++) {
            const lineText = editor.document.lineAt(line).text;

            for (const pattern of symbolPatterns) {
                const match = pattern.exec(lineText);
                if (match) {
                    const indent = match[1]?.length || 0;
                    matches.push({
                        position: new vscode.Position(line, indent),
                        matchText: match[3] || match[2] || lineText.trim(),
                        lineText
                    });
                    break;
                }
            }
        }
    }

    if (matches.length === 0) {
        vscode.window.showInformationMessage('No symbols found in visible area');
        return;
    }

    const target = await showJumpTargets(editor, matches);

    if (target) {
        jumpToPosition(editor, target);
    }
}

/**
 * Jump copy line - select a line and copy it
 */
async function jumpCopyLine(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const matches: Array<{ position: vscode.Position; matchText: string; lineText: string }> = [];
    const visibleRanges = editor.visibleRanges;

    for (const range of visibleRanges) {
        for (let line = range.start.line; line <= range.end.line; line++) {
            const lineText = editor.document.lineAt(line).text;
            if (lineText.trim().length > 0) {
                matches.push({
                    position: new vscode.Position(line, 0),
                    matchText: lineText.trim().substring(0, 30),
                    lineText
                });
            }
        }
    }

    const target = await showJumpTargets(editor, matches);

    if (target) {
        const lineText = editor.document.lineAt(target.line).text;
        await vscode.env.clipboard.writeText(lineText);
        vscode.window.showInformationMessage(`Copied line ${target.line + 1}`);
    }
}

/**
 * Jump kill line - select a line and delete it
 */
async function jumpKillLine(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const matches: Array<{ position: vscode.Position; matchText: string; lineText: string }> = [];
    const visibleRanges = editor.visibleRanges;

    for (const range of visibleRanges) {
        for (let line = range.start.line; line <= range.end.line; line++) {
            const lineText = editor.document.lineAt(line).text;
            matches.push({
                position: new vscode.Position(line, 0),
                matchText: lineText.trim().substring(0, 30) || '(empty)',
                lineText
            });
        }
    }

    const target = await showJumpTargets(editor, matches);

    if (target) {
        const line = editor.document.lineAt(target.line);
        await editor.edit(editBuilder => {
            editBuilder.delete(line.rangeIncludingLineBreak);
        });
    }
}

/**
 * Jump to subword - jump to subword boundaries (camelCase, snake_case)
 */
async function jumpGotoSubword(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // Pattern for subword boundaries: capital letters, after underscores, after hyphens
    const pattern = /(?<=[a-z])[A-Z]|(?<=[A-Za-z])[0-9]|(?<=_)[a-zA-Z]|(?<=-)[a-zA-Z]|\b[a-zA-Z]/g;

    const matches = findVisibleMatches(editor, pattern);
    const target = await showJumpTargets(editor, matches);

    if (target) {
        jumpToPosition(editor, target);
    }
}

/**
 * Register all jump commands
 */
export function registerJumpCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.jump.gotoChar', jumpGotoChar),
        vscode.commands.registerCommand('scimax.jump.gotoChar2', jumpGotoChar2),
        vscode.commands.registerCommand('scimax.jump.gotoWord', jumpGotoWord),
        vscode.commands.registerCommand('scimax.jump.gotoLine', jumpGotoLine),
        vscode.commands.registerCommand('scimax.jump.gotoSymbol', jumpGotoSymbol),
        vscode.commands.registerCommand('scimax.jump.gotoSubword', jumpGotoSubword),
        vscode.commands.registerCommand('scimax.jump.copyLine', jumpCopyLine),
        vscode.commands.registerCommand('scimax.jump.killLine', jumpKillLine)
    );
}
