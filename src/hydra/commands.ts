/**
 * Hydra Commands - VS Code command registrations for the hydra menu system
 */

import * as vscode from 'vscode';
import { HydraManager } from './hydraManager';
import { HydraShowOptions } from './types';

/**
 * Register all hydra-related commands
 */
export function registerHydraCommands(
    context: vscode.ExtensionContext,
    manager: HydraManager
): void {
    // Show a specific menu by ID
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.hydra.show',
            async (menuId: string, options?: HydraShowOptions) => {
                if (!menuId) {
                    // Show menu picker if no ID provided
                    const menuIds = manager.getMenuIds();
                    if (menuIds.length === 0) {
                        vscode.window.showInformationMessage('No hydra menus registered');
                        return;
                    }

                    const items = menuIds.map((id) => {
                        const menu = manager.getMenu(id);
                        return {
                            label: menu?.title || id,
                            description: id,
                            menuId: id,
                        };
                    });

                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Select a menu to show',
                    });

                    if (selected) {
                        await manager.show(selected.menuId, options);
                    }
                } else {
                    await manager.show(menuId, options);
                }
            }
        )
    );

    // Hide the current menu
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.hydra.hide', () => {
            manager.hide();
        })
    );

    // Navigate back in menu hierarchy
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.hydra.back', async () => {
            await manager.back();
        })
    );

    // Toggle menu visibility
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.hydra.toggle', async (menuId: string) => {
            if (manager.isMenuVisible()) {
                manager.hide();
            } else if (menuId) {
                await manager.show(menuId);
            }
        })
    );

    // Show the main menu (scimax.main if registered)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.hydra.main', async () => {
            const mainMenu = manager.getMenu('scimax.main');
            if (mainMenu) {
                await manager.show('scimax.main');
            } else {
                // Fall back to menu picker
                await vscode.commands.executeCommand('scimax.hydra.show');
            }
        })
    );

    // Show the database menu
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.hydra.database', async () => {
            const dbMenu = manager.getMenu('scimax.database');
            if (dbMenu) {
                await manager.show('scimax.database');
            } else {
                vscode.window.showWarningMessage('Database menu not registered');
            }
        })
    );

    // Show context-aware menu based on current file type
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.hydra.contextMenu', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                await vscode.commands.executeCommand('scimax.hydra.main');
                return;
            }

            const languageId = editor.document.languageId;
            const contextMenuId = `scimax.${languageId}`;

            // Try language-specific menu first
            if (manager.getMenu(contextMenuId)) {
                await manager.show(contextMenuId);
            } else if (manager.getMenu('scimax.main')) {
                await manager.show('scimax.main');
            } else {
                await vscode.commands.executeCommand('scimax.hydra.show');
            }
        })
    );

    // Navigate to a submenu (used internally)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.hydra.submenu', async (submenuId: string) => {
            await manager.navigateToSubmenu(submenuId);
        })
    );
}
