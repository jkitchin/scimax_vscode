/**
 * LaTeX Structure Editing Commands
 * Promote/demote sections, move sections, mark/kill/clone sections
 */

import * as vscode from 'vscode';
import {
    getSections,
    getSectionLevel,
    getSectionTypeAtLevel,
    LaTeXSection
} from './latexDocumentSymbolProvider';
import { isSectionLine, parseSectionLine } from './latexNavigation';

// Section command pattern for replacement
const SECTION_REPLACE_PATTERN = /^(\s*)\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)(\s*(?:\[[^\]]*\])?\s*\{)/;

/**
 * Get the range of a section (from section command to next section or end of document)
 */
export function getSectionRange(
    document: vscode.TextDocument,
    section: LaTeXSection
): vscode.Range {
    const sections = getSections(document);
    const sectionIndex = sections.findIndex(s => s.line === section.line);

    let endLine = document.lineCount - 1;

    // Find next section at same or higher level
    for (let i = sectionIndex + 1; i < sections.length; i++) {
        if (sections[i].level <= section.level) {
            endLine = sections[i].line - 1;
            // Include trailing blank lines in the current section
            while (endLine > section.line && document.lineAt(endLine).text.trim() === '') {
                endLine--;
            }
            break;
        }
    }

    return new vscode.Range(
        new vscode.Position(section.line, 0),
        new vscode.Position(endLine, document.lineAt(endLine).text.length)
    );
}

/**
 * Get the subtree range (section and all children)
 */
export function getSubtreeRange(
    document: vscode.TextDocument,
    section: LaTeXSection
): vscode.Range {
    const sections = getSections(document);
    const sectionIndex = sections.findIndex(s => s.line === section.line);

    let endLine = document.lineCount - 1;

    // Find next section at same or higher level (not children)
    for (let i = sectionIndex + 1; i < sections.length; i++) {
        if (sections[i].level <= section.level) {
            endLine = sections[i].line - 1;
            break;
        }
    }

    // Trim trailing blank lines
    while (endLine > section.line && document.lineAt(endLine).text.trim() === '') {
        endLine--;
    }

    return new vscode.Range(
        new vscode.Position(section.line, 0),
        new vscode.Position(endLine, document.lineAt(endLine).text.length)
    );
}

/**
 * Find the current section at cursor
 */
function findCurrentSection(document: vscode.TextDocument, line: number): LaTeXSection | null {
    const sections = getSections(document);
    let current: LaTeXSection | null = null;

    for (const section of sections) {
        if (section.line <= line) {
            current = section;
        } else {
            break;
        }
    }

    return current;
}

/**
 * Promote section (e.g., \subsection -> \section)
 */
export async function promoteSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const line = editor.selection.active.line;
    const lineText = document.lineAt(line).text;

    const match = lineText.match(SECTION_REPLACE_PATTERN);
    if (!match) {
        vscode.window.setStatusBarMessage('Not on a section line', 2000);
        return;
    }

    const [, indent, currentType, starred, rest] = match;
    const currentLevel = getSectionLevel(currentType);

    if (currentLevel === 0) {
        vscode.window.setStatusBarMessage('Cannot promote \\part further', 2000);
        return;
    }

    const newType = getSectionTypeAtLevel(currentLevel - 1);
    const newText = `${indent}\\${newType}${starred}${rest}`;

    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            new vscode.Position(line, 0),
            new vscode.Position(line, lineText.indexOf('{') + 1)
        );
        editBuilder.replace(range, newText);
    });

    vscode.window.setStatusBarMessage(`Promoted to \\${newType}`, 2000);
}

/**
 * Demote section (e.g., \section -> \subsection)
 */
export async function demoteSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const line = editor.selection.active.line;
    const lineText = document.lineAt(line).text;

    const match = lineText.match(SECTION_REPLACE_PATTERN);
    if (!match) {
        vscode.window.setStatusBarMessage('Not on a section line', 2000);
        return;
    }

    const [, indent, currentType, starred, rest] = match;
    const currentLevel = getSectionLevel(currentType);

    if (currentLevel >= 6) {
        vscode.window.setStatusBarMessage('Cannot demote \\subparagraph further', 2000);
        return;
    }

    const newType = getSectionTypeAtLevel(currentLevel + 1);
    const newText = `${indent}\\${newType}${starred}${rest}`;

    await editor.edit(editBuilder => {
        const range = new vscode.Range(
            new vscode.Position(line, 0),
            new vscode.Position(line, lineText.indexOf('{') + 1)
        );
        editBuilder.replace(range, newText);
    });

    vscode.window.setStatusBarMessage(`Demoted to \\${newType}`, 2000);
}

