/**
 * Hydra Menu Framework
 *
 * A modal keyboard-driven menu system inspired by Emacs hydra/transient.
 * Provides declarative menu definitions with keyboard shortcuts and hierarchical navigation.
 *
 * Usage:
 *
 * ```typescript
 * import { HydraManager, registerHydraCommands, scimaxMenus } from './hydra';
 *
 * // In extension.ts activate():
 * const hydraManager = new HydraManager(context);
 * hydraManager.registerMenus(scimaxMenus);
 * registerHydraCommands(context, hydraManager);
 *
 * // Show a menu:
 * await vscode.commands.executeCommand('scimax.hydra.show', 'scimax.main');
 * ```
 *
 * Creating custom menus:
 *
 * ```typescript
 * const myMenu: HydraMenuDefinition = {
 *     id: 'my.menu',
 *     title: 'My Menu',
 *     groups: [{
 *         items: [
 *             { key: 'a', label: 'Action A', exit: 'exit', action: 'my.command.a' },
 *             { key: 'b', label: 'Action B', exit: 'stay', action: 'my.command.b' },
 *             { key: 's', label: 'Submenu', exit: 'submenu', action: 'my.submenu' },
 *         ]
 *     }]
 * };
 *
 * hydraManager.registerMenu(myMenu);
 * ```
 *
 * Using the fluent builder:
 *
 * ```typescript
 * const menu = hydraManager.createMenuBuilder('my.menu')
 *     .title('My Menu')
 *     .command('a', 'Action A', 'my.command.a')
 *     .persistentCommand('b', 'Action B (stay open)', 'my.command.b')
 *     .submenu('s', 'Submenu', 'my.submenu')
 *     .build();
 *
 * hydraManager.registerMenu(menu);
 * ```
 */

// Core types
export type {
    HydraMenuDefinition,
    HydraMenuItem,
    HydraMenuGroup,
    HydraMenuRegistry,
    HydraShowOptions,
    HydraQuickPickItem,
    HydraState,
    HydraStateChangeEvent,
    HydraConfig,
    HydraMenuBuilder,
    HydraExitBehavior,
} from './types';

// Manager
export { HydraManager } from './hydraManager';

// Commands
export { registerHydraCommands } from './commands';

// Pre-built menus
export {
    scimaxMenus,
    mainMenu,
    journalMenu,
    referencesMenu,
    notebookMenu,
    projectileMenu,
    searchMenu,
    jumpMenu,
    databaseMenu,
    exportMenu,
    htmlExportMenu,
    latexExportMenu,
    markdownExportMenu,
    exportMenus,
} from './menus';
