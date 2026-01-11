import * as vscode from 'vscode';

export class OrgFoldingRangeProvider implements vscode.FoldingRangeProvider {

    provideFoldingRanges(
        document: vscode.TextDocument,
        context: vscode.FoldingContext,
        token: vscode.CancellationToken
    ): vscode.FoldingRange[] {
        const ranges: vscode.FoldingRange[] = [];
        const lines = document.getText().split('\n');

        // Track heading positions by level
        const headingStack: { level: number; line: number }[] = [];

        for (let i = 0; i < lines.length; i++) {
            if (token.isCancellationRequested) {
                break;
            }

            const line = lines[i];

            // Check for headings
            const headingMatch = line.match(/^(\*+)\s/);
            if (headingMatch) {
                const level = headingMatch[1].length;

                // Close all headings of same or higher level
                while (headingStack.length > 0) {
                    const top = headingStack[headingStack.length - 1];
                    if (top.level >= level) {
                        headingStack.pop();
                        // Create folding range from heading to line before this one
                        if (i - 1 > top.line) {
                            ranges.push(new vscode.FoldingRange(
                                top.line,
                                i - 1,
                                vscode.FoldingRangeKind.Region
                            ));
                        }
                    } else {
                        break;
                    }
                }

                // Push this heading onto stack
                headingStack.push({ level, line: i });
            }

            // Check for blocks (#+BEGIN_... to #+END_...)
            const beginBlockMatch = line.match(/^\s*#\+BEGIN_(\w+)/i);
            if (beginBlockMatch) {
                const blockName = beginBlockMatch[1].toUpperCase();
                // Find matching END
                for (let j = i + 1; j < lines.length; j++) {
                    const endMatch = lines[j].match(new RegExp(`^\\s*#\\+END_${blockName}`, 'i'));
                    if (endMatch) {
                        ranges.push(new vscode.FoldingRange(
                            i,
                            j,
                            vscode.FoldingRangeKind.Region
                        ));
                        break;
                    }
                }
            }

            // Check for drawers (:NAME: to :END:)
            const drawerMatch = line.match(/^\s*:([A-Za-z][A-Za-z0-9_-]*):\s*$/);
            if (drawerMatch && drawerMatch[1].toUpperCase() !== 'END') {
                // Find matching :END:
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].match(/^\s*:END:\s*$/i)) {
                        ranges.push(new vscode.FoldingRange(
                            i,
                            j,
                            vscode.FoldingRangeKind.Region
                        ));
                        break;
                    }
                }
            }

            // Check for dynamic blocks (#+BEGIN: to #+END:)
            if (line.match(/^\s*#\+BEGIN:\s/i)) {
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].match(/^\s*#\+END:?\s*$/i)) {
                        ranges.push(new vscode.FoldingRange(
                            i,
                            j,
                            vscode.FoldingRangeKind.Region
                        ));
                        break;
                    }
                }
            }
        }

        // Close any remaining headings at end of document
        while (headingStack.length > 0) {
            const top = headingStack.pop()!;
            // Find last non-empty line
            let lastLine = lines.length - 1;
            while (lastLine > top.line && lines[lastLine].trim() === '') {
                lastLine--;
            }
            if (lastLine > top.line) {
                ranges.push(new vscode.FoldingRange(
                    top.line,
                    lastLine,
                    vscode.FoldingRangeKind.Region
                ));
            }
        }

        return ranges;
    }
}

// Track global fold state for cycling
let globalFoldState: 'expanded' | 'headings-only' | 'collapsed' = 'expanded';

/**
 * Toggle fold at the current cursor position
 * If on a heading, toggles that heading's fold state
 */
async function toggleFoldAtCursor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line).text;

    // Check if we're on a heading
    const headingMatch = line.match(/^(\*+)\s/);
    if (headingMatch) {
        // Toggle fold at this line
        await vscode.commands.executeCommand('editor.toggleFold', {
            selectionLines: [position.line]
        });
    } else {
        // Find the nearest heading above and toggle it
        for (let i = position.line - 1; i >= 0; i--) {
            const checkLine = document.lineAt(i).text;
            if (checkLine.match(/^(\*+)\s/)) {
                // Move cursor to heading and toggle
                const newPosition = new vscode.Position(i, 0);
                editor.selection = new vscode.Selection(newPosition, newPosition);
                await vscode.commands.executeCommand('editor.toggleFold', {
                    selectionLines: [i]
                });
                // Move cursor back
                editor.selection = new vscode.Selection(position, position);
                return;
            }
        }
        // No heading found, insert a tab
        await vscode.commands.executeCommand('tab');
    }
}

/**
 * Cycle through global folding states like Emacs org-mode:
 * 1. All expanded (SHOWALL)
 * 2. Only headings visible (OVERVIEW)
 * 3. All collapsed to top-level (CONTENTS)
 */
async function cycleGlobalFold(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    switch (globalFoldState) {
        case 'expanded':
            // Fold all to show only headings
            await vscode.commands.executeCommand('editor.foldAll');
            globalFoldState = 'collapsed';
            vscode.window.setStatusBarMessage('Org: OVERVIEW (all folded)', 2000);
            break;
        case 'collapsed':
            // Unfold to level 1 (show top-level content)
            await vscode.commands.executeCommand('editor.unfoldAll');
            await vscode.commands.executeCommand('editor.foldLevel2');
            globalFoldState = 'headings-only';
            vscode.window.setStatusBarMessage('Org: CONTENTS (level 2)', 2000);
            break;
        case 'headings-only':
            // Expand all
            await vscode.commands.executeCommand('editor.unfoldAll');
            globalFoldState = 'expanded';
            vscode.window.setStatusBarMessage('Org: SHOWALL (expanded)', 2000);
            break;
    }
}

export function registerFoldingProvider(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(
            { language: 'org', scheme: 'file' },
            new OrgFoldingRangeProvider()
        )
    );

    // Register folding commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.toggleFold', toggleFoldAtCursor),
        vscode.commands.registerCommand('scimax.org.cycleGlobalFold', cycleGlobalFold)
    );
}
