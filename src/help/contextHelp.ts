/**
 * Contextual Help System
 * Detects cursor context and shows relevant commands/keybindings
 */

import * as vscode from 'vscode';

// =============================================================================
// Types
// =============================================================================

interface ContextHelpItem {
    command: string;
    title: string;
    keybinding?: string;
    description?: string;
    category: string;
}

interface ContextHelp {
    context: string;
    icon: string;
    description: string;
    items: ContextHelpItem[];
}

type ContextType =
    | 'sourceBlock'
    | 'table'
    | 'heading'
    | 'todo'
    | 'link'
    | 'citation'
    | 'latex'
    | 'timestamp'
    | 'clock'
    | 'properties'
    | 'listItem'
    | 'results'
    | 'bibtex'
    | 'markdown'
    | 'general';

// =============================================================================
// Context Detection
// =============================================================================

interface DetectedContext {
    type: ContextType;
    details?: string;  // e.g., language for source blocks
}

function detectContext(editor: vscode.TextEditor): DetectedContext {
    const document = editor.document;
    const position = editor.selection.active;
    const line = document.lineAt(position.line).text;
    const languageId = document.languageId;
    const fileName = document.fileName;

    // Check for BibTeX file
    if (languageId === 'bibtex' || fileName.endsWith('.bib')) {
        return { type: 'bibtex' };
    }

    // Check for LaTeX file
    if (languageId === 'latex' || languageId === 'tex') {
        return { type: 'latex', details: 'LaTeX document' };
    }

    // Check for Markdown file (not org)
    if (languageId === 'markdown' && !fileName.endsWith('.org')) {
        return detectMarkdownContext(document, position, line);
    }

    // For org files, do detailed context detection
    if (languageId === 'org' || fileName.endsWith('.org')) {
        return detectOrgContext(document, position, line);
    }

    return { type: 'general' };
}

function detectOrgContext(
    document: vscode.TextDocument,
    position: vscode.Position,
    line: string
): DetectedContext {
    // Check if in source block
    const srcBlockInfo = isInSourceBlock(document, position);
    if (srcBlockInfo.inBlock) {
        return { type: 'sourceBlock', details: srcBlockInfo.language };
    }

    // Check if in results block
    if (isInResultsBlock(document, position)) {
        return { type: 'results' };
    }

    // Check if in table
    if (isInTable(line)) {
        return { type: 'table' };
    }

    // Check if on heading
    if (isHeading(line)) {
        // Check if it's a TODO heading
        if (isTodoHeading(line)) {
            return { type: 'todo', details: extractTodoState(line) };
        }
        return { type: 'heading' };
    }

    // Check if on timestamp
    if (hasTimestamp(line)) {
        return { type: 'timestamp' };
    }

    // Check if on clock entry
    if (isClockLine(line)) {
        return { type: 'clock' };
    }

    // Check if in properties drawer
    if (isInPropertiesDrawer(document, position)) {
        return { type: 'properties' };
    }

    // Check if on link
    if (hasLink(line, position.character)) {
        return { type: 'link' };
    }

    // Check if on citation
    if (hasCitation(line, position.character)) {
        return { type: 'citation' };
    }

    // Check if on list item
    if (isListItem(line)) {
        return { type: 'listItem' };
    }

    // Check for inline LaTeX
    if (hasInlineLatex(line, position.character)) {
        return { type: 'latex', details: 'inline' };
    }

    return { type: 'general' };
}

function detectMarkdownContext(
    document: vscode.TextDocument,
    position: vscode.Position,
    line: string
): DetectedContext {
    // Check if in fenced code block
    const codeBlockInfo = isInMarkdownCodeBlock(document, position);
    if (codeBlockInfo.inBlock) {
        return { type: 'sourceBlock', details: codeBlockInfo.language };
    }

    // Check if in table
    if (isInTable(line)) {
        return { type: 'table' };
    }

    // Check if on heading
    if (/^#{1,6}\s/.test(line)) {
        return { type: 'heading' };
    }

    // Check if on list item
    if (isListItem(line)) {
        return { type: 'listItem' };
    }

    // Check for inline LaTeX
    if (hasInlineLatex(line, position.character)) {
        return { type: 'latex', details: 'inline' };
    }

    // Check if on link
    if (/\[([^\]]+)\]\([^)]+\)/.test(line) || /\[([^\]]+)\]\[[^\]]*\]/.test(line)) {
        return { type: 'link' };
    }

    return { type: 'markdown' };
}

