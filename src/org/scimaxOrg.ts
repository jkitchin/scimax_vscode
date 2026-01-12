/**
 * Scimax-org: Text markup, DWIM return, and navigation features
 * Inspired by scimax-org.el from Emacs scimax
 */

import * as vscode from 'vscode';

// =============================================================================
// Text Markup Functions
// =============================================================================

/**
 * Apply markup to selection or word at point
 * If there's a selection, wrap it. Otherwise, wrap the word at cursor.
 */
async function applyMarkup(
    prefix: string,
    suffix: string,
    editor?: vscode.TextEditor
): Promise<void> {
    editor = editor || vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const selection = editor.selection;

    await editor.edit(editBuilder => {
        if (selection.isEmpty) {
            // No selection - wrap word at cursor
            const position = selection.active;
            const wordRange = document.getWordRangeAtPosition(position);

            if (wordRange) {
                const word = document.getText(wordRange);
                editBuilder.replace(wordRange, `${prefix}${word}${suffix}`);
            } else {
                // No word at cursor, insert empty markup
                editBuilder.insert(position, `${prefix}${suffix}`);
            }
        } else {
            // Has selection - wrap selection
            const text = document.getText(selection);
            editBuilder.replace(selection, `${prefix}${text}${suffix}`);
        }
    });
}

/**
 * Make text bold (*bold*)
 */
export async function boldRegionOrPoint(): Promise<void> {
    await applyMarkup('*', '*');
}

/**
 * Make text italic (/italic/)
 */
export async function italicRegionOrPoint(): Promise<void> {
    await applyMarkup('/', '/');
}

/**
 * Make text underlined (_underlined_)
 */
export async function underlineRegionOrPoint(): Promise<void> {
    await applyMarkup('_', '_');
}

/**
 * Make text code (~code~)
 */
export async function codeRegionOrPoint(): Promise<void> {
    await applyMarkup('~', '~');
}

/**
 * Make text verbatim (=verbatim=)
 */
export async function verbatimRegionOrPoint(): Promise<void> {
    await applyMarkup('=', '=');
}

/**
 * Make text strikethrough (+strikethrough+)
 */
export async function strikethroughRegionOrPoint(): Promise<void> {
    await applyMarkup('+', '+');
}

/**
 * Make text subscript (_{subscript})
 */
export async function subscriptRegionOrPoint(): Promise<void> {
    await applyMarkup('_{', '}');
}

/**
 * Make text superscript (^{superscript})
 */
export async function superscriptRegionOrPoint(): Promise<void> {
    await applyMarkup('^{', '}');
}

/**
 * Wrap in LaTeX math ($math$)
 */
export async function latexMathRegionOrPoint(): Promise<void> {
    await applyMarkup('$', '$');
}

/**
 * Wrap in LaTeX display math (\[math\])
 */
export async function latexDisplayMathRegionOrPoint(): Promise<void> {
    await applyMarkup('\\[', '\\]');
}

// =============================================================================
// DWIM Return (Do What I Mean)
// =============================================================================

/**
 * Smart return that creates appropriate content based on context:
 * - In a list item: creates new list item
 * - In a heading: creates new heading at same level
 * - In a table: moves to next row
 * - In a src block: normal newline
 * - Otherwise: normal newline
 */
export async function dwimReturn(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);
    const lineText = line.text;
    const trimmedLine = lineText.trim();

    // Check if in a src block
    if (isInSrcBlock(document, position)) {
        // Normal newline in src blocks
        return false;
    }

    // Check if in a table
    if (isInTable(lineText)) {
        return await handleTableReturn(editor, position);
    }

    // Check if on a list item
    const listMatch = lineText.match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/);
    if (listMatch) {
        return await handleListReturn(editor, position, listMatch);
    }

    // Check if on a checkbox item
    const checkboxMatch = lineText.match(/^(\s*)([-+*]|\d+[.)])\s+\[[ Xx-]\]\s+(.*)$/);
    if (checkboxMatch) {
        return await handleCheckboxReturn(editor, position, checkboxMatch);
    }

    // Check if on a heading
    const headingMatch = lineText.match(/^(\*+)\s+/);
    if (headingMatch) {
        return await handleHeadingReturn(editor, position, headingMatch);
    }

    // Default: normal newline
    return false;
}

/**
 * Check if cursor is inside a source block
 */