/**
 * Promote entire subtree (section and all children)
 */
export async function promoteSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const currentSection = findCurrentSection(document, currentLine);

    if (!currentSection) {
        vscode.window.setStatusBarMessage('Not in a section', 2000);
        return;
    }

    if (currentSection.level === 0) {
        vscode.window.setStatusBarMessage('Cannot promote \\part further', 2000);
        return;
    }

    const subtreeRange = getSubtreeRange(document, currentSection);
    const sections = getSections(document);

    // Find all sections in this subtree
    const sectionsToPromote = sections.filter(s =>
        s.line >= subtreeRange.start.line && s.line <= subtreeRange.end.line
    );

    // Apply edits in reverse order to preserve line numbers
    await editor.edit(editBuilder => {
        for (let i = sectionsToPromote.length - 1; i >= 0; i--) {
            const section = sectionsToPromote[i];
            const lineText = document.lineAt(section.line).text;
            const match = lineText.match(SECTION_REPLACE_PATTERN);

            if (match) {
                const [, indent, type, starred, rest] = match;
                const level = getSectionLevel(type);
                if (level > 0) {
                    const newType = getSectionTypeAtLevel(level - 1);
                    const newText = `${indent}\\${newType}${starred}${rest}`;
                    const range = new vscode.Range(
                        new vscode.Position(section.line, 0),
                        new vscode.Position(section.line, lineText.indexOf('{') + 1)
                    );
                    editBuilder.replace(range, newText);
                }
            }
        }
    });

    vscode.window.setStatusBarMessage(`Promoted ${sectionsToPromote.length} section(s)`, 2000);
}

/**
 * Demote entire subtree (section and all children)
 */
export async function demoteSubtree(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const currentSection = findCurrentSection(document, currentLine);

    if (!currentSection) {
        vscode.window.setStatusBarMessage('Not in a section', 2000);
        return;
    }

    const subtreeRange = getSubtreeRange(document, currentSection);
    const sections = getSections(document);

    // Find all sections in this subtree
    const sectionsToDemote = sections.filter(s =>
        s.line >= subtreeRange.start.line && s.line <= subtreeRange.end.line
    );

    // Check if any section is already at max level
    const maxLevel = Math.max(...sectionsToDemote.map(s => s.level));
    if (maxLevel >= 6) {
        vscode.window.setStatusBarMessage('Some sections cannot be demoted further', 2000);
        return;
    }

    // Apply edits in reverse order to preserve line numbers
    await editor.edit(editBuilder => {
        for (let i = sectionsToDemote.length - 1; i >= 0; i--) {
            const section = sectionsToDemote[i];
            const lineText = document.lineAt(section.line).text;
            const match = lineText.match(SECTION_REPLACE_PATTERN);

            if (match) {
                const [, indent, type, starred, rest] = match;
                const level = getSectionLevel(type);
                if (level < 6) {
                    const newType = getSectionTypeAtLevel(level + 1);
                    const newText = `${indent}\\${newType}${starred}${rest}`;
                    const range = new vscode.Range(
                        new vscode.Position(section.line, 0),
                        new vscode.Position(section.line, lineText.indexOf('{') + 1)
                    );
                    editBuilder.replace(range, newText);
                }
            }
        }
    });

    vscode.window.setStatusBarMessage(`Demoted ${sectionsToDemote.length} section(s)`, 2000);
}

/**
 * Move section up (swap with previous sibling)
 */
