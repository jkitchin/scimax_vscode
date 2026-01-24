/**
 * Speed Command Archive Functions
 *
 * Archive subtrees to archive files or sibling headings.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getHeadingLevel, getSubtreeRange } from './context';
import { extractTags, hasTag, toggleTag } from './utils';
import { DAY_NAMES_SHORT } from '../../utils/dateConstants';

/**
 * Get the archive file path for a given org file
 * Default: same directory, filename_archive.org
 */
function getArchiveFilePath(filePath: string): string {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    return path.join(dir, `${base}_archive${ext}`);
}

/**
 * Check if heading has :ARCHIVE: tag
 */
function hasArchiveTag(line: string): boolean {
    return hasTag(line, 'ARCHIVE');
}

/**
 * Archive subtree to archive file
 */
export async function archiveSubtree(): Promise<void> {
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

    const { startLine, endLine } = getSubtreeRange(document, headingLine);

    // Get subtree content
    const subtreeRange = new vscode.Range(startLine, 0, endLine + 1, 0);
    let subtreeText = document.getText(subtreeRange);

    // Add archive metadata
    const now = new Date();
    const timestamp = `[${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${DAY_NAMES_SHORT[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}]`;
    const archiveFile = document.uri.fsPath;

    // Add :ARCHIVE: tag to the heading
    const headingText = document.lineAt(startLine).text;
    if (!hasArchiveTag(headingText)) {
        const { newLine } = toggleTag(headingText, 'ARCHIVE');
        subtreeText = subtreeText.replace(headingText, newLine);
    }

    // Add ARCHIVE_TIME and ARCHIVE_FILE properties if they don't exist
    if (!subtreeText.includes(':PROPERTIES:')) {
        // Insert properties drawer after heading
        const firstNewline = subtreeText.indexOf('\n');
        if (firstNewline >= 0) {
            subtreeText = subtreeText.slice(0, firstNewline + 1) +
                ':PROPERTIES:\n' +
                `:ARCHIVE_TIME: ${timestamp}\n` +
                `:ARCHIVE_FILE: ${archiveFile}\n` +
                ':END:\n' +
                subtreeText.slice(firstNewline + 1);
        }
    }

    // Append to archive file
    const archivePath = getArchiveFilePath(document.uri.fsPath);

    try {
        // Create archive file if it doesn't exist
        let archiveContent = '';
        if (fs.existsSync(archivePath)) {
            archiveContent = fs.readFileSync(archivePath, 'utf-8');
        } else {
            archiveContent = `#+TITLE: Archive\n#+ARCHIVE: ${path.basename(archivePath)}\n\n`;
        }

        // Append subtree
        if (!archiveContent.endsWith('\n')) {
            archiveContent += '\n';
        }
        archiveContent += '\n' + subtreeText;

        fs.writeFileSync(archivePath, archiveContent, 'utf-8');

        // Delete from current file
        await editor.edit(editBuilder => {
            editBuilder.delete(subtreeRange);
        });

        vscode.window.showInformationMessage(`Archived to ${path.basename(archivePath)}`);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to archive: ${error.message}`);
    }
}

/**
 * Toggle :ARCHIVE: tag on current heading
 */
export async function toggleArchiveTag(): Promise<void> {
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
    const { newLine, added } = toggleTag(line.text, 'ARCHIVE');

    await editor.edit(editBuilder => {
        editBuilder.replace(line.range, newLine);
    });

    vscode.window.showInformationMessage(
        added ? 'Added :ARCHIVE: tag' : 'Removed :ARCHIVE: tag'
    );
}

/**
 * Archive subtree to an "Archive" sibling heading
 */
export async function archiveToSibling(): Promise<void> {
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

    const level = getHeadingLevel(document, headingLine);
    const { startLine, endLine } = getSubtreeRange(document, headingLine);

    // Find parent level
    let parentLevel = level - 1;
    let parentEnd = document.lineCount - 1;

    if (parentLevel > 0) {
        // Find parent heading
        for (let i = startLine - 1; i >= 0; i--) {
            if (getHeadingLevel(document, i) === parentLevel) {
                // Find end of parent
                for (let j = i + 1; j < document.lineCount; j++) {
                    const nextLevel = getHeadingLevel(document, j);
                    if (nextLevel > 0 && nextLevel <= parentLevel) {
                        parentEnd = j - 1;
                        break;
                    }
                }
                break;
            }
        }
    }

    // Look for existing Archive sibling
    let archiveSiblingLine = -1;
    const archiveLevel = level;
    const prefix = document.languageId === 'org' ? '*'.repeat(archiveLevel) : '#'.repeat(archiveLevel);

    for (let i = startLine + 1; i <= parentEnd; i++) {
        const lineLevel = getHeadingLevel(document, i);
        if (lineLevel === archiveLevel) {
            const line = document.lineAt(i).text;
            if (/Archive\s*:ARCHIVE:/.test(line) || /^[*#]+\s+Archive\s/.test(line)) {
                archiveSiblingLine = i;
                break;
            }
        }
    }

    // Get subtree content
    const subtreeRange = new vscode.Range(startLine, 0, endLine + 1, 0);
    let subtreeText = document.getText(subtreeRange);

    // Demote the subtree by one level
    const headingPattern = document.languageId === 'org' ? /^(\*+)/gm : /^(#+)/gm;
    subtreeText = subtreeText.replace(headingPattern, (match, stars) => {
        return (document.languageId === 'org' ? '*' : '#') + stars;
    });

    // Add :ARCHIVE: tag to the demoted heading
    const firstLine = subtreeText.split('\n')[0];
    if (!hasArchiveTag(firstLine)) {
        const { newLine } = toggleTag(firstLine, 'ARCHIVE');
        subtreeText = subtreeText.replace(firstLine, newLine);
    }

    await editor.edit(async editBuilder => {
        // Delete original subtree
        editBuilder.delete(subtreeRange);
    });

    // Re-read document
    const docAfter = editor.document;

    // Adjust archive sibling line after deletion
    const deletedLines = endLine - startLine + 1;
    if (archiveSiblingLine > endLine) {
        archiveSiblingLine -= deletedLines;
    } else if (archiveSiblingLine >= startLine) {
        archiveSiblingLine = -1; // Was deleted
    }

    if (archiveSiblingLine >= 0) {
        // Insert under existing Archive sibling
        const { endLine: archiveEnd } = getSubtreeRange(docAfter, archiveSiblingLine);

        await editor.edit(editBuilder => {
            editBuilder.insert(
                new vscode.Position(archiveEnd + 1, 0),
                subtreeText
            );
        });
    } else {
        // Create new Archive sibling at the end of parent
        const archiveHeading = `${prefix} Archive :ARCHIVE:\n`;

        // Find insertion point (end of parent scope, adjusted for deletion)
        let insertLine = parentEnd - deletedLines;
        if (insertLine < startLine) insertLine = startLine;
        if (insertLine >= docAfter.lineCount) insertLine = docAfter.lineCount - 1;

        // Find actual end of current scope
        for (let i = startLine; i < docAfter.lineCount; i++) {
            const nextLevel = getHeadingLevel(docAfter, i);
            if (nextLevel > 0 && nextLevel <= parentLevel) {
                insertLine = i;
                break;
            }
            insertLine = i + 1;
        }

        await editor.edit(editBuilder => {
            editBuilder.insert(
                new vscode.Position(insertLine, 0),
                '\n' + archiveHeading + subtreeText
            );
        });
    }

    vscode.window.showInformationMessage('Archived to sibling');
}