function isInSrcBlock(document: vscode.TextDocument, position: vscode.Position): boolean {
    // Search upward for #+BEGIN_SRC
    for (let i = position.line; i >= 0; i--) {
        const lineText = document.lineAt(i).text.trim().toLowerCase();
        if (lineText.startsWith('#+begin_src')) {
            // Found start, check if we're before the end
            for (let j = position.line; j < document.lineCount; j++) {
                const endLine = document.lineAt(j).text.trim().toLowerCase();
                if (endLine.startsWith('#+end_src')) {
                    return true;
                }
            }
            return false;
        }
        if (lineText.startsWith('#+end_src')) {
            return false;
        }
    }
    return false;
}

/**
 * Check if line is in a table
 */
function isInTable(lineText: string): boolean {
    return lineText.trim().startsWith('|') && lineText.trim().endsWith('|');
}

/**
 * Handle return in a table - move to next row or create new row
 */
async function handleTableReturn(
    editor: vscode.TextEditor,
    position: vscode.Position
): Promise<boolean> {
    const document = editor.document;
    const nextLine = position.line + 1;

    if (nextLine < document.lineCount) {
        const nextLineText = document.lineAt(nextLine).text;
        if (isInTable(nextLineText)) {
            // Move to first cell of next row
            const firstPipe = nextLineText.indexOf('|');
            const newPos = new vscode.Position(nextLine, firstPipe + 2);
            editor.selection = new vscode.Selection(newPos, newPos);
            return true;
        }
    }

    // Create new row - copy structure from current row
    const currentLine = document.lineAt(position.line).text;
    const cells = currentLine.split('|').slice(1, -1);
    const newRow = '|' + cells.map(c => ' '.repeat(c.length)).join('|') + '|';

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(position.line + 1, 0), newRow + '\n');
    });

    // Move to first cell
    const newPos = new vscode.Position(position.line + 1, 2);
    editor.selection = new vscode.Selection(newPos, newPos);
    return true;
}

/**
 * Handle return on a list item - create new item or end list
 */
async function handleListReturn(
    editor: vscode.TextEditor,
    position: vscode.Position,
    match: RegExpMatchArray
): Promise<boolean> {
    const [, indent, bullet, content] = match;

    if (content.trim() === '') {
        // Empty item - end the list (remove the bullet)
        await editor.edit(editBuilder => {
            const line = editor.document.lineAt(position.line);
            editBuilder.replace(line.range, '');
        });
        return true;
    }

    // Create new item
    let newBullet = bullet;
    // If numbered list, increment
    const numMatch = bullet.match(/^(\d+)([.)])/);
    if (numMatch) {
        newBullet = `${parseInt(numMatch[1]) + 1}${numMatch[2]}`;
    }

    const newItem = `\n${indent}${newBullet} `;

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(position.line, position.character), newItem);
    });

    // Move cursor to end of new bullet
    const newPos = new vscode.Position(position.line + 1, indent.length + newBullet.length + 1);
    editor.selection = new vscode.Selection(newPos, newPos);
    return true;
}

/**
 * Handle return on a checkbox item
 */
async function handleCheckboxReturn(
    editor: vscode.TextEditor,
    position: vscode.Position,
    match: RegExpMatchArray
): Promise<boolean> {
    const [, indent, bullet, content] = match;

    if (content.trim() === '') {
        // Empty item - end the list
        await editor.edit(editBuilder => {
            const line = editor.document.lineAt(position.line);
            editBuilder.replace(line.range, '');
        });
        return true;
    }

    // Create new checkbox item
    let newBullet = bullet;
    const numMatch = bullet.match(/^(\d+)([.)])/);
    if (numMatch) {
        newBullet = `${parseInt(numMatch[1]) + 1}${numMatch[2]}`;
    }

    const newItem = `\n${indent}${newBullet} [ ] `;

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(position.line, position.character), newItem);
    });

    const newPos = new vscode.Position(position.line + 1, indent.length + newBullet.length + 5);
    editor.selection = new vscode.Selection(newPos, newPos);
    return true;
}

/**
 * Handle return on a heading - create new heading or subheading
 */
async function handleHeadingReturn(
    editor: vscode.TextEditor,
    position: vscode.Position,
    match: RegExpMatchArray
): Promise<boolean> {
    const stars = match[1];
    const currentLine = editor.document.lineAt(position.line);

    // If at end of heading, create new heading at same level
    if (position.character >= currentLine.text.length - 1) {
        const newHeading = `\n\n${stars} `;

        await editor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(position.line, currentLine.text.length), newHeading);
        });

        const newPos = new vscode.Position(position.line + 2, stars.length + 1);
        editor.selection = new vscode.Selection(newPos, newPos);
        return true;
    }

    // Otherwise, normal newline
    return false;
}

