/**
 * Speed Command Metadata Functions
 *
 * Set tags, effort, properties, and priority.
 */

import * as vscode from 'vscode';
import { getHeadingLevel } from './context';
import { extractTags, formatTags, removeTagsFromLine } from './utils';

/**
 * Set tags on the current heading
 */
export async function setTags(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find the heading we're on
    let headingLine = position.line;
    if (getHeadingLevel(document, headingLine) === 0) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    const line = document.lineAt(headingLine);
    const currentTags = extractTags(line.text);

    // Prompt for new tags
    const input = await vscode.window.showInputBox({
        prompt: 'Enter tags (colon-separated, e.g., work:urgent:project)',
        value: currentTags.join(':'),
        placeHolder: 'tag1:tag2:tag3'
    });

    if (input === undefined) return; // Cancelled

    const newTags = input.split(':').map(t => t.trim()).filter(t => t.length > 0);

    // Remove existing tags from line
    let newLineText = removeTagsFromLine(line.text);

    // Add new tags if any
    if (newTags.length > 0) {
        // Ensure proper spacing before tags (align to column 77 like Emacs)
        const tagStr = formatTags(newTags);
        const targetCol = 77;
        const currentLen = newLineText.trimEnd().length;

        if (currentLen < targetCol - tagStr.length) {
            // Add spaces to align
            const spaces = ' '.repeat(targetCol - tagStr.length - currentLen);
            newLineText = newLineText.trimEnd() + spaces + tagStr;
        } else {
            // Just add single space
            newLineText = newLineText.trimEnd() + ' ' + tagStr;
        }
    }

    await editor.edit(editBuilder => {
        editBuilder.replace(line.range, newLineText);
    });
}

/**
 * Find or create PROPERTIES drawer for a heading
 */
async function ensurePropertiesDrawer(
    editor: vscode.TextEditor,
    headingLine: number
): Promise<{ startLine: number; endLine: number }> {
    const document = editor.document;

    // Search for existing :PROPERTIES: drawer
    let propertiesStart = -1;
    let propertiesEnd = -1;

    for (let i = headingLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text.trim();

        // Hit next heading
        if (getHeadingLevel(document, i) > 0) break;

        // Skip planning lines
        if (/^(SCHEDULED|DEADLINE|CLOSED):/.test(line)) continue;

        if (line === ':PROPERTIES:') {
            propertiesStart = i;
        } else if (propertiesStart >= 0 && line === ':END:') {
            propertiesEnd = i;
            break;
        } else if (propertiesStart < 0 && line && !line.startsWith(':')) {
            // Hit content before finding properties drawer
            break;
        }
    }

    if (propertiesStart >= 0 && propertiesEnd >= 0) {
        return { startLine: propertiesStart, endLine: propertiesEnd };
    }

    // Create new properties drawer
    // Find insertion point (after heading and planning lines)
    let insertLine = headingLine + 1;
    for (let i = headingLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text.trim();
        const level = getHeadingLevel(document, i);
        if (level > 0) break;

        if (/^(SCHEDULED|DEADLINE|CLOSED):/.test(line)) {
            insertLine = i + 1;
        } else {
            break;
        }
    }

    await editor.edit(editBuilder => {
        editBuilder.insert(
            new vscode.Position(insertLine, 0),
            ':PROPERTIES:\n:END:\n'
        );
    });

    return { startLine: insertLine, endLine: insertLine + 1 };
}

/**
 * Set effort property on current heading
 */
export async function setEffort(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find the heading
    let headingLine = position.line;
    if (getHeadingLevel(document, headingLine) === 0) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    // Common effort estimates
    const options: (vscode.QuickPickItem & { value: string })[] = [
        { label: '0:15', description: '15 minutes', value: '0:15' },
        { label: '0:30', description: '30 minutes', value: '0:30' },
        { label: '1:00', description: '1 hour', value: '1:00' },
        { label: '2:00', description: '2 hours', value: '2:00' },
        { label: '4:00', description: '4 hours (half day)', value: '4:00' },
        { label: '8:00', description: '8 hours (full day)', value: '8:00' },
        { label: 'Custom...', description: 'Enter custom effort', value: '' },
    ];

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Set effort estimate'
    });

    if (!selected) return;

    let effort = selected.value;
    if (!effort) {
        const custom = await vscode.window.showInputBox({
            prompt: 'Enter effort (H:MM format)',
            placeHolder: '1:30',
            validateInput: (value) => {
                if (!value) return null;
                if (!/^\d+:\d{2}$/.test(value)) {
                    return 'Use H:MM format (e.g., 1:30)';
                }
                return null;
            }
        });
        if (!custom) return;
        effort = custom;
    }

    await setPropertyValue(editor, headingLine, 'Effort', effort);
    vscode.window.showInformationMessage(`Effort: ${effort}`);
}