function isInMarkdownCodeBlock(document: vscode.TextDocument, position: vscode.Position): { inBlock: boolean; language?: string } {
    let inBlock = false;
    let language: string | undefined;

    for (let i = position.line; i >= 0; i--) {
        const lineText = document.lineAt(i).text;
        // Check for closing fence
        if (/^```\s*$/.test(lineText) && i !== position.line) {
            return { inBlock: false };
        }
        // Check for opening fence with optional language
        const beginMatch = lineText.match(/^```(\w+)?/);
        if (beginMatch) {
            inBlock = true;
            language = beginMatch[1] || 'unknown';
            break;
        }
    }

    return { inBlock, language };
}

// Helper functions for context detection

function isInSourceBlock(document: vscode.TextDocument, position: vscode.Position): { inBlock: boolean; language?: string } {
    let inBlock = false;
    let language: string | undefined;

    for (let i = position.line; i >= 0; i--) {
        const lineText = document.lineAt(i).text;
        if (/^\s*#\+END_SRC/i.test(lineText)) {
            return { inBlock: false };
        }
        const beginMatch = lineText.match(/^\s*#\+BEGIN_SRC\s+(\S+)?/i);
        if (beginMatch) {
            inBlock = true;
            language = beginMatch[1] || 'unknown';
            break;
        }
    }

    if (inBlock) {
        // Verify we haven't passed the end
        for (let i = position.line; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            if (/^\s*#\+END_SRC/i.test(lineText)) {
                return { inBlock: true, language };
            }
            if (/^\s*#\+BEGIN_SRC/i.test(lineText) && i !== position.line) {
                return { inBlock: false };
            }
        }
    }

    return { inBlock, language };
}

function isInResultsBlock(document: vscode.TextDocument, position: vscode.Position): boolean {
    for (let i = position.line; i >= 0; i--) {
        const lineText = document.lineAt(i).text;
        if (/^\s*#\+RESULTS:/i.test(lineText)) {
            return true;
        }
        if (/^\s*#\+BEGIN_/i.test(lineText) || /^\s*\*+\s/.test(lineText)) {
            return false;
        }
    }
    return false;
}

function isInTable(line: string): boolean {
    return /^\s*\|/.test(line);
}

function isHeading(line: string): boolean {
    return /^\*+\s/.test(line);
}

function isTodoHeading(line: string): boolean {
    return /^\*+\s+(TODO|DONE|NEXT|WAITING|CANCELLED|HOLD)\s/.test(line);
}

function extractTodoState(line: string): string {
    const match = line.match(/^\*+\s+(TODO|DONE|NEXT|WAITING|CANCELLED|HOLD)\s/);
    return match ? match[1] : '';
}

function hasTimestamp(line: string): boolean {
    return /<\d{4}-\d{2}-\d{2}/.test(line) || /\[\d{4}-\d{2}-\d{2}/.test(line);
}

function isClockLine(line: string): boolean {
    return /^\s*CLOCK:/.test(line);
}

function isInPropertiesDrawer(document: vscode.TextDocument, position: vscode.Position): boolean {
    for (let i = position.line; i >= 0; i--) {
        const lineText = document.lineAt(i).text;
        if (/^\s*:END:/i.test(lineText)) {
            return false;
        }
        if (/^\s*:PROPERTIES:/i.test(lineText)) {
            return true;
        }
        if (/^\*+\s/.test(lineText)) {
            return false;
        }
    }
    return false;
}

function hasLink(line: string, character: number): boolean {
    // Check if cursor is on a link [[...]] or bare URL
    const linkRegex = /\[\[([^\]]+)\](?:\[([^\]]*)\])?\]|https?:\/\/\S+/g;
    let match;
    while ((match = linkRegex.exec(line)) !== null) {
        if (character >= match.index && character <= match.index + match[0].length) {
            return true;
        }
    }
    return false;
}

function hasCitation(line: string, character: number): boolean {
    // Check for cite:key or [[cite:...]]
    const citeRegex = /cite:[\w:-]+|\[\[cite:[^\]]+\]\]/g;
    let match;
    while ((match = citeRegex.exec(line)) !== null) {
        if (character >= match.index && character <= match.index + match[0].length) {
            return true;
        }
    }
    return false;
}

