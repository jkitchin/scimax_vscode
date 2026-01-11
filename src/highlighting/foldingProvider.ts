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

export function registerFoldingProvider(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(
            { language: 'org', scheme: 'file' },
            new OrgFoldingRangeProvider()
        )
    );
}
