/**
 * LaTeX Navigation Commands
 * Navigate between sections, environments, and labels
 */

import * as vscode from 'vscode';
import {
    getSections,
    getEnvironments,
    getLabels,
    LaTeXSection,
    LaTeXEnvironment
} from './latexDocumentSymbolProvider';

// Regex pattern for section commands
const SECTION_PATTERN = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*)?\s*(?:\[([^\]]*)\])?\s*\{/;

/**
 * Check if a line is a LaTeX section command
 */
export function isSectionLine(line: string): boolean {
    return SECTION_PATTERN.test(line);
}

/**
 * Get section info from a line
 */
export function parseSectionLine(line: string): { type: string; starred: boolean } | null {
    const match = line.match(SECTION_PATTERN);
    if (match) {
        return {
            type: match[1],
            starred: !!match[2]
        };
    }
    return null;
}

/**
 * Jump to next section (any level)
 */
export async function nextSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const sections = getSections(document);

    // Find next section after current line
    for (const section of sections) {
        if (section.line > currentLine) {
            const position = new vscode.Position(section.line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
            return;
        }
    }

    vscode.window.setStatusBarMessage('No next section', 2000);
}

/**
 * Jump to previous section (any level)
 */
export async function previousSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const sections = getSections(document);

    // Find previous section before current line
    let prevSection: LaTeXSection | null = null;
    for (const section of sections) {
        if (section.line < currentLine) {
            prevSection = section;
        } else {
            break;
        }
    }

    if (prevSection) {
        const position = new vscode.Position(prevSection.line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
    } else {
        vscode.window.setStatusBarMessage('No previous section', 2000);
    }
}

/**
 * Jump to parent section (higher level)
 */
export async function parentSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const sections = getSections(document);

    // Find current section
    let currentSection: LaTeXSection | null = null;
    for (const section of sections) {
        if (section.line <= currentLine) {
            currentSection = section;
        } else {
            break;
        }
    }

    if (!currentSection) {
        vscode.window.setStatusBarMessage('Not in a section', 2000);
        return;
    }

    // Find parent (section with lower level number = higher in hierarchy)
    let parentSec: LaTeXSection | null = null;
    for (const section of sections) {
        if (section.line < currentSection.line && section.level < currentSection.level) {
            parentSec = section;
        }
    }

    if (parentSec) {
        const position = new vscode.Position(parentSec.line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
    } else {
        vscode.window.setStatusBarMessage('No parent section', 2000);
    }
}

/**
 * Jump to next sibling section (same level)
 */
export async function nextSiblingSection(): Promise<void> {
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
        // Not in a section, just go to next section
        await nextSection();
        return;
    }

    // Find next section at same level (stop if we hit a higher-level section)
    for (let i = currentIndex + 1; i < sections.length; i++) {
        const section = sections[i];
        if (section.level < currentSection.level) {
            // Hit a parent section, no more siblings
            break;
        }
        if (section.level === currentSection.level) {
            const position = new vscode.Position(section.line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
            return;
        }
    }

    vscode.window.setStatusBarMessage('No next sibling section', 2000);
}

/**
 * Jump to previous sibling section (same level)
 */
export async function previousSiblingSection(): Promise<void> {
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
        vscode.window.setStatusBarMessage('No previous sibling section', 2000);
        return;
    }

    // Find previous section at same level (stop if we hit a higher-level section)
    for (let i = currentIndex - 1; i >= 0; i--) {
        const section = sections[i];
        if (section.level < currentSection.level) {
            // Hit a parent section, no more siblings
            break;
        }
        if (section.level === currentSection.level) {
            const position = new vscode.Position(section.line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
            return;
        }
    }

    vscode.window.setStatusBarMessage('No previous sibling section', 2000);
}

/**
 * Jump to first section in document
 */
export async function firstSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const sections = getSections(editor.document);

    if (sections.length > 0) {
        const position = new vscode.Position(sections[0].line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
    } else {
        vscode.window.setStatusBarMessage('No sections in document', 2000);
    }
}

/**
 * Jump to last section in document
 */
export async function lastSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const sections = getSections(editor.document);

    if (sections.length > 0) {
        const lastSec = sections[sections.length - 1];
        const position = new vscode.Position(lastSec.line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
    } else {
        vscode.window.setStatusBarMessage('No sections in document', 2000);
    }
}

/**
 * Show QuickPick to jump to any section
 */
export async function jumpToSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const sections = getSections(editor.document);

    if (sections.length === 0) {
        vscode.window.showInformationMessage('No sections in document');
        return;
    }

    const items = sections.map(section => {
        // Create indentation based on level
        const indent = '  '.repeat(section.level);
        const starred = section.starred ? '*' : '';
        return {
            label: `${indent}${section.title}${starred}`,
            description: `\\${section.type}`,
            detail: `Line ${section.line + 1}`,
            section
        };
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Jump to section...',
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (selected) {
        const position = new vscode.Position(selected.section.line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
    }
}

/**
 * Jump to next environment
 */
export async function nextEnvironment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const environments = getEnvironments(document);

    // Find next environment after current line
    for (const env of environments) {
        if (env.line > currentLine) {
            const position = new vscode.Position(env.line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
            return;
        }
    }

    vscode.window.setStatusBarMessage('No next environment', 2000);
}

/**
 * Jump to previous environment
 */
export async function previousEnvironment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const environments = getEnvironments(document);

    // Find previous environment before current line
    let prevEnv: LaTeXEnvironment | null = null;
    for (const env of environments) {
        if (env.line < currentLine) {
            prevEnv = env;
        } else {
            break;
        }
    }

    if (prevEnv) {
        const position = new vscode.Position(prevEnv.line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
    } else {
        vscode.window.setStatusBarMessage('No previous environment', 2000);
    }
}

/**
 * Show QuickPick to jump to any environment
 */
export async function jumpToEnvironment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const environments = getEnvironments(editor.document);

    if (environments.length === 0) {
        vscode.window.showInformationMessage('No environments in document');
        return;
    }

    const items = environments.map(env => {
        let label = env.name;
        if (env.caption) {
            label = `${env.name}: ${env.caption}`;
        } else if (env.label) {
            label = `${env.name} [${env.label}]`;
        }
        return {
            label,
            description: env.label ? `\\label{${env.label}}` : '',
            detail: `Lines ${env.line + 1}-${env.endLine + 1}`,
            env
        };
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Jump to environment...',
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (selected) {
        const position = new vscode.Position(selected.env.line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
    }
}

/**
 * Show QuickPick to jump to any label
 */
export async function jumpToLabel(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const labels = getLabels(editor.document);

    if (labels.length === 0) {
        vscode.window.showInformationMessage('No labels in document');
        return;
    }

    const items = labels.map(label => ({
        label: label.name,
        description: label.context || '',
        detail: `Line ${label.line + 1}`,
        labelInfo: label
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Jump to label...',
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (selected) {
        const position = new vscode.Position(selected.labelInfo.line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
    }
}

/**
 * Find the environment containing the cursor
 */
export function findCurrentEnvironment(
    document: vscode.TextDocument,
    position: vscode.Position
): LaTeXEnvironment | undefined {
    const environments = getEnvironments(document);
    const line = position.line;

    // Find innermost environment containing the cursor
    let current: LaTeXEnvironment | undefined;
    for (const env of environments) {
        if (env.line <= line && env.endLine >= line) {
            if (!current || (env.line >= current.line && env.endLine <= current.endLine)) {
                current = env;
            }
        }
    }

    return current;
}

/**
 * Jump to the matching \begin or \end
 */
export async function jumpToMatchingEnvironment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') return;

    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line).text;

    // Check if on \begin line
    const beginMatch = line.match(/\\begin\{(\w+)\}/);
    if (beginMatch) {
        const env = findCurrentEnvironment(document, position);
        if (env) {
            const newPos = new vscode.Position(env.endLine, 0);
            editor.selection = new vscode.Selection(newPos, newPos);
            editor.revealRange(
                new vscode.Range(newPos, newPos),
                vscode.TextEditorRevealType.InCenter
            );
            return;
        }
    }

    // Check if on \end line
    const endMatch = line.match(/\\end\{(\w+)\}/);
    if (endMatch) {
        const environments = getEnvironments(document);
        for (const env of environments) {
            if (env.endLine === position.line) {
                const newPos = new vscode.Position(env.line, 0);
                editor.selection = new vscode.Selection(newPos, newPos);
                editor.revealRange(
                    new vscode.Range(newPos, newPos),
                    vscode.TextEditorRevealType.InCenter
                );
                return;
            }
        }
    }

    vscode.window.setStatusBarMessage('Not on \\begin or \\end line', 2000);
}
