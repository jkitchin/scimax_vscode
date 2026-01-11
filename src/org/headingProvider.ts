import * as vscode from 'vscode';

/**
 * Heading manipulation for org-mode and markdown
 *
 * Org headings: * Level 1, ** Level 2, *** Level 3, etc.
 * Markdown headings: # Level 1, ## Level 2, ### Level 3, etc.
 */

/**
 * Check if line is an org heading and return its level
 */
function getOrgHeadingLevel(line: string): number {
    const match = line.match(/^(\*+)\s/);
    return match ? match[1].length : 0;
}

/**
 * Check if line is a markdown heading and return its level
 */
function getMarkdownHeadingLevel(line: string): number {
    const match = line.match(/^(#{1,6})\s/);
    return match ? match[1].length : 0;
}

/**
 * Promote heading (decrease level, e.g., ** → *)
 */
export async function promoteHeading(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);
    const lineText = line.text;
    const isOrg = document.languageId === 'org';

    if (isOrg) {
        const level = getOrgHeadingLevel(lineText);
        if (level <= 1) return false; // Can't promote level 1

        // Remove one asterisk
        const newLine = lineText.replace(/^\*/, '');
        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, newLine);
        });

        // Adjust cursor position
        const newCol = Math.max(0, position.character - 1);
        const newPosition = new vscode.Position(position.line, newCol);
        editor.selection = new vscode.Selection(newPosition, newPosition);

        return true;
    } else {
        // Markdown
        const level = getMarkdownHeadingLevel(lineText);
        if (level <= 1) return false; // Can't promote level 1

        // Remove one hash
        const newLine = lineText.replace(/^#/, '');
        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, newLine);
        });

        // Adjust cursor position
        const newCol = Math.max(0, position.character - 1);
        const newPosition = new vscode.Position(position.line, newCol);
        editor.selection = new vscode.Selection(newPosition, newPosition);

        return true;
    }
}

/**
 * Demote heading (increase level, e.g., * → **)
 */
export async function demoteHeading(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line);
    const lineText = line.text;
    const isOrg = document.languageId === 'org';

    if (isOrg) {
        const level = getOrgHeadingLevel(lineText);
        if (level === 0) return false; // Not a heading

        // Add one asterisk at the beginning
        const newLine = '*' + lineText;
        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, newLine);
        });

        // Adjust cursor position
        const newPosition = new vscode.Position(position.line, position.character + 1);
        editor.selection = new vscode.Selection(newPosition, newPosition);

        return true;
    } else {
        // Markdown
        const level = getMarkdownHeadingLevel(lineText);
        if (level === 0) return false; // Not a heading
        if (level >= 6) return false; // Max markdown heading level

        // Add one hash at the beginning
        const newLine = '#' + lineText;
        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, newLine);
        });

        // Adjust cursor position
        const newPosition = new vscode.Position(position.line, position.character + 1);
        editor.selection = new vscode.Selection(newPosition, newPosition);

        return true;
    }
}

/**
 * Promote subtree (heading and all its children)
 */
export async function promoteSubtree(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const lineText = document.lineAt(position.line).text;
    const isOrg = document.languageId === 'org';

    const getLevel = isOrg ? getOrgHeadingLevel : getMarkdownHeadingLevel;
    const headingLevel = getLevel(lineText);

    if (headingLevel === 0) return false; // Not a heading
    if (headingLevel <= 1) return false; // Can't promote level 1

    // Find the subtree extent
    const startLine = position.line;
    let endLine = startLine;

    for (let i = startLine + 1; i < document.lineCount; i++) {
        const checkLine = document.lineAt(i).text;
        const checkLevel = getLevel(checkLine);
        if (checkLevel > 0 && checkLevel <= headingLevel) {
            // Found a heading at same or higher level, subtree ends
            break;
        }
        endLine = i;
    }

    // Promote all headings in the subtree
    const prefix = isOrg ? '*' : '#';
    await editor.edit(editBuilder => {
        for (let i = startLine; i <= endLine; i++) {
            const line = document.lineAt(i);
            const text = line.text;
            const level = getLevel(text);
            if (level > 0) {
                // Remove one prefix character
                const newText = text.replace(new RegExp(`^\\${prefix}`), '');
                editBuilder.replace(line.range, newText);
            }
        }
    });

    return true;
}

