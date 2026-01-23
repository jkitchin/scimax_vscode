/**
 * Help Commands - Register help system commands
 */

import * as vscode from 'vscode';
import { HelpSystem } from './describeKey';

let helpSystem: HelpSystem | undefined;

/**
 * Register all help commands
 */
export function registerHelpCommands(context: vscode.ExtensionContext): void {
    // Create help system instance
    helpSystem = new HelpSystem(context);

    // C-h k: Describe Key
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.help.describeKey', async () => {
            if (helpSystem) {
                await helpSystem.describeKey();
            }
        })
    );

    // C-h b: List Keybindings
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.help.listKeybindings', async () => {
            if (helpSystem) {
                await helpSystem.listKeybindings();
            }
        })
    );

    // C-h f: Describe Command
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.help.describeCommand', async () => {
            if (helpSystem) {
                await helpSystem.describeCommand();
            }
        })
    );

    // C-h v: Describe Variable/Setting
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.help.describeVariable', async () => {
            if (helpSystem) {
                await helpSystem.describeVariable();
            }
        })
    );

    // C-h a: Apropos (Search Documentation)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.help.apropos', async () => {
            if (helpSystem) {
                await helpSystem.apropos();
            }
        })
    );
}

/**
 * Get the help system instance
 */
export function getHelpSystem(): HelpSystem | undefined {
    return helpSystem;
}