function isListItem(line: string): boolean {
    return /^\s*[-+*]\s/.test(line) || /^\s*\d+[.)]\s/.test(line);
}

function hasInlineLatex(line: string, character: number): boolean {
    // Check for $...$ or \(...\)
    const latexRegex = /\$[^$]+\$|\\\([^)]+\\\)/g;
    let match;
    while ((match = latexRegex.exec(line)) !== null) {
        if (character >= match.index && character <= match.index + match[0].length) {
            return true;
        }
    }
    return false;
}

// =============================================================================
// Command Registry
// =============================================================================

function getContextHelp(context: DetectedContext): ContextHelp {
    switch (context.type) {
        case 'sourceBlock':
            return getSourceBlockHelp(context.details);
        case 'table':
            return getTableHelp();
        case 'heading':
            return getHeadingHelp();
        case 'todo':
            return getTodoHelp(context.details);
        case 'link':
            return getLinkHelp();
        case 'citation':
            return getCitationHelp();
        case 'latex':
            return getLatexHelp(context.details);
        case 'timestamp':
            return getTimestampHelp();
        case 'clock':
            return getClockHelp();
        case 'properties':
            return getPropertiesHelp();
        case 'listItem':
            return getListItemHelp();
        case 'results':
            return getResultsHelp();
        case 'bibtex':
            return getBibtexHelp();
        case 'markdown':
            return getMarkdownHelp();
        default:
            return getGeneralHelp();
    }
}

function getSourceBlockHelp(language?: string): ContextHelp {
    return {
        context: 'Source Block',
        icon: '$(code)',
        description: language ? `${language} source block` : 'Source block',
        items: [
            // Execute
            { command: 'scimax.org.executeBlock', title: 'Execute Block', keybinding: 'C-c C-c', category: 'Execute' },
            { command: 'scimax.ob.executeAndNext', title: 'Execute and Next', keybinding: 'S-Enter', category: 'Execute' },
            { command: 'scimax.ob.executeAndNew', title: 'Execute and New Block', keybinding: 'M-S-Enter', category: 'Execute' },
            { command: 'scimax.ob.executeToPoint', title: 'Execute to Point', keybinding: 'C-c C-v e', category: 'Execute' },
            { command: 'scimax.ob.executeAll', title: 'Execute All Blocks', category: 'Execute' },

            // Navigate
            { command: 'scimax.ob.nextBlock', title: 'Next Block', keybinding: 'C-Down', category: 'Navigate' },
            { command: 'scimax.ob.previousBlock', title: 'Previous Block', keybinding: 'C-Up', category: 'Navigate' },
            { command: 'scimax.ob.jumpToBlock', title: 'Jump to Block', keybinding: 'C-c C-v g', category: 'Navigate' },
            { command: 'scimax.ob.jumpToResults', title: 'Jump to Results', category: 'Navigate' },

            // Edit
            { command: 'scimax.ob.splitBlock', title: 'Split Block', keybinding: 'C-c -', category: 'Edit' },
            { command: 'scimax.ob.mergeWithPrevious', title: 'Merge with Previous', category: 'Edit' },
            { command: 'scimax.ob.mergeWithNext', title: 'Merge with Next', category: 'Edit' },
            { command: 'scimax.ob.cloneBlock', title: 'Clone Block', category: 'Edit' },
            { command: 'scimax.ob.moveBlockUp', title: 'Move Block Up', category: 'Edit' },
            { command: 'scimax.ob.moveBlockDown', title: 'Move Block Down', category: 'Edit' },
            { command: 'scimax.ob.editHeader', title: 'Edit Header', category: 'Edit' },

            // Results
            { command: 'scimax.ob.clearResults', title: 'Clear Results', category: 'Results' },
            { command: 'scimax.ob.clearAllResults', title: 'Clear All Results', category: 'Results' },
            { command: 'scimax.ob.toggleResults', title: 'Toggle Results', category: 'Results' },

            // Insert
            { command: 'scimax.ob.insertBlockAbove', title: 'Insert Block Above', keybinding: 'Esc a', category: 'Insert' },
            { command: 'scimax.ob.insertBlockBelow', title: 'Insert Block Below', keybinding: 'Esc b', category: 'Insert' },

            // Kill/Copy
            { command: 'scimax.ob.killBlock', title: 'Kill Block and Results', category: 'Kill/Copy' },
            { command: 'scimax.ob.copyBlock', title: 'Copy Block and Results', category: 'Kill/Copy' },
        ]
    };
}