/**
 * Demote subtree (heading and all its children)
 */
export async function demoteSubtree(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const lineText = document.lineAt(position.line).text;
    const isOrg = document.languageId === 'org';

    const getLevel = isOrg ? getOrgHeadingLevel : getMarkdownHeadingLevel;
    const headingLevel = getLevel(lineText);

    if (headingLevel === 0) return false; // Not a heading
    if (!isOrg && headingLevel >= 6) return false; // Max markdown level

    // Find the subtree extent
    const startLine = position.line;
    let endLine = startLine;

    for (let i = startLine + 1; i < document.lineCount; i++) {
        const checkLine = document.lineAt(i).text;
        const checkLevel = getLevel(checkLine);
        if (checkLevel > 0 && checkLevel <= headingLevel) {
            // Found a heading at same or higher level, subtree ends
            break;
        }
        endLine = i;
    }

    // Demote all headings in the subtree
    const prefix = isOrg ? '*' : '#';
    await editor.edit(editBuilder => {
        for (let i = startLine; i <= endLine; i++) {
            const line = document.lineAt(i);
            const text = line.text;
            const level = getLevel(text);
            if (level > 0) {
                // Add one prefix character
                const newText = prefix + text;
                editBuilder.replace(line.range, newText);
            }
        }
    });

    return true;
}

/**
 * Move heading up (swap with previous sibling)
 */
export async function moveHeadingUp(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const lineText = document.lineAt(position.line).text;
    const isOrg = document.languageId === 'org';

    const getLevel = isOrg ? getOrgHeadingLevel : getMarkdownHeadingLevel;
    const headingLevel = getLevel(lineText);

    if (headingLevel === 0) return false; // Not a heading

    // Find the start and end of current subtree
    const currentStart = position.line;
    let currentEnd = currentStart;

    for (let i = currentStart + 1; i < document.lineCount; i++) {
        const checkLine = document.lineAt(i).text;
        const checkLevel = getLevel(checkLine);
        if (checkLevel > 0 && checkLevel <= headingLevel) {
            break;
        }
        currentEnd = i;
    }

    // Find the previous sibling
    let prevStart = -1;
    let prevEnd = currentStart - 1;

    for (let i = currentStart - 1; i >= 0; i--) {
        const checkLine = document.lineAt(i).text;
        const checkLevel = getLevel(checkLine);
        if (checkLevel === headingLevel) {
            prevStart = i;
            break;
        }
        if (checkLevel > 0 && checkLevel < headingLevel) {
            // Hit a parent, no previous sibling
            return false;
        }
    }

    if (prevStart < 0) return false;

    // Get the text of both subtrees
    const currentText: string[] = [];
    for (let i = currentStart; i <= currentEnd; i++) {
        currentText.push(document.lineAt(i).text);
    }

    const prevText: string[] = [];
    for (let i = prevStart; i <= prevEnd; i++) {
        prevText.push(document.lineAt(i).text);
    }

    // Swap them
    await editor.edit(editBuilder => {
        const range = new vscode.Range(prevStart, 0, currentEnd, document.lineAt(currentEnd).text.length);
        const newContent = currentText.join('\n') + '\n' + prevText.join('\n');
        editBuilder.replace(range, newContent);
    });

    // Move cursor to new position of the heading
    const newPosition = new vscode.Position(prevStart, position.character);
    editor.selection = new vscode.Selection(newPosition, newPosition);

    return true;
}

/**
 * Move heading down (swap with next sibling)
 */
