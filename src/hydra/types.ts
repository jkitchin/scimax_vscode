/**
 * Hydra/Transient Menu Framework Types
 *
 * Inspired by Emacs hydra and transient packages, this provides a modal
 * menu system for VS Code with keyboard-driven navigation.
 */

import * as vscode from 'vscode';

/**
 * Behavior after executing a menu item action
 */
export type HydraExitBehavior =
    | 'exit'      // Close menu after action (blue head in hydra)
    | 'stay'      // Keep menu open after action (red head in hydra)
    | 'submenu';  // Navigate to a submenu

/**
 * A single item in a hydra menu
 */
export interface HydraMenuItem {
    /** Single character key to trigger this item */
    key: string;

    /** Display label for the item */
    label: string;

    /** Optional description shown after the label */
    description?: string;

    /** Icon to display (VS Code codicon name without $()) */
    icon?: string;

    /** What happens after executing this item */
    exit: HydraExitBehavior;

    /**
     * Action to perform. Can be:
     * - A VS Code command string (e.g., 'scimax.journal.today')
     * - A function to execute
     * - A submenu ID (when exit is 'submenu')
     */
    action: string | (() => void | Promise<void>);

    /** Arguments to pass if action is a command string */
    args?: unknown[];

    /** Condition for showing this item */
    when?: () => boolean;

    /** Whether this is a toggle (shows on/off state) */
    isToggle?: boolean;

    /** Function to get toggle state (true = on) */
    getToggleState?: () => boolean | Promise<boolean>;
}

/**
 * A group of related menu items with an optional header
 */
export interface HydraMenuGroup {
    /** Optional group title */
    title?: string;

    /** Items in this group */
    items: HydraMenuItem[];

    /** Condition for showing this group */
    when?: () => boolean;
}

/**
 * Definition of a complete hydra menu
 */
export interface HydraMenuDefinition {
    /** Unique identifier for this menu */
    id: string;

    /** Title displayed at the top of the menu */
    title: string;

    /** Optional hint text shown below the title */
    hint?: string;

    /** Groups of menu items */
    groups: HydraMenuGroup[];

    /** Parent menu ID for back navigation */
    parent?: string;

    /** Whether to show a back option when there's a parent */
    showBack?: boolean;

    /** Custom columns layout (default: auto) */
    columns?: number;

    /** Called when menu is shown */
    onShow?: () => void | Promise<void>;

    /** Called when menu is hidden */
    onHide?: () => void | Promise<void>;
}

/**
 * Registry of all available menus
 */
export interface HydraMenuRegistry {
    [menuId: string]: HydraMenuDefinition;
}

/**
 * Options for showing a hydra menu
 */
export interface HydraShowOptions {
    /** Override the title */
    title?: string;

    /** Context data passed to actions */
    context?: Record<string, unknown>;

    /** Parent menu to return to on back */
    parentMenuId?: string;
}

/**
 * QuickPick item extended with hydra metadata
 */
export interface HydraQuickPickItem extends vscode.QuickPickItem {
    /** The original menu item */
    menuItem: HydraMenuItem;

    /** Formatted key display */
    keyDisplay: string;
}

/**
 * State of the hydra menu system
 */
export interface HydraState {
    /** Currently active menu ID */
    activeMenuId: string | null;

    /** Stack of parent menus for back navigation */
    menuStack: string[];

    /** Current context data */
    context: Record<string, unknown>;

    /** Whether a menu is currently visible */
    isVisible: boolean;
}

/**
 * Event emitted when hydra state changes
 */
export interface HydraStateChangeEvent {
    previousState: HydraState;
    newState: HydraState;
    reason: 'show' | 'hide' | 'navigate' | 'action';
}

/**
 * Configuration options for the hydra system
 */
export interface HydraConfig {
    /** Show key hints inline with labels */
    showKeyHints: boolean;

    /** Use single-key selection (no Enter needed) */
    singleKeySelection: boolean;

    /** Dim items that don't match current filter */
    dimNonMatching: boolean;

    /** Sort items by key or keep definition order */
    sortByKey: boolean;
}

/**
 * Builder interface for creating menus fluently
 */
export interface HydraMenuBuilder {
    /** Set the menu title */
    title(title: string): HydraMenuBuilder;

    /** Set the menu hint */
    hint(hint: string): HydraMenuBuilder;

    /** Add a group of items */
    group(title: string | undefined, items: HydraMenuItem[]): HydraMenuBuilder;

    /** Add a single item */
    item(item: HydraMenuItem): HydraMenuBuilder;

    /** Add a command item (exits menu) */
    command(key: string, label: string, command: string, args?: unknown[]): HydraMenuBuilder;

    /** Add a persistent command item (stays in menu) */
    persistentCommand(key: string, label: string, command: string, args?: unknown[]): HydraMenuBuilder;

    /** Add a submenu link */
    submenu(key: string, label: string, menuId: string): HydraMenuBuilder;

    /** Set the parent menu */
    parent(menuId: string): HydraMenuBuilder;

    /** Build the final menu definition */
    build(): HydraMenuDefinition;
}