function getTableHelp(): ContextHelp {
    return {
        context: 'Table',
        icon: '$(table)',
        description: 'Org table',
        items: [
            // Navigate
            { command: 'scimax.table.nextCell', title: 'Next Cell', keybinding: 'Tab', category: 'Navigate' },
            { command: 'scimax.table.previousCell', title: 'Previous Cell', keybinding: 'S-Tab', category: 'Navigate' },
            { command: 'scimax.table.nextRow', title: 'Next Row', keybinding: 'Enter', category: 'Navigate' },

            // Edit Structure
            { command: 'scimax.table.insertRow', title: 'Insert Row Below', keybinding: 'M-Enter', category: 'Edit Structure' },
            { command: 'scimax.table.insertRowAbove', title: 'Insert Row Above', keybinding: 'M-S-Enter', category: 'Edit Structure' },
            { command: 'scimax.table.deleteRow', title: 'Delete Row', keybinding: 'M-S-Up', category: 'Edit Structure' },
            { command: 'scimax.table.insertColumn', title: 'Insert Column', category: 'Edit Structure' },
            { command: 'scimax.table.deleteColumn', title: 'Delete Column', category: 'Edit Structure' },
            { command: 'scimax.table.insertHline', title: 'Insert Horizontal Line', keybinding: 'C-c -', category: 'Edit Structure' },

            // Move
            { command: 'scimax.table.moveRowUp', title: 'Move Row Up', keybinding: 'M-Up', category: 'Move' },
            { command: 'scimax.table.moveRowDown', title: 'Move Row Down', keybinding: 'M-Down', category: 'Move' },
            { command: 'scimax.table.moveColumnLeft', title: 'Move Column Left', keybinding: 'M-Left', category: 'Move' },
            { command: 'scimax.table.moveColumnRight', title: 'Move Column Right', keybinding: 'M-Right', category: 'Move' },

            // Format
            { command: 'scimax.table.align', title: 'Align Table', keybinding: 'C-c C-c', category: 'Format' },
            { command: 'scimax.table.sort', title: 'Sort Table', category: 'Format' },
            { command: 'scimax.table.transpose', title: 'Transpose Table', category: 'Format' },

            // Export
            { command: 'scimax.table.exportCsv', title: 'Export to CSV', category: 'Export' },
            { command: 'scimax.table.exportMarkdown', title: 'Export to Markdown', category: 'Export' },
            { command: 'scimax.table.copyAsMarkdown', title: 'Copy as Markdown', category: 'Export' },
        ]
    };
}

function getHeadingHelp(): ContextHelp {
    return {
        context: 'Heading',
        icon: '$(list-tree)',
        description: 'Org heading',
        items: [
            // Navigate
            { command: 'scimax.org.nextHeading', title: 'Next Heading', keybinding: 'C-c C-n', category: 'Navigate' },
            { command: 'scimax.org.previousHeading', title: 'Previous Heading', keybinding: 'C-c C-p', category: 'Navigate' },
            { command: 'scimax.org.upHeading', title: 'Up to Parent', keybinding: 'C-c C-u', category: 'Navigate' },
            { command: 'scimax.org.gotoHeading', title: 'Go to Heading', keybinding: 'C-c C-j', category: 'Navigate' },

            // Structure
            { command: 'scimax.org.promoteHeading', title: 'Promote Heading', keybinding: 'M-Left', category: 'Structure' },
            { command: 'scimax.org.demoteHeading', title: 'Demote Heading', keybinding: 'M-Right', category: 'Structure' },
            { command: 'scimax.org.promoteSubtree', title: 'Promote Subtree', keybinding: 'M-S-Left', category: 'Structure' },
            { command: 'scimax.org.demoteSubtree', title: 'Demote Subtree', keybinding: 'M-S-Right', category: 'Structure' },
            { command: 'scimax.org.moveSubtreeUp', title: 'Move Subtree Up', keybinding: 'M-Up', category: 'Structure' },
            { command: 'scimax.org.moveSubtreeDown', title: 'Move Subtree Down', keybinding: 'M-Down', category: 'Structure' },

            // Insert
            { command: 'scimax.org.insertHeading', title: 'Insert Heading', keybinding: 'C-Enter', category: 'Insert' },
            { command: 'scimax.org.insertSubheading', title: 'Insert Subheading', category: 'Insert' },

            // Fold
            { command: 'scimax.org.cycleVisibility', title: 'Cycle Visibility', keybinding: 'Tab', category: 'Fold' },
            { command: 'scimax.org.cycleGlobalVisibility', title: 'Cycle Global', keybinding: 'S-Tab', category: 'Fold' },

            // Tags
            { command: 'scimax.org.setTags', title: 'Set Tags', keybinding: 'C-c C-q', category: 'Tags' },

            // Properties
            { command: 'scimax.org.setProperty', title: 'Set Property', keybinding: 'C-c C-x p', category: 'Properties' },

            // Archive
            { command: 'scimax.org.archiveSubtree', title: 'Archive Subtree', keybinding: 'C-c C-x C-a', category: 'Archive' },
        ]
    };
}