// =============================================================================
// Navigation Functions
// =============================================================================

/**
 * Jump to a heading in the current buffer using quick pick
 */
export async function jumpToHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const headings: { label: string; line: number; level: number }[] = [];

    // Find all headings
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        const match = line.match(/^(\*+)\s+(.*)$/);
        if (match) {
            const level = match[1].length;
            const title = match[2].replace(/\s*:[\w:]+:\s*$/, ''); // Remove tags
            const indent = '  '.repeat(level - 1);
            headings.push({
                label: `${indent}${title}`,
                line: i,
                level
            });
        }
    }

    if (headings.length === 0) {
        vscode.window.showInformationMessage('No headings found in document');
        return;
    }

    const selected = await vscode.window.showQuickPick(
        headings.map(h => ({
            label: h.label,
            description: `Line ${h.line + 1}`,
            line: h.line
        })),
        {
            placeHolder: 'Jump to heading...',
            matchOnDescription: true
        }
    );

    if (selected) {
        const pos = new vscode.Position(selected.line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
}

/**
 * Jump to next heading
 */
export async function nextHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;

    for (let i = currentLine + 1; i < document.lineCount; i++) {
        if (document.lineAt(i).text.match(/^\*+\s/)) {
            const pos = new vscode.Position(i, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            return;
        }
    }

    vscode.window.showInformationMessage('No more headings');
}

/**
 * Jump to previous heading
 */
export async function previousHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;

    for (let i = currentLine - 1; i >= 0; i--) {
        if (document.lineAt(i).text.match(/^\*+\s/)) {
            const pos = new vscode.Position(i, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            return;
        }
    }

    vscode.window.showInformationMessage('No previous heading');
}

/**
 * Jump to parent heading
 */
export async function parentHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;

    // Find current heading level
    let currentLevel = 0;
    for (let i = currentLine; i >= 0; i--) {
        const match = document.lineAt(i).text.match(/^(\*+)\s/);
        if (match) {
            currentLevel = match[1].length;
            break;
        }
    }

    if (currentLevel <= 1) {
        vscode.window.showInformationMessage('Already at top level');
        return;
    }

    // Find parent (heading with fewer stars)
    for (let i = currentLine - 1; i >= 0; i--) {
        const match = document.lineAt(i).text.match(/^(\*+)\s/);
        if (match && match[1].length < currentLevel) {
            const pos = new vscode.Position(i, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            return;
        }
    }

    vscode.window.showInformationMessage('No parent heading found');
}

// =============================================================================
// Heading Manipulation
// =============================================================================

/**
 * Promote heading (decrease level)
 */
export async function promoteHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);
    const match = line.text.match(/^(\*+)\s/);

    if (!match || match[1].length <= 1) {
        vscode.window.showInformationMessage('Cannot promote further');
        return;
    }

    await editor.edit(editBuilder => {
        editBuilder.delete(new vscode.Range(position.line, 0, position.line, 1));
    });
}

/**
 * Demote heading (increase level)
 */
export async function demoteHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);

    if (!line.text.match(/^\*+\s/)) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(position.line, 0), '*');
    });
}

/**
 * Promote subtree (heading and all children)
 */
export async function promoteSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const { startLine, endLine } = getSubtreeRange(document, position.line);

    // Check if can promote
    const firstLine = document.lineAt(startLine).text;
    const match = firstLine.match(/^(\*+)\s/);
    if (!match || match[1].length <= 1) {
        vscode.window.showInformationMessage('Cannot promote further');
        return;
    }

    await editor.edit(editBuilder => {
        for (let i = startLine; i <= endLine; i++) {
            const line = document.lineAt(i).text;
            if (line.match(/^\*+\s/)) {
                editBuilder.delete(new vscode.Range(i, 0, i, 1));
            }
        }
    });
}

/**
 * Demote subtree (heading and all children)
 */
export async function demoteSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const { startLine, endLine } = getSubtreeRange(document, position.line);

    await editor.edit(editBuilder => {
        for (let i = startLine; i <= endLine; i++) {
            const line = document.lineAt(i).text;
            if (line.match(/^\*+\s/)) {
                editBuilder.insert(new vscode.Position(i, 0), '*');
            }
        }
    });
}

/**
 * Get the range of a subtree (heading + all children)
 */