export async function moveSectionUp(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const sections = getSections(document);

    // Find current section
    let currentSection: LaTeXSection | null = null;
    let currentIndex = -1;
    for (let i = 0; i < sections.length; i++) {
        if (sections[i].line <= currentLine) {
            currentSection = sections[i];
            currentIndex = i;
        } else {
            break;
        }
    }

    if (!currentSection || currentIndex <= 0) {
        vscode.window.setStatusBarMessage('Cannot move section up', 2000);
        return;
    }

    // Find previous sibling
    let prevSibling: LaTeXSection | null = null;
    let prevIndex = -1;
    for (let i = currentIndex - 1; i >= 0; i--) {
        if (sections[i].level < currentSection.level) {
            // Hit parent, no sibling found
            break;
        }
        if (sections[i].level === currentSection.level) {
            prevSibling = sections[i];
            prevIndex = i;
            break;
        }
    }

    if (!prevSibling) {
        vscode.window.setStatusBarMessage('No previous sibling section', 2000);
        return;
    }

    // Get ranges
    const currentRange = getSubtreeRange(document, currentSection);
    const prevRange = getSubtreeRange(document, prevSibling);

    // Get text
    const currentText = document.getText(currentRange);
    const prevText = document.getText(prevRange);

    // Swap the sections
    await editor.edit(editBuilder => {
        // Replace current with previous content
        editBuilder.replace(currentRange, prevText);
        // Replace previous with current content
        editBuilder.replace(prevRange, currentText);
    });

    // Move cursor to new position
    const newLine = prevSibling.line;
    const newPosition = new vscode.Position(newLine, 0);
    editor.selection = new vscode.Selection(newPosition, newPosition);
    editor.revealRange(
        new vscode.Range(newPosition, newPosition),
        vscode.TextEditorRevealType.InCenter
    );

    vscode.window.setStatusBarMessage('Moved section up', 2000);
}

/**
 * Move section down (swap with next sibling)
 */
export async function moveSectionDown(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const sections = getSections(document);

    // Find current section
    let currentSection: LaTeXSection | null = null;
    let currentIndex = -1;
    for (let i = 0; i < sections.length; i++) {
        if (sections[i].line <= currentLine) {
            currentSection = sections[i];
            currentIndex = i;
        } else {
            break;
        }
    }

    if (!currentSection) {
        vscode.window.setStatusBarMessage('Not in a section', 2000);
        return;
    }

    // Find next sibling
    let nextSibling: LaTeXSection | null = null;
    for (let i = currentIndex + 1; i < sections.length; i++) {
        if (sections[i].level < currentSection.level) {
            // Hit parent level, no sibling
            break;
        }
        if (sections[i].level === currentSection.level) {
            nextSibling = sections[i];
            break;
        }
    }

    if (!nextSibling) {
        vscode.window.setStatusBarMessage('No next sibling section', 2000);
        return;
    }

    // Get ranges
    const currentRange = getSubtreeRange(document, currentSection);
    const nextRange = getSubtreeRange(document, nextSibling);

    // Get text
    const currentText = document.getText(currentRange);
    const nextText = document.getText(nextRange);

    // Swap the sections (do next first since it comes after in document)
    await editor.edit(editBuilder => {
        editBuilder.replace(nextRange, currentText);
        editBuilder.replace(currentRange, nextText);
    });

    // Calculate new cursor position
    const linesDiff = nextRange.end.line - nextRange.start.line + 1;
    const newLine = currentSection.line + linesDiff;
    const newPosition = new vscode.Position(newLine, 0);
    editor.selection = new vscode.Selection(newPosition, newPosition);
    editor.revealRange(
        new vscode.Range(newPosition, newPosition),
        vscode.TextEditorRevealType.InCenter
    );

    vscode.window.setStatusBarMessage('Moved section down', 2000);
}

/**
 * Mark (select) the current section content
 */
export async function markSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const currentSection = findCurrentSection(document, currentLine);

    if (!currentSection) {
        vscode.window.setStatusBarMessage('Not in a section', 2000);
        return;
    }

    const range = getSubtreeRange(document, currentSection);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

/**
 * Kill (delete) the current section, copying to clipboard
 */
export async function killSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const currentSection = findCurrentSection(document, currentLine);

    if (!currentSection) {
        vscode.window.setStatusBarMessage('Not in a section', 2000);
        return;
    }

    const range = getSubtreeRange(document, currentSection);
    const text = document.getText(range);

    // Copy to clipboard
    await vscode.env.clipboard.writeText(text);

    // Delete the section (include trailing newline if present)
    const deleteRange = new vscode.Range(
        range.start,
        range.end.line < document.lineCount - 1
            ? new vscode.Position(range.end.line + 1, 0)
            : range.end
    );

    await editor.edit(editBuilder => {
        editBuilder.delete(deleteRange);
    });

    vscode.window.setStatusBarMessage('Section killed and copied to clipboard', 2000);
}