function getTodoHelp(todoState?: string): ContextHelp {
    const help = getHeadingHelp();
    help.context = 'TODO Item';
    help.icon = '$(tasklist)';
    help.description = todoState ? `${todoState} item` : 'TODO item';

    // Add TODO-specific commands at the beginning
    const todoItems: ContextHelpItem[] = [
        { command: 'scimax.org.cycleTodo', title: 'Cycle TODO State', keybinding: 'C-c C-t', category: 'TODO' },
        { command: 'scimax.org.setTodoState', title: 'Set TODO State', category: 'TODO' },
        { command: 'scimax.org.setPriority', title: 'Set Priority', keybinding: 'C-c ,', category: 'TODO' },
        { command: 'scimax.org.schedule', title: 'Schedule', keybinding: 'C-c C-s', category: 'Schedule' },
        { command: 'scimax.org.deadline', title: 'Set Deadline', keybinding: 'C-c C-d', category: 'Schedule' },
        { command: 'scimax.org.clockIn', title: 'Clock In', keybinding: 'C-c C-x C-i', category: 'Clock' },
        { command: 'scimax.org.clockOut', title: 'Clock Out', keybinding: 'C-c C-x C-o', category: 'Clock' },
    ];

    help.items = [...todoItems, ...help.items];
    return help;
}

function getLinkHelp(): ContextHelp {
    return {
        context: 'Link',
        icon: '$(link)',
        description: 'Org link',
        items: [
            { command: 'scimax.org.openLink', title: 'Open Link', keybinding: 'C-c C-o', category: 'Open' },
            { command: 'scimax.org.editLink', title: 'Edit Link', category: 'Edit' },
            { command: 'scimax.org.insertLink', title: 'Insert Link', keybinding: 'C-c C-l', category: 'Insert' },
            { command: 'scimax.org.storeLink', title: 'Store Link', category: 'Insert' },
            { command: 'scimax.org.nextLink', title: 'Next Link', keybinding: 'C-c C-x C-n', category: 'Navigate' },
            { command: 'scimax.org.previousLink', title: 'Previous Link', keybinding: 'C-c C-x C-p', category: 'Navigate' },
        ]
    };
}

function getCitationHelp(): ContextHelp {
    return {
        context: 'Citation',
        icon: '$(book)',
        description: 'Bibliography citation',
        items: [
            { command: 'scimax.ref.openCitation', title: 'Open Citation', keybinding: 'C-c C-o', category: 'Open' },
            { command: 'scimax.ref.openPdf', title: 'Open PDF', category: 'Open' },
            { command: 'scimax.ref.openUrl', title: 'Open URL', category: 'Open' },
            { command: 'scimax.ref.openNotes', title: 'Open Notes', category: 'Open' },
            { command: 'scimax.ref.insertCitation', title: 'Insert Citation', keybinding: 'C-c ]', category: 'Insert' },
            { command: 'scimax.ref.copyCitation', title: 'Copy Citation', category: 'Copy' },
            { command: 'scimax.ref.copyBibtex', title: 'Copy BibTeX', category: 'Copy' },
            { command: 'scimax.ref.googleScholar', title: 'Search Google Scholar', category: 'Search' },
            { command: 'scimax.ref.crossref', title: 'Search Crossref', category: 'Search' },
        ]
    };
}