/**
 * Set any property on current heading
 */
export async function setProperty(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find the heading
    let headingLine = position.line;
    if (getHeadingLevel(document, headingLine) === 0) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    // Common properties
    const commonProps = ['ID', 'CUSTOM_ID', 'Effort', 'CATEGORY', 'LOGGING', 'COLUMNS'];

    const propertyName = await vscode.window.showInputBox({
        prompt: 'Property name',
        placeHolder: 'Enter property name (e.g., ID, CATEGORY)',
        validateInput: (value) => {
            if (!value) return null;
            if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
                return 'Property name must start with a letter and contain only letters, numbers, underscores, and hyphens';
            }
            return null;
        }
    });

    if (!propertyName) return;

    const propertyValue = await vscode.window.showInputBox({
        prompt: `Value for ${propertyName}`,
        placeHolder: 'Enter property value'
    });

    if (propertyValue === undefined) return;

    await setPropertyValue(editor, headingLine, propertyName, propertyValue);
    vscode.window.showInformationMessage(`Set ${propertyName}: ${propertyValue}`);
}

/**
 * Set a property value in the properties drawer
 */
async function setPropertyValue(
    editor: vscode.TextEditor,
    headingLine: number,
    propertyName: string,
    value: string
): Promise<void> {
    const document = editor.document;

    // Ensure properties drawer exists
    const drawer = await ensurePropertiesDrawer(editor, headingLine);

    // Re-read document after potential edit
    const docAfter = editor.document;

    // Search for existing property
    const propPattern = new RegExp(`^\\s*:${propertyName}:\\s*(.*)$`, 'i');
    let existingLine = -1;

    for (let i = drawer.startLine + 1; i < drawer.endLine; i++) {
        const line = docAfter.lineAt(i).text;
        if (propPattern.test(line)) {
            existingLine = i;
            break;
        }
    }

    if (existingLine >= 0) {
        // Update existing property
        const line = docAfter.lineAt(existingLine);
        const newText = `:${propertyName}: ${value}`;
        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, newText);
        });
    } else {
        // Insert new property before :END:
        const endLine = drawer.endLine;
        await editor.edit(editBuilder => {
            editBuilder.insert(
                new vscode.Position(endLine, 0),
                `:${propertyName}: ${value}\n`
            );
        });
    }
}

/**
 * Set priority on current heading
 */
export async function setPriority(priority: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const position = editor.selection.active;

    // Find the heading
    let headingLine = position.line;
    if (getHeadingLevel(document, headingLine) === 0) {
        vscode.window.showInformationMessage('Not on a heading');
        return;
    }

    const line = document.lineAt(headingLine);
    let lineText = line.text;

    // Check for existing priority
    const priorityMatch = lineText.match(/\[#[A-Z]\]/);

    if (priority === '') {
        // Remove priority
        if (priorityMatch) {
            lineText = lineText.replace(/\s*\[#[A-Z]\]\s*/, ' ');
        }
    } else {
        const newPriority = `[#${priority}]`;
        if (priorityMatch) {
            // Replace existing priority
            lineText = lineText.replace(/\[#[A-Z]\]/, newPriority);
        } else {
            // Insert priority after TODO keyword or after stars
            const headingMatch = lineText.match(/^(\*+)\s+(TODO|DONE|NEXT|WAITING|HOLD|SOMEDAY|CANCELLED|CANCELED)?\s*/);
            if (headingMatch) {
                const insertPos = headingMatch[0].length;
                lineText = lineText.slice(0, insertPos) + newPriority + ' ' + lineText.slice(insertPos);
            }
        }
    }

    // Clean up extra spaces
    lineText = lineText.replace(/  +/g, ' ');

    await editor.edit(editBuilder => {
        editBuilder.replace(line.range, lineText);
    });

    if (priority) {
        vscode.window.showInformationMessage(`Priority: [#${priority}]`);
    } else {
        vscode.window.showInformationMessage('Priority removed');
    }
}