function getSubtreeRange(document: vscode.TextDocument, line: number): { startLine: number; endLine: number } {
    const lineText = document.lineAt(line).text;
    const match = lineText.match(/^(\*+)\s/);

    if (!match) {
        // Not on a heading, find the parent heading
        for (let i = line - 1; i >= 0; i--) {
            if (document.lineAt(i).text.match(/^\*+\s/)) {
                return getSubtreeRange(document, i);
            }
        }
        return { startLine: line, endLine: line };
    }

    const level = match[1].length;
    let endLine = line;

    // Find end of subtree (next heading at same or higher level, or end of file)
    for (let i = line + 1; i < document.lineCount; i++) {
        const nextMatch = document.lineAt(i).text.match(/^(\*+)\s/);
        if (nextMatch && nextMatch[1].length <= level) {
            break;
        }
        endLine = i;
    }

    return { startLine: line, endLine };
}

/**
 * Move subtree up
 */
export async function moveSubtreeUp(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const { startLine, endLine } = getSubtreeRange(document, position.line);

    if (startLine === 0) {
        vscode.window.showInformationMessage('Already at top');
        return;
    }

    // Find the previous subtree
    let prevStart = startLine - 1;
    const lineText = document.lineAt(startLine).text;
    const match = lineText.match(/^(\*+)\s/);
    const level = match ? match[1].length : 0;

    // Find start of previous sibling or just move up one line
    for (let i = startLine - 1; i >= 0; i--) {
        const prevMatch = document.lineAt(i).text.match(/^(\*+)\s/);
        if (prevMatch && prevMatch[1].length <= level) {
            prevStart = i;
            break;
        }
        if (i === 0) {
            prevStart = 0;
        }
    }

    // Get the text to move
    const subtreeRange = new vscode.Range(startLine, 0, endLine + 1, 0);
    const subtreeText = document.getText(subtreeRange);

    await editor.edit(editBuilder => {
        editBuilder.delete(subtreeRange);
        editBuilder.insert(new vscode.Position(prevStart, 0), subtreeText);
    });

    // Move cursor with the subtree
    const newPos = new vscode.Position(prevStart + (position.line - startLine), position.character);
    editor.selection = new vscode.Selection(newPos, newPos);
}

/**
 * Move subtree down
 */
export async function moveSubtreeDown(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const { startLine, endLine } = getSubtreeRange(document, position.line);

    if (endLine >= document.lineCount - 1) {
        vscode.window.showInformationMessage('Already at bottom');
        return;
    }

    // Find the next subtree end
    const lineText = document.lineAt(startLine).text;
    const match = lineText.match(/^(\*+)\s/);
    const level = match ? match[1].length : 0;

    let nextEnd = endLine + 1;
    for (let i = endLine + 2; i < document.lineCount; i++) {
        const nextMatch = document.lineAt(i).text.match(/^(\*+)\s/);
        if (nextMatch && nextMatch[1].length <= level) {
            nextEnd = i - 1;
            break;
        }
        nextEnd = i;
    }

    // Get the text to move
    const subtreeRange = new vscode.Range(startLine, 0, endLine + 1, 0);
    const subtreeText = document.getText(subtreeRange);
    const subtreeLines = endLine - startLine + 1;

    await editor.edit(editBuilder => {
        editBuilder.delete(subtreeRange);
        editBuilder.insert(new vscode.Position(nextEnd - subtreeLines + 1, 0), subtreeText);
    });

    // Move cursor with the subtree
    const newStart = nextEnd - subtreeLines + 1;
    const newPos = new vscode.Position(newStart + (position.line - startLine), position.character);
    editor.selection = new vscode.Selection(newPos, newPos);
}

/**
 * Kill (delete) current subtree
 */
export async function killSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const { startLine, endLine } = getSubtreeRange(document, position.line);

    // Copy to clipboard first
    const subtreeRange = new vscode.Range(startLine, 0, endLine + 1, 0);
    const subtreeText = document.getText(subtreeRange);
    await vscode.env.clipboard.writeText(subtreeText);

    await editor.edit(editBuilder => {
        editBuilder.delete(subtreeRange);
    });

    vscode.window.showInformationMessage('Subtree killed and copied to clipboard');
}

/**
 * Clone (copy) current subtree below
 */
export async function cloneSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const { startLine, endLine } = getSubtreeRange(document, position.line);

    const subtreeRange = new vscode.Range(startLine, 0, endLine + 1, 0);
    const subtreeText = document.getText(subtreeRange);

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(endLine + 1, 0), subtreeText);
    });
}

/**
 * Insert a new heading respecting current context
 */