function getLatexHelp(details?: string): ContextHelp {
    return {
        context: 'LaTeX',
        icon: '$(symbol-operator)',
        description: details === 'inline' ? 'Inline LaTeX' : 'LaTeX',
        items: [
            // Preview
            { command: 'scimax.latex.previewFragment', title: 'Preview Fragment', category: 'Preview' },
            { command: 'scimax.latex.previewAll', title: 'Preview All Fragments', category: 'Preview' },
            { command: 'scimax.latex.clearPreviews', title: 'Clear Previews', category: 'Preview' },

            // Insert
            { command: 'scimax.latex.insertEnvironment', title: 'Insert Environment', category: 'Insert' },
            { command: 'scimax.latex.insertEquation', title: 'Insert Equation', category: 'Insert' },
            { command: 'scimax.latex.insertInlineMath', title: 'Insert Inline Math', category: 'Insert' },

            // Navigate
            { command: 'scimax.latex.nextFragment', title: 'Next LaTeX Fragment', category: 'Navigate' },
            { command: 'scimax.latex.previousFragment', title: 'Previous LaTeX Fragment', category: 'Navigate' },

            // Export
            { command: 'scimax.export.latex', title: 'Export to LaTeX', category: 'Export' },
            { command: 'scimax.export.pdf', title: 'Export to PDF', keybinding: 'C-c C-e l p', category: 'Export' },
        ]
    };
}

function getTimestampHelp(): ContextHelp {
    return {
        context: 'Timestamp',
        icon: '$(calendar)',
        description: 'Date/time stamp',
        items: [
            { command: 'scimax.org.insertTimestamp', title: 'Insert Timestamp', keybinding: 'C-c .', category: 'Insert' },
            { command: 'scimax.org.insertInactiveTimestamp', title: 'Insert Inactive Timestamp', keybinding: 'C-c !', category: 'Insert' },
            { command: 'scimax.org.timestampUp', title: 'Increase Date', keybinding: 'S-Up', category: 'Modify' },
            { command: 'scimax.org.timestampDown', title: 'Decrease Date', keybinding: 'S-Down', category: 'Modify' },
            { command: 'scimax.org.schedule', title: 'Schedule', keybinding: 'C-c C-s', category: 'Schedule' },
            { command: 'scimax.org.deadline', title: 'Set Deadline', keybinding: 'C-c C-d', category: 'Schedule' },
        ]
    };
}

function getClockHelp(): ContextHelp {
    return {
        context: 'Clock Entry',
        icon: '$(clock)',
        description: 'Time tracking',
        items: [
            { command: 'scimax.org.clockIn', title: 'Clock In', keybinding: 'C-c C-x C-i', category: 'Clock' },
            { command: 'scimax.org.clockOut', title: 'Clock Out', keybinding: 'C-c C-x C-o', category: 'Clock' },
            { command: 'scimax.org.clockCancel', title: 'Cancel Clock', keybinding: 'C-c C-x C-q', category: 'Clock' },
            { command: 'scimax.org.clockReport', title: 'Insert Clock Report', keybinding: 'C-c C-x C-r', category: 'Report' },
            { command: 'scimax.org.clockDisplay', title: 'Display Times', keybinding: 'C-c C-x C-d', category: 'Report' },
            { command: 'scimax.org.updateDynamicBlock', title: 'Update Clock Table', keybinding: 'C-c C-c', category: 'Report' },
        ]
    };
}

function getPropertiesHelp(): ContextHelp {
    return {
        context: 'Properties Drawer',
        icon: '$(symbol-property)',
        description: 'Property drawer',
        items: [
            { command: 'scimax.org.setProperty', title: 'Set Property', keybinding: 'C-c C-x p', category: 'Edit' },
            { command: 'scimax.org.deleteProperty', title: 'Delete Property', category: 'Edit' },
            { command: 'scimax.org.insertDrawer', title: 'Insert Drawer', keybinding: 'C-c C-x d', category: 'Insert' },
        ]
    };
}