export async function moveHeadingDown(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    const document = editor.document;
    const position = editor.selection.active;
    const lineText = document.lineAt(position.line).text;
    const isOrg = document.languageId === 'org';

    const getLevel = isOrg ? getOrgHeadingLevel : getMarkdownHeadingLevel;
    const headingLevel = getLevel(lineText);

    if (headingLevel === 0) return false; // Not a heading

    // Find the start and end of current subtree
    const currentStart = position.line;
    let currentEnd = currentStart;

    for (let i = currentStart + 1; i < document.lineCount; i++) {
        const checkLine = document.lineAt(i).text;
        const checkLevel = getLevel(checkLine);
        if (checkLevel > 0 && checkLevel <= headingLevel) {
            break;
        }
        currentEnd = i;
    }

    // Find the next sibling
    let nextStart = currentEnd + 1;
    let nextEnd = nextStart;

    if (nextStart >= document.lineCount) return false;

    const nextLineText = document.lineAt(nextStart).text;
    const nextLevel = getLevel(nextLineText);

    if (nextLevel !== headingLevel) return false; // No next sibling at same level

    // Find end of next sibling's subtree
    for (let i = nextStart + 1; i < document.lineCount; i++) {
        const checkLine = document.lineAt(i).text;
        const checkLevel = getLevel(checkLine);
        if (checkLevel > 0 && checkLevel <= headingLevel) {
            break;
        }
        nextEnd = i;
    }

    // Get the text of both subtrees
    const currentText: string[] = [];
    for (let i = currentStart; i <= currentEnd; i++) {
        currentText.push(document.lineAt(i).text);
    }

    const nextText: string[] = [];
    for (let i = nextStart; i <= nextEnd; i++) {
        nextText.push(document.lineAt(i).text);
    }

    // Swap them
    await editor.edit(editBuilder => {
        const range = new vscode.Range(currentStart, 0, nextEnd, document.lineAt(nextEnd).text.length);
        const newContent = nextText.join('\n') + '\n' + currentText.join('\n');
        editBuilder.replace(range, newContent);
    });

    // Move cursor to new position of the heading
    const newLine = currentStart + nextText.length;
    const newPosition = new vscode.Position(newLine, position.character);
    editor.selection = new vscode.Selection(newPosition, newPosition);

    return true;
}

/**
 * Insert a new heading at the same level
 */
export async function insertHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const isOrg = document.languageId === 'org';

    // Find the nearest heading to determine level
    let level = 1;
    const getLevel = isOrg ? getOrgHeadingLevel : getMarkdownHeadingLevel;

    for (let i = position.line; i >= 0; i--) {
        const lineLevel = getLevel(document.lineAt(i).text);
        if (lineLevel > 0) {
            level = lineLevel;
            break;
        }
    }

    const prefix = isOrg ? '*'.repeat(level) : '#'.repeat(level);
    const newHeading = `\n${prefix} `;

    await editor.edit(editBuilder => {
        const endOfLine = document.lineAt(position.line).range.end;
        editBuilder.insert(endOfLine, newHeading);
    });

    // Move cursor to the new heading
    const newLine = position.line + 1;
    const newCol = prefix.length + 1;
    const newPosition = new vscode.Position(newLine, newCol);
    editor.selection = new vscode.Selection(newPosition, newPosition);
}

/**
 * Insert a new subheading (one level deeper)
 */
export async function insertSubheading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;
    const isOrg = document.languageId === 'org';

    // Find the nearest heading to determine level
    let level = 1;
    const getLevel = isOrg ? getOrgHeadingLevel : getMarkdownHeadingLevel;

    for (let i = position.line; i >= 0; i--) {
        const lineLevel = getLevel(document.lineAt(i).text);
        if (lineLevel > 0) {
            level = lineLevel + 1; // One level deeper
            break;
        }
    }

    // Cap at max level for markdown
    if (!isOrg && level > 6) level = 6;

    const prefix = isOrg ? '*'.repeat(level) : '#'.repeat(level);
    const newHeading = `\n${prefix} `;

    await editor.edit(editBuilder => {
        const endOfLine = document.lineAt(position.line).range.end;
        editBuilder.insert(endOfLine, newHeading);
    });

    // Move cursor to the new heading
    const newLine = position.line + 1;
    const newCol = prefix.length + 1;
    const newPosition = new vscode.Position(newLine, newCol);
    editor.selection = new vscode.Selection(newPosition, newPosition);
}

/**
 * Register heading commands
 */
export function registerHeadingCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.heading.promote', promoteHeading),
        vscode.commands.registerCommand('scimax.heading.demote', demoteHeading),
        vscode.commands.registerCommand('scimax.heading.promoteSubtree', promoteSubtree),
        vscode.commands.registerCommand('scimax.heading.demoteSubtree', demoteSubtree),
        vscode.commands.registerCommand('scimax.heading.moveUp', moveHeadingUp),
        vscode.commands.registerCommand('scimax.heading.moveDown', moveHeadingDown),
        vscode.commands.registerCommand('scimax.heading.insert', insertHeading),
        vscode.commands.registerCommand('scimax.heading.insertSub', insertSubheading)
    );
}