export async function insertHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find the current heading level
    let level = 1;
    for (let i = position.line; i >= 0; i--) {
        const match = document.lineAt(i).text.match(/^(\*+)\s/);
        if (match) {
            level = match[1].length;
            break;
        }
    }

    const heading = '\n' + '*'.repeat(level) + ' ';

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(position.line, document.lineAt(position.line).text.length), heading);
    });

    const newPos = new vscode.Position(position.line + 1, level + 1);
    editor.selection = new vscode.Selection(newPos, newPos);
}

/**
 * Insert a new subheading (one level deeper)
 */
export async function insertSubheading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find the current heading level
    let level = 1;
    for (let i = position.line; i >= 0; i--) {
        const match = document.lineAt(i).text.match(/^(\*+)\s/);
        if (match) {
            level = match[1].length + 1;
            break;
        }
    }

    const heading = '\n' + '*'.repeat(level) + ' ';

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(position.line, document.lineAt(position.line).text.length), heading);
    });

    const newPos = new vscode.Position(position.line + 1, level + 1);
    editor.selection = new vscode.Selection(newPos, newPos);
}

// =============================================================================
// TODO/Checkbox Functions
// =============================================================================

/**
 * Cycle TODO state on current heading
 */
export async function cycleTodoState(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);
    const lineText = line.text;

    const headingMatch = lineText.match(/^(\*+)\s+(TODO|DONE|WAITING|CANCELLED|NEXT|SOMEDAY)?\s*(.*)/);
    if (!headingMatch) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    const [, stars, currentState, rest] = headingMatch;
    const states = ['', 'TODO', 'DONE'];
    const currentIndex = states.indexOf(currentState || '');
    const nextState = states[(currentIndex + 1) % states.length];

    const newLine = nextState
        ? `${stars} ${nextState} ${rest}`
        : `${stars} ${rest}`;

    await editor.edit(editBuilder => {
        editBuilder.replace(line.range, newLine);
    });
}

/**
 * Toggle checkbox at point
 */
export async function toggleCheckbox(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);
    const lineText = line.text;

    // Match checkbox: - [ ], - [X], - [-]
    const checkboxMatch = lineText.match(/^(\s*[-+*]|\s*\d+[.)])\s+\[([ Xx-])\]\s+(.*)$/);
    if (!checkboxMatch) {
        vscode.window.showInformationMessage('Not on a checkbox');
        return;
    }

    const [, bullet, state, content] = checkboxMatch;
    const newState = state === ' ' ? 'X' : ' ';
    const newLine = `${bullet} [${newState}] ${content}`;

    await editor.edit(editBuilder => {
        editBuilder.replace(line.range, newLine);
    });
}

/**
 * Insert a new checkbox item
 */
export async function insertCheckbox(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);
    const lineText = line.text;

    // Detect current indentation
    const indentMatch = lineText.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';

    const checkbox = `\n${indent}- [ ] `;

    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(position.line, line.text.length), checkbox);
    });

    const newPos = new vscode.Position(position.line + 1, indent.length + 6);
    editor.selection = new vscode.Selection(newPos, newPos);
}

// =============================================================================
// Link Functions
// =============================================================================

/**
 * Insert an org link
 */
export async function insertLink(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const url = await vscode.window.showInputBox({
        prompt: 'Enter URL or path',
        placeHolder: 'https://example.com or ./file.org'
    });

    if (!url) return;

    const description = await vscode.window.showInputBox({
        prompt: 'Enter description (optional)',
        placeHolder: 'Link description'
    });

    const link = description ? `[[${url}][${description}]]` : `[[${url}]]`;

    await editor.edit(editBuilder => {
        editBuilder.insert(editor.selection.active, link);
    });
}

/**
 * Check if cursor is on a link and return the link info
 */
export function getLinkAtPoint(document: vscode.TextDocument, position: vscode.Position): { url: string; start: number; end: number } | null {
    const line = document.lineAt(position.line).text;

    // Link patterns to check
    const patterns = [
        // Org bracket links: [[url]] or [[url][description]]
        /\[\[([^\]]+)\](?:\[([^\]]+)\])?\]/g,
        // Citation links: cite:key or cite:key1,key2
        /(?<![\\w])(?:cite|citep|citet|citeauthor|citeyear|Citep|Citet|citealp|citealt):[\w:-]+(?:,[\w:-]+)*/g,
        // Bare URLs
        /https?:\/\/[^\s\]>)]+/g,
    ];

    for (const pattern of patterns) {
        pattern.lastIndex = 0; // Reset regex state
        let match;
        while ((match = pattern.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;

            if (position.character >= start && position.character <= end) {
                // Extract the actual URL
                let url = match[1] || match[0]; // match[1] for bracket links, match[0] for others
                return { url, start, end };
            }
        }
    }

    return null;
}