function getListItemHelp(): ContextHelp {
    return {
        context: 'List Item',
        icon: '$(list-unordered)',
        description: 'List item',
        items: [
            { command: 'scimax.org.cycleListType', title: 'Cycle List Type', category: 'Edit' },
            { command: 'scimax.org.toggleCheckbox', title: 'Toggle Checkbox', keybinding: 'C-c C-c', category: 'Edit' },
            { command: 'scimax.org.insertCheckbox', title: 'Insert Checkbox', category: 'Insert' },
            { command: 'scimax.org.indentItem', title: 'Indent Item', keybinding: 'M-Right', category: 'Structure' },
            { command: 'scimax.org.outdentItem', title: 'Outdent Item', keybinding: 'M-Left', category: 'Structure' },
            { command: 'scimax.org.moveItemUp', title: 'Move Item Up', keybinding: 'M-Up', category: 'Structure' },
            { command: 'scimax.org.moveItemDown', title: 'Move Item Down', keybinding: 'M-Down', category: 'Structure' },
        ]
    };
}

function getResultsHelp(): ContextHelp {
    return {
        context: 'Results Block',
        icon: '$(output)',
        description: 'Execution results',
        items: [
            { command: 'scimax.ob.clearResults', title: 'Clear Results', category: 'Edit' },
            { command: 'scimax.ob.clearAllResults', title: 'Clear All Results', category: 'Edit' },
            { command: 'scimax.ob.toggleResults', title: 'Toggle Results', category: 'View' },
            { command: 'scimax.ob.jumpToBlock', title: 'Jump to Source Block', category: 'Navigate' },
        ]
    };
}

function getBibtexHelp(): ContextHelp {
    return {
        context: 'BibTeX',
        icon: '$(book)',
        description: 'Bibliography file',
        items: [
            // Entry management
            { command: 'scimax.ref.newEntry', title: 'New Entry', category: 'Entry' },
            { command: 'scimax.ref.cleanEntry', title: 'Clean Entry', keybinding: 'C-c C-c', category: 'Entry' },
            { command: 'scimax.ref.sortEntries', title: 'Sort Entries', category: 'Entry' },
            { command: 'scimax.ref.validateBib', title: 'Validate Bibliography', category: 'Entry' },

            // Open/View
            { command: 'scimax.ref.openPdf', title: 'Open PDF', category: 'Open' },
            { command: 'scimax.ref.openUrl', title: 'Open URL', category: 'Open' },
            { command: 'scimax.ref.openDoi', title: 'Open DOI', category: 'Open' },
            { command: 'scimax.ref.openNotes', title: 'Open Notes', category: 'Open' },

            // Search/Fetch
            { command: 'scimax.ref.searchCrossref', title: 'Search Crossref', category: 'Search' },
            { command: 'scimax.ref.fetchDoi', title: 'Fetch from DOI', category: 'Search' },
            { command: 'scimax.ref.googleScholar', title: 'Search Google Scholar', category: 'Search' },

            // Copy
            { command: 'scimax.ref.copyKey', title: 'Copy Citation Key', category: 'Copy' },
            { command: 'scimax.ref.copyFormatted', title: 'Copy Formatted Citation', category: 'Copy' },

            // Navigate
            { command: 'scimax.ref.nextEntry', title: 'Next Entry', category: 'Navigate' },
            { command: 'scimax.ref.previousEntry', title: 'Previous Entry', category: 'Navigate' },
        ]
    };
}

function getMarkdownHelp(): ContextHelp {
    return {
        context: 'Markdown',
        icon: '$(markdown)',
        description: 'Markdown file',
        items: [
            // Structure
            { command: 'scimax.org.gotoHeading', title: 'Go to Heading', keybinding: 'C-c C-j', category: 'Navigate' },

            // Insert
            { command: 'scimax.org.insertLink', title: 'Insert Link', keybinding: 'C-c C-l', category: 'Insert' },
            { command: 'scimax.ob.insertBlockBelow', title: 'Insert Code Block', keybinding: 'C-c C-,', category: 'Insert' },

            // Markup
            { command: 'scimax.org.bold', title: 'Bold', keybinding: 'C-c C-x C-b', category: 'Markup' },
            { command: 'scimax.org.italic', title: 'Italic', keybinding: 'C-c C-x C-i', category: 'Markup' },
            { command: 'scimax.org.code', title: 'Code', keybinding: 'C-c C-x C-c', category: 'Markup' },

            // Preview
            { command: 'markdown.showPreview', title: 'Open Preview', keybinding: 'C-S-v', category: 'Preview' },
            { command: 'markdown.showPreviewToSide', title: 'Preview to Side', keybinding: 'C-k v', category: 'Preview' },

            // Export
            { command: 'scimax.export.html', title: 'Export to HTML', category: 'Export' },
            { command: 'scimax.export.pdf', title: 'Export to PDF', category: 'Export' },

            // Search
            { command: 'scimax.db.search', title: 'Search Database', category: 'Search' },
        ]
    };
}

