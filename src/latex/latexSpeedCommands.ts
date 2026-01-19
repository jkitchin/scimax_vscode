/**
 * LaTeX Speed Commands
 * Single-key commands when cursor is at the beginning of a section line
 */

import * as vscode from 'vscode';
import { isSectionLine } from './latexNavigation';
import * as navigation from './latexNavigation';
import * as structure from './latexStructure';

// Speed command definitions
interface SpeedCommand {
    key: string;
    description: string;
    action: () => Promise<void> | void;
}

const SPEED_COMMANDS: SpeedCommand[] = [
    // Navigation
    { key: 'n', description: 'Next section', action: navigation.nextSection },
    { key: 'p', description: 'Previous section', action: navigation.previousSection },
    { key: 'f', description: 'Next sibling', action: navigation.nextSiblingSection },
    { key: 'b', description: 'Previous sibling', action: navigation.previousSiblingSection },
    { key: 'u', description: 'Parent section', action: navigation.parentSection },
    { key: 'j', description: 'Jump to section', action: navigation.jumpToSection },
    { key: 'J', description: 'Jump to label', action: navigation.jumpToLabel },
    { key: 'g', description: 'First section', action: navigation.firstSection },
    { key: 'G', description: 'Last section', action: navigation.lastSection },

    // Structure editing
    { key: '<', description: 'Promote section', action: structure.promoteSection },
    { key: '>', description: 'Demote section', action: structure.demoteSection },
    { key: 'L', description: 'Promote subtree', action: structure.promoteSubtree },
    { key: 'R', description: 'Demote subtree', action: structure.demoteSubtree },
    { key: 'U', description: 'Move section up', action: structure.moveSectionUp },
    { key: 'D', description: 'Move section down', action: structure.moveSectionDown },

    // Selection and editing
    { key: 'm', description: 'Mark section', action: structure.markSection },
    { key: 'k', description: 'Kill section', action: structure.killSection },
    { key: 'c', description: 'Clone section', action: structure.cloneSection },
    { key: 'i', description: 'Insert section', action: structure.insertSection },
    { key: 'I', description: 'Insert subsection', action: structure.insertSubsection },

    // Visibility
    { key: 'N', description: 'Narrow to section', action: structure.narrowToSection },
    { key: 'W', description: 'Widen', action: structure.widen },

    // Folding
    {
        key: 'Tab', description: 'Toggle fold', action: async () => {
            await vscode.commands.executeCommand('scimax.org.toggleFold');
        }
    },
    {
        key: 'S-Tab', description: 'Cycle global fold', action: async () => {
            await vscode.commands.executeCommand('scimax.org.cycleGlobalFold');
        }
    },

    // Help
    { key: '?', description: 'Show speed commands', action: showSpeedCommandHelp },
];

// Create a map for fast lookup
const speedCommandMap = new Map<string, SpeedCommand>();
for (const cmd of SPEED_COMMANDS) {
    speedCommandMap.set(cmd.key, cmd);
}

/**
 * Check if cursor is at the beginning of a section line (column 0 or after whitespace only)
 */
function isAtSectionStart(editor: vscode.TextEditor): boolean {
    const position = editor.selection.active;
    const line = editor.document.lineAt(position.line).text;

    // Check if it's a section line
    if (!isSectionLine(line)) {
        return false;
    }

    // Check if cursor is at or before the backslash
    const backslashIndex = line.indexOf('\\');
    return position.character <= backslashIndex;
}

/**
 * Show help for speed commands
 */
async function showSpeedCommandHelp(): Promise<void> {
    const items = SPEED_COMMANDS.map(cmd => ({
        label: cmd.key,
        description: cmd.description
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'LaTeX Speed Commands (press key at section start)',
        matchOnDescription: true
    });

    if (selected) {
        const cmd = speedCommandMap.get(selected.label);
        if (cmd) {
            await cmd.action();
        }
    }
}

/**
 * Handle a potential speed command key press
 * Returns true if the key was handled as a speed command
 */
export async function handleSpeedCommand(key: string): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'latex') {
        return false;
    }

    // Check if we're at the start of a section line
    if (!isAtSectionStart(editor)) {
        return false;
    }

    // Look up the command
    const cmd = speedCommandMap.get(key);
    if (cmd) {
        await cmd.action();
        return true;
    }

    return false;
}

/**
 * Register speed command type handlers
 * This creates "type" command overrides for each speed key
 */
export function registerSpeedCommands(context: vscode.ExtensionContext): void {
    // Register the main speed command dispatcher
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.speedCommand', async (args: { key: string }) => {
            const handled = await handleSpeedCommand(args.key);
            if (!handled) {
                // Insert the character normally
                await vscode.commands.executeCommand('default:type', { text: args.key });
            }
        })
    );

    // Register the help command
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.speedCommandHelp', showSpeedCommandHelp)
    );
}

/**
 * Get all speed command definitions (for documentation)
 */
export function getSpeedCommands(): SpeedCommand[] {
    return [...SPEED_COMMANDS];
}

/**
 * Create a type subscription that intercepts keys for speed commands
 * Note: This is called from extension activation
 */
export function createSpeedCommandTypeSubscription(context: vscode.ExtensionContext): void {
    // We use the 'type' command to intercept single character inputs
    // This only works when the editor has focus

    const typeHandler = vscode.commands.registerCommand('type', async (args: { text: string }) => {
        const editor = vscode.window.activeTextEditor;

        // Only intercept for LaTeX files
        if (editor && editor.document.languageId === 'latex') {
            const text = args.text;

            // Only single character inputs
            if (text.length === 1) {
                const handled = await handleSpeedCommand(text);
                if (handled) {
                    return;
                }
            }
        }

        // Not handled, pass through to default handler
        await vscode.commands.executeCommand('default:type', args);
    });

    context.subscriptions.push(typeHandler);
}

/**
 * Enable or disable speed commands based on configuration
 */
let speedCommandsEnabled = true;
let typeSubscription: vscode.Disposable | null = null;

export function setSpeedCommandsEnabled(enabled: boolean, context: vscode.ExtensionContext): void {
    speedCommandsEnabled = enabled;

    if (enabled && !typeSubscription) {
        // Enable by registering the type handler
        typeSubscription = vscode.commands.registerCommand('type', async (args: { text: string }) => {
            const editor = vscode.window.activeTextEditor;

            if (editor && editor.document.languageId === 'latex' && speedCommandsEnabled) {
                const text = args.text;

                if (text.length === 1) {
                    const handled = await handleSpeedCommand(text);
                    if (handled) {
                        return;
                    }
                }
            }

            await vscode.commands.executeCommand('default:type', args);
        });
        context.subscriptions.push(typeSubscription);
    } else if (!enabled && typeSubscription) {
        // Disable by disposing the type handler
        typeSubscription.dispose();
        typeSubscription = null;
    }
}

export function areSpeedCommandsEnabled(): boolean {
    return speedCommandsEnabled;
}