/**
 * Check if cursor is on a link (for context)
 */
export function isOnLink(document: vscode.TextDocument, position: vscode.Position): boolean {
    return getLinkAtPoint(document, position) !== null;
}

/**
 * Open link at point
 */
export async function openLinkAtPoint(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    const linkInfo = getLinkAtPoint(document, position);
    if (!linkInfo) {
        vscode.window.showInformationMessage('No link at cursor');
        return;
    }

    const url = linkInfo.url;

    // Handle different link types
    if (url.startsWith('http://') || url.startsWith('https://')) {
        vscode.env.openExternal(vscode.Uri.parse(url));
    } else if (url.startsWith('file:')) {
        const filePath = url.replace(/^file:/, '');
        const uri = vscode.Uri.file(filePath);
        vscode.commands.executeCommand('vscode.open', uri);
    } else if (url.startsWith('cite:') || url.startsWith('citep:') || url.startsWith('citet:')) {
        // Citation link - trigger citation action
        vscode.commands.executeCommand('scimax.citation.action');
    } else {
        // Treat as relative file path or internal link
        const currentDir = vscode.Uri.joinPath(document.uri, '..');
        const targetUri = vscode.Uri.joinPath(currentDir, url);
        vscode.commands.executeCommand('vscode.open', targetUri);
    }
}

/**
 * Setup link context tracking
 */
export function setupLinkContext(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            const editor = e.textEditor;
            const document = editor.document;

            // Only check for org/markdown files
            if (!['org', 'markdown'].includes(document.languageId)) {
                vscode.commands.executeCommand('setContext', 'scimax.onLink', false);
                return;
            }

            const position = editor.selection.active;
            const onLink = isOnLink(document, position);
            vscode.commands.executeCommand('setContext', 'scimax.onLink', onLink);
        })
    );
}

// =============================================================================
// Command Registration
// =============================================================================

/**
 * Register all scimax-org commands
 */
export function registerScimaxOrgCommands(context: vscode.ExtensionContext): void {
    // Text markup
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.markup.bold', boldRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.italic', italicRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.underline', underlineRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.code', codeRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.verbatim', verbatimRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.strikethrough', strikethroughRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.subscript', subscriptRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.superscript', superscriptRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.latexMath', latexMathRegionOrPoint),
        vscode.commands.registerCommand('scimax.markup.latexDisplayMath', latexDisplayMathRegionOrPoint)
    );

    // Navigation
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.jumpToHeading', jumpToHeading),
        vscode.commands.registerCommand('scimax.org.nextHeading', nextHeading),
        vscode.commands.registerCommand('scimax.org.previousHeading', previousHeading),
        vscode.commands.registerCommand('scimax.org.parentHeading', parentHeading)
    );

    // Heading manipulation
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.promoteHeading', promoteHeading),
        vscode.commands.registerCommand('scimax.org.demoteHeading', demoteHeading),
        vscode.commands.registerCommand('scimax.org.promoteSubtree', promoteSubtree),
        vscode.commands.registerCommand('scimax.org.demoteSubtree', demoteSubtree),
        vscode.commands.registerCommand('scimax.org.moveSubtreeUp', moveSubtreeUp),
        vscode.commands.registerCommand('scimax.org.moveSubtreeDown', moveSubtreeDown),
        vscode.commands.registerCommand('scimax.org.killSubtree', killSubtree),
        vscode.commands.registerCommand('scimax.org.cloneSubtree', cloneSubtree),
        vscode.commands.registerCommand('scimax.org.insertHeading', insertHeading),
        vscode.commands.registerCommand('scimax.org.insertSubheading', insertSubheading)
    );

    // TODO/Checkbox
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.cycleTodo', cycleTodoState),
        vscode.commands.registerCommand('scimax.org.toggleCheckbox', toggleCheckbox),
        vscode.commands.registerCommand('scimax.org.insertCheckbox', insertCheckbox)
    );

    // Links
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.insertLink', insertLink),
        vscode.commands.registerCommand('scimax.org.openLink', openLinkAtPoint)
    );

    // Setup link context tracking for Enter key
    setupLinkContext(context);

    // DWIM Return
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.dwimReturn', dwimReturn)
    );
}