function getGeneralHelp(): ContextHelp {
    return {
        context: 'General',
        icon: '$(file)',
        description: 'Org mode commands',
        items: [
            // Navigation
            { command: 'scimax.org.gotoHeading', title: 'Go to Heading', keybinding: 'C-c C-j', category: 'Navigate' },
            { command: 'scimax.org.nextHeading', title: 'Next Heading', keybinding: 'C-c C-n', category: 'Navigate' },
            { command: 'scimax.org.previousHeading', title: 'Previous Heading', keybinding: 'C-c C-p', category: 'Navigate' },

            // Insert
            { command: 'scimax.org.insertHeading', title: 'Insert Heading', keybinding: 'C-Enter', category: 'Insert' },
            { command: 'scimax.org.insertLink', title: 'Insert Link', keybinding: 'C-c C-l', category: 'Insert' },
            { command: 'scimax.org.insertTimestamp', title: 'Insert Timestamp', keybinding: 'C-c .', category: 'Insert' },
            { command: 'scimax.ob.insertBlockBelow', title: 'Insert Source Block', keybinding: 'C-c C-,', category: 'Insert' },

            // Markup
            { command: 'scimax.org.bold', title: 'Bold', keybinding: 'C-c C-x C-b', category: 'Markup' },
            { command: 'scimax.org.italic', title: 'Italic', keybinding: 'C-c C-x C-i', category: 'Markup' },
            { command: 'scimax.org.code', title: 'Code', keybinding: 'C-c C-x C-c', category: 'Markup' },
            { command: 'scimax.org.underline', title: 'Underline', keybinding: 'C-c C-x C-u', category: 'Markup' },

            // Export
            { command: 'scimax.export.dispatch', title: 'Export Dispatcher', keybinding: 'C-c C-e', category: 'Export' },
            { command: 'scimax.export.html', title: 'Export to HTML', category: 'Export' },
            { command: 'scimax.export.pdf', title: 'Export to PDF', category: 'Export' },

            // Search
            { command: 'scimax.db.search', title: 'Search Database', category: 'Search' },
            { command: 'scimax.db.searchSemantic', title: 'Semantic Search', category: 'Search' },

            // Agenda
            { command: 'scimax.agenda.menu', title: 'Agenda Menu', keybinding: 'C-c a', category: 'Agenda' },
        ]
    };
}

// =============================================================================
// Quick Pick UI
// =============================================================================

interface ContextQuickPickItem extends vscode.QuickPickItem {
    command?: string;
}

export async function showContextHelp(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('No active editor');
        return;
    }

    const context = detectContext(editor);
    const help = getContextHelp(context);

    // Build quick pick items
    const items: ContextQuickPickItem[] = [];

    // Group items by category
    const categories = new Map<string, ContextHelpItem[]>();
    for (const item of help.items) {
        const category = item.category || 'Other';
        if (!categories.has(category)) {
            categories.set(category, []);
        }
        categories.get(category)!.push(item);
    }

    // Add items with category separators
    for (const [category, categoryItems] of categories) {
        items.push({
            label: category,
            kind: vscode.QuickPickItemKind.Separator,
        });

        for (const item of categoryItems) {
            items.push({
                label: `$(arrow-right) ${item.title}`,
                description: item.keybinding || '',
                detail: item.description,
                command: item.command,
            });
        }
    }

    // Show quick pick
    const selected = await vscode.window.showQuickPick(items, {
        title: `${help.icon} ${help.context}: ${help.description}`,
        placeHolder: 'Select a command to execute',
        matchOnDescription: true,
        matchOnDetail: true,
    });

    if (selected?.command) {
        vscode.commands.executeCommand(selected.command);
    }
}

// =============================================================================
// Registration
// =============================================================================

export function registerContextHelp(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.contextHelp', showContextHelp)
    );
}
