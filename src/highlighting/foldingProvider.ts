import * as vscode from 'vscode';
import { isInTable, nextCell } from '../org/tableProvider';

// LaTeX section commands in order of hierarchy (lower index = higher level)
const LATEX_SECTION_LEVELS: { [key: string]: number } = {
    'part': 0,
    'chapter': 1,
    'section': 2,
    'subsection': 3,
    'subsubsection': 4,
    'paragraph': 5,
    'subparagraph': 6
};

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

/**
 * LaTeX folding provider for section commands
 */
export class LaTeXFoldingRangeProvider implements vscode.FoldingRangeProvider {

    provideFoldingRanges(
        document: vscode.TextDocument,
        context: vscode.FoldingContext,
        token: vscode.CancellationToken
    ): vscode.FoldingRange[] {
        const ranges: vscode.FoldingRange[] = [];
        const lines = document.getText().split('\n');

        // Track section positions by level
        const sectionStack: { level: number; line: number }[] = [];

        // Regex to match LaTeX section commands
        const sectionPattern = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[\[{]/;

        for (let i = 0; i < lines.length; i++) {
            if (token.isCancellationRequested) {
                break;
            }

            const line = lines[i];

            // Check for section commands
            const sectionMatch = line.match(sectionPattern);
            if (sectionMatch) {
                const sectionType = sectionMatch[1];
                const level = LATEX_SECTION_LEVELS[sectionType] ?? 2;

                // Close all sections of same or lower priority (higher level number)
                while (sectionStack.length > 0) {
                    const top = sectionStack[sectionStack.length - 1];
                    if (top.level >= level) {
                        sectionStack.pop();
                        // Create folding range from section to line before this one
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

                // Push this section onto stack
                sectionStack.push({ level, line: i });
            }

            // Check for environments (\begin{...} to \end{...})
            const beginMatch = line.match(/^\s*\\begin\{(\w+)\}/);
            if (beginMatch) {
                const envName = beginMatch[1];
                // Find matching \end
                for (let j = i + 1; j < lines.length; j++) {
                    const endMatch = lines[j].match(new RegExp(`^\\s*\\\\end\\{${envName}\\}`));
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
        }

        // Close any remaining sections at end of document
        while (sectionStack.length > 0) {
            const top = sectionStack.pop()!;
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
 * Check if a line is an org heading
 */
function isOrgHeading(line: string): boolean {
    return /^(\*+)\s/.test(line);
}

/**
 * Check if a line is a LaTeX section command
 */
function isLaTeXSection(line: string): boolean {
    return /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[\[{]/.test(line);
}

/**
 * Toggle fold at the current cursor position
 * If in a table, move to next cell
 * If on a heading/section, toggles that fold state
 */
async function toggleFoldAtCursor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line).text;
    const isLatex = document.languageId === 'latex';

    // Check if we're in a table first - Tab moves between cells
    if (isInTable(document, position)) {
        const moved = await nextCell();
        if (moved) return;
    }

    // Check if we're on a foldable element
    const isFoldable = isLatex ? isLaTeXSection(line) : isOrgHeading(line);

    if (isFoldable) {
        // Toggle fold at this line
        await vscode.commands.executeCommand('editor.toggleFold', {
            selectionLines: [position.line]
        });
    } else {
        // Find the nearest heading/section above and toggle it
        const checkFn = isLatex ? isLaTeXSection : isOrgHeading;
        for (let i = position.line - 1; i >= 0; i--) {
            const checkLine = document.lineAt(i).text;
            if (checkFn(checkLine)) {
                // Move cursor to heading/section and toggle
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
        // No heading/section found, insert a tab
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

    const isLatex = editor.document.languageId === 'latex';
    const prefix = isLatex ? 'LaTeX' : 'Org';

    switch (globalFoldState) {
        case 'expanded':
            // Fold all to show only headings/sections
            await vscode.commands.executeCommand('editor.foldAll');
            globalFoldState = 'collapsed';
            vscode.window.setStatusBarMessage(`${prefix}: OVERVIEW (all folded)`, 2000);
            break;
        case 'collapsed':
            // Unfold to level 1 (show top-level content)
            await vscode.commands.executeCommand('editor.unfoldAll');
            await vscode.commands.executeCommand('editor.foldLevel2');
            globalFoldState = 'headings-only';
            vscode.window.setStatusBarMessage(`${prefix}: CONTENTS (level 2)`, 2000);
            break;
        case 'headings-only':
            // Expand all
            await vscode.commands.executeCommand('editor.unfoldAll');
            globalFoldState = 'expanded';
            vscode.window.setStatusBarMessage(`${prefix}: SHOWALL (expanded)`, 2000);
            break;
    }
}

export function registerFoldingProvider(context: vscode.ExtensionContext): void {
    // Register org-mode folding provider
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(
            { language: 'org', scheme: 'file' },
            new OrgFoldingRangeProvider()
        )
    );

    // Register LaTeX folding provider
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(
            { language: 'latex', scheme: 'file' },
            new LaTeXFoldingRangeProvider()
        )
    );

    // Register folding commands (shared for org and latex)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.toggleFold', toggleFoldAtCursor),
        vscode.commands.registerCommand('scimax.org.cycleGlobalFold', cycleGlobalFold)
    );
}
