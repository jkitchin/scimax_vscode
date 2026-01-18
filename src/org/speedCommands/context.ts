/**
 * Speed Command Context Detection and Registration
 *
 * Detects when cursor is at the beginning (column 0) of a heading line
 * and sets up context for speed command keybindings.
 */

import * as vscode from 'vscode';
import { SPEED_COMMAND_DEFINITIONS, getSpeedCommandsByCategory } from './config';
import * as navigation from './navigation';
import * as planning from './planning';
import * as metadata from './metadata';
import * as visibility from './visibility';
import * as clocking from './clocking';
import * as archive from './archive';
import * as structure from './structure';

/**
 * Check if cursor is at the start of a heading (column 0)
 */
export function isAtHeadingStart(document: vscode.TextDocument, position: vscode.Position): boolean {
    // Must be at column 0
    if (position.character !== 0) return false;

    const line = document.lineAt(position.line).text;

    if (document.languageId === 'org') {
        return /^\*+\s/.test(line);
    } else if (document.languageId === 'markdown') {
        return /^#+\s/.test(line);
    }

    return false;
}

/**
 * Check if cursor is at the start of a source block (column 0 on #+begin_src line)
 */
export function isAtSrcBlockStart(document: vscode.TextDocument, position: vscode.Position): boolean {
    // Must be at column 0
    if (position.character !== 0) return false;

    // Only for org files
    if (document.languageId !== 'org') return false;

    const line = document.lineAt(position.line).text;
    return /^#\+begin_src\s/i.test(line);
}

/**
 * Get heading level from line
 */
export function getHeadingLevel(document: vscode.TextDocument, lineNum: number): number {
    const line = document.lineAt(lineNum).text;

    if (document.languageId === 'org') {
        const match = line.match(/^(\*+)\s/);
        return match ? match[1].length : 0;
    } else if (document.languageId === 'markdown') {
        const match = line.match(/^(#+)\s/);
        return match ? match[1].length : 0;
    }

    return 0;
}

/**
 * Get the range of a subtree (heading + all children)
 */
export function getSubtreeRange(document: vscode.TextDocument, line: number): { startLine: number; endLine: number } {
    const level = getHeadingLevel(document, line);

    if (level === 0) {
        // Not on a heading, find the parent heading
        for (let i = line - 1; i >= 0; i--) {
            if (getHeadingLevel(document, i) > 0) {
                return getSubtreeRange(document, i);
            }
        }
        return { startLine: line, endLine: line };
    }

    let endLine = line;

    // Find end of subtree (next heading at same or higher level, or end of file)
    for (let i = line + 1; i < document.lineCount; i++) {
        const nextLevel = getHeadingLevel(document, i);
        if (nextLevel > 0 && nextLevel <= level) {
            break;
        }
        endLine = i;
    }

    return { startLine: line, endLine };
}

/**
 * Setup speed command context tracking
 */
export function setupSpeedCommandContext(context: vscode.ExtensionContext): void {
    // Check if speed commands are enabled
    const config = vscode.workspace.getConfiguration('scimax.speedCommands');
    const enabled = config.get<boolean>('enabled', true);

    // Set initial context
    vscode.commands.executeCommand('setContext', 'scimax.speedCommandsEnabled', enabled);

    // Track cursor position for atHeadingStart and atSrcBlockStart contexts
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            const editor = e.textEditor;
            const document = editor.document;

            // Only check for org/markdown files
            if (!['org', 'markdown'].includes(document.languageId)) {
                vscode.commands.executeCommand('setContext', 'scimax.atHeadingStart', false);
                vscode.commands.executeCommand('setContext', 'scimax.atSrcBlockStart', false);
                return;
            }

            const position = editor.selection.active;
            const isEmpty = editor.selection.isEmpty;

            const atHeadingStart = isAtHeadingStart(document, position) && isEmpty;
            vscode.commands.executeCommand('setContext', 'scimax.atHeadingStart', atHeadingStart);

            const atSrcBlockStart = isAtSrcBlockStart(document, position) && isEmpty;
            vscode.commands.executeCommand('setContext', 'scimax.atSrcBlockStart', atSrcBlockStart);
        })
    );

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('scimax.speedCommands.enabled')) {
                const newConfig = vscode.workspace.getConfiguration('scimax.speedCommands');
                const newEnabled = newConfig.get<boolean>('enabled', true);
                vscode.commands.executeCommand('setContext', 'scimax.speedCommandsEnabled', newEnabled);
            }
        })
    );
}

/**
 * Show speed commands help
 */
async function showSpeedHelp(): Promise<void> {
    const categories = getSpeedCommandsByCategory();
    const categoryOrder = ['navigation', 'visibility', 'structure', 'todo', 'planning', 'metadata', 'clocking', 'special'];

    const items: vscode.QuickPickItem[] = [];

    for (const category of categoryOrder) {
        const commands = categories.get(category);
        if (!commands) continue;

        // Add category header
        items.push({
            label: category.charAt(0).toUpperCase() + category.slice(1),
            kind: vscode.QuickPickItemKind.Separator
        });

        // Add commands in this category
        for (const cmd of commands) {
            items.push({
                label: cmd.key,
                description: cmd.description
            });
        }
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Speed Commands - Press a key at column 0 of a heading',
        matchOnDescription: true
    });

    if (selected && selected.kind !== vscode.QuickPickItemKind.Separator) {
        const cmd = SPEED_COMMAND_DEFINITIONS.find(c => c.key === selected.label);
        if (cmd) {
            await vscode.commands.executeCommand(cmd.command);
        }
    }
}