/**
 * Clone (duplicate) the current section
 */
export async function cloneSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const currentSection = findCurrentSection(document, currentLine);

    if (!currentSection) {
        vscode.window.setStatusBarMessage('Not in a section', 2000);
        return;
    }

    const range = getSubtreeRange(document, currentSection);
    const text = document.getText(range);

    // Insert after the current section
    const insertPosition = new vscode.Position(range.end.line + 1, 0);

    await editor.edit(editBuilder => {
        editBuilder.insert(insertPosition, text + '\n');
    });

    // Move to the cloned section
    const newPosition = new vscode.Position(range.end.line + 1, 0);
    editor.selection = new vscode.Selection(newPosition, newPosition);
    editor.revealRange(
        new vscode.Range(newPosition, newPosition),
        vscode.TextEditorRevealType.InCenter
    );

    vscode.window.setStatusBarMessage('Section cloned', 2000);
}

/**
 * Insert a new section at the same level
 */
export async function insertSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const currentSection = findCurrentSection(document, currentLine);

    let sectionType = 'section';
    if (currentSection) {
        sectionType = currentSection.type;
    }

    // Find end of current section/subtree
    let insertLine = document.lineCount;
    if (currentSection) {
        const range = getSubtreeRange(document, currentSection);
        insertLine = range.end.line + 1;
    }

    const insertPosition = new vscode.Position(insertLine, 0);
    const newSectionText = `\n\\${sectionType}{}\n\n`;

    await editor.edit(editBuilder => {
        editBuilder.insert(insertPosition, newSectionText);
    });

    // Position cursor inside the braces
    const newLine = insertLine + 1;
    const newCol = sectionType.length + 2; // After \sectiontype{
    const newPosition = new vscode.Position(newLine, newCol);
    editor.selection = new vscode.Selection(newPosition, newPosition);
    editor.revealRange(
        new vscode.Range(newPosition, newPosition),
        vscode.TextEditorRevealType.InCenter
    );
}

/**
 * Insert a new subsection (one level deeper)
 */
export async function insertSubsection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const currentSection = findCurrentSection(document, currentLine);

    let sectionType = 'subsection';
    if (currentSection) {
        const newLevel = Math.min(currentSection.level + 1, 6);
        sectionType = getSectionTypeAtLevel(newLevel);
    }

    // Insert right after current line
    const insertPosition = new vscode.Position(currentLine + 1, 0);
    const newSectionText = `\n\\${sectionType}{}\n\n`;

    await editor.edit(editBuilder => {
        editBuilder.insert(insertPosition, newSectionText);
    });

    // Position cursor inside the braces
    const newLine = currentLine + 2;
    const newCol = sectionType.length + 2; // After \sectiontype{
    const newPosition = new vscode.Position(newLine, newCol);
    editor.selection = new vscode.Selection(newPosition, newPosition);
    editor.revealRange(
        new vscode.Range(newPosition, newPosition),
        vscode.TextEditorRevealType.InCenter
    );
}

/**
 * Narrow to current section (hide everything else)
 * Uses VS Code's built-in folding
 */
export async function narrowToSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const currentSection = findCurrentSection(document, currentLine);

    if (!currentSection) {
        vscode.window.setStatusBarMessage('Not in a section', 2000);
        return;
    }

    const range = getSubtreeRange(document, currentSection);

    // Fold everything except current section
    await vscode.commands.executeCommand('editor.foldAll');

    // Unfold the current section
    editor.selection = new vscode.Selection(
        new vscode.Position(currentSection.line, 0),
        new vscode.Position(currentSection.line, 0)
    );
    await vscode.commands.executeCommand('editor.unfoldRecursively');

    // Restore selection
    editor.selection = new vscode.Selection(
        new vscode.Position(currentLine, 0),
        new vscode.Position(currentLine, 0)
    );

    vscode.window.setStatusBarMessage(`Narrowed to: ${currentSection.title}`, 2000);
}

/**
 * Widen (unfold all) after narrowing
 */
export async function widen(): Promise<void> {
    await vscode.commands.executeCommand('editor.unfoldAll');
    vscode.window.setStatusBarMessage('Widened', 2000);
}