/**
 * Show goto submenu
 */
async function showGotoMenu(): Promise<void> {
    const items: (vscode.QuickPickItem & { command: string })[] = [
        { label: 'n', description: 'Next heading', command: 'scimax.org.nextHeading' },
        { label: 'p', description: 'Previous heading', command: 'scimax.org.previousHeading' },
        { label: 'f', description: 'Next sibling', command: 'scimax.speed.nextSibling' },
        { label: 'b', description: 'Previous sibling', command: 'scimax.speed.previousSibling' },
        { label: 'u', description: 'Parent heading', command: 'scimax.org.parentHeading' },
        { label: 'j', description: 'Jump to any heading', command: 'scimax.org.jumpToHeading' },
        { label: '1', description: 'First heading', command: 'scimax.speed.firstHeading' },
        { label: '$', description: 'Last heading', command: 'scimax.speed.lastHeading' },
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Go to...'
    });

    if (selected) {
        await vscode.commands.executeCommand(selected.command);
    }
}

/**
 * Register all speed commands
 */
export function registerSpeedCommands(context: vscode.ExtensionContext): void {
    // Setup context tracking
    setupSpeedCommandContext(context);

    // Navigation commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.speed.nextSibling', navigation.nextSiblingHeading),
        vscode.commands.registerCommand('scimax.speed.previousSibling', navigation.previousSiblingHeading),
        vscode.commands.registerCommand('scimax.speed.firstHeading', navigation.firstHeading),
        vscode.commands.registerCommand('scimax.speed.lastHeading', navigation.lastHeading),
        vscode.commands.registerCommand('scimax.speed.gotoMenu', showGotoMenu)
    );

    // Planning commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.speed.schedule', planning.addSchedule),
        vscode.commands.registerCommand('scimax.speed.deadline', planning.addDeadline)
    );

    // Metadata commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.speed.setTags', metadata.setTags),
        vscode.commands.registerCommand('scimax.speed.setEffort', metadata.setEffort),
        vscode.commands.registerCommand('scimax.speed.setProperty', metadata.setProperty)
    );

    // Priority commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.speed.priorityA', () => metadata.setPriority('A')),
        vscode.commands.registerCommand('scimax.speed.priorityB', () => metadata.setPriority('B')),
        vscode.commands.registerCommand('scimax.speed.priorityC', () => metadata.setPriority('C')),
        vscode.commands.registerCommand('scimax.speed.priorityNone', () => metadata.setPriority(''))
    );

    // Visibility commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.speed.showChildren', visibility.showAllChildren),
        vscode.commands.registerCommand('scimax.speed.overview', visibility.showOverview)
    );

    // Initialize clocking with persistence
    clocking.initializeClocking(context);

    // Clocking commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.speed.clockIn', clocking.clockIn),
        vscode.commands.registerCommand('scimax.speed.clockOut', clocking.clockOut),
        vscode.commands.registerCommand('scimax.clock.in', clocking.clockIn),
        vscode.commands.registerCommand('scimax.clock.out', clocking.clockOut),
        vscode.commands.registerCommand('scimax.clock.goto', clocking.clockGoto),
        vscode.commands.registerCommand('scimax.clock.inLast', clocking.clockInLast),
        vscode.commands.registerCommand('scimax.clock.cancel', clocking.clockCancel),
        vscode.commands.registerCommand('scimax.clock.select', clocking.clockSelect),
        vscode.commands.registerCommand('scimax.clock.menu', clocking.showClockMenu),
        vscode.commands.registerCommand('scimax.clock.clearHistory', clocking.clearClockHistory)
    );

    // Archive commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.speed.archiveSubtree', archive.archiveSubtree),
        vscode.commands.registerCommand('scimax.speed.toggleArchiveTag', archive.toggleArchiveTag),
        vscode.commands.registerCommand('scimax.speed.archiveToSibling', archive.archiveToSibling)
    );

    // Structure commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.speed.yankSubtree', structure.yankSubtree),
        vscode.commands.registerCommand('scimax.speed.narrowToSubtree', structure.narrowToSubtree),
        vscode.commands.registerCommand('scimax.speed.widen', structure.widen)
    );

    // Help command
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.speed.help', showSpeedHelp)
    );

    // Toggle speed commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.speed.toggle', async () => {
            const config = vscode.workspace.getConfiguration('scimax.speedCommands');
            const enabled = config.get<boolean>('enabled', true);
            await config.update('enabled', !enabled, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(
                `Speed commands ${!enabled ? 'enabled' : 'disabled'}`
            );
        })
    );
}
