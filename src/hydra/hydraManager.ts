/**
 * HydraManager - Core manager for the hydra/transient menu system
 *
 * Provides registration, display, and execution of modal keyboard-driven menus.
 */

import * as vscode from 'vscode';
import {
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
} from './types';

export class HydraManager {
    private registry: HydraMenuRegistry = {};
    private state: HydraState = {
        activeMenuId: null,
        menuStack: [],
        context: {},
        isVisible: false,
    };
    private config: HydraConfig;
    private quickPick: vscode.QuickPick<HydraQuickPickItem> | null = null;
    private keyBuffer: string = '';
    private keyBufferTimeout: NodeJS.Timeout | null = null;

    private readonly _onStateChange = new vscode.EventEmitter<HydraStateChangeEvent>();
    public readonly onStateChange = this._onStateChange.event;

    constructor(private context: vscode.ExtensionContext) {
        this.config = this.loadConfig();

        // Listen for config changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('scimax.hydra')) {
                    this.config = this.loadConfig();
                }
            })
        );
    }

    private loadConfig(): HydraConfig {
        const config = vscode.workspace.getConfiguration('scimax.hydra');
        return {
            showKeyHints: config.get('showKeyHints', true),
            singleKeySelection: config.get('singleKeySelection', true),
            dimNonMatching: config.get('dimNonMatching', true),
            sortByKey: config.get('sortByKey', false),
        };
    }

    /**
     * Register a menu definition
     */
    public registerMenu(menu: HydraMenuDefinition): void {
        this.registry[menu.id] = menu;
    }

    /**
     * Register multiple menus at once
     */
    public registerMenus(menus: HydraMenuDefinition[]): void {
        for (const menu of menus) {
            this.registerMenu(menu);
        }
    }

    /**
     * Unregister a menu
     */
    public unregisterMenu(menuId: string): void {
        delete this.registry[menuId];
    }

    /**
     * Get a registered menu by ID
     */
    public getMenu(menuId: string): HydraMenuDefinition | undefined {
        return this.registry[menuId];
    }

    /**
     * Get all registered menu IDs
     */
    public getMenuIds(): string[] {
        return Object.keys(this.registry);
    }

    /**
     * Show a hydra menu
     */
    public async show(menuId: string, options: HydraShowOptions = {}): Promise<void> {
        const menu = this.registry[menuId];
        if (!menu) {
            vscode.window.showErrorMessage(`Hydra menu not found: ${menuId}`);
            return;
        }

        // Update state
        const previousState = { ...this.state };
        if (options.parentMenuId) {
            this.state.menuStack.push(options.parentMenuId);
        }
        this.state.activeMenuId = menuId;
        this.state.context = { ...this.state.context, ...options.context };
        this.state.isVisible = true;

        this._onStateChange.fire({
            previousState,
            newState: { ...this.state },
            reason: 'show',
        });

        // Call onShow hook
        if (menu.onShow) {
            await menu.onShow();
        }

        // Build and show the quick pick
        await this.showQuickPick(menu, options);
    }

    /**
     * Hide the current menu
     */
    public hide(): void {
        if (this.quickPick) {
            this.quickPick.hide();
            this.quickPick.dispose();
            this.quickPick = null;
        }

        const previousState = { ...this.state };
        this.state.activeMenuId = null;
        this.state.menuStack = [];
        this.state.isVisible = false;

        this._onStateChange.fire({
            previousState,
            newState: { ...this.state },
            reason: 'hide',
        });
    }

    /**
     * Navigate back to parent menu
     */
    public async back(): Promise<void> {
        if (this.state.menuStack.length === 0) {
            this.hide();
            return;
        }

        const parentId = this.state.menuStack.pop()!;
        const previousState = { ...this.state };

        this._onStateChange.fire({
            previousState,
            newState: { ...this.state },
            reason: 'navigate',
        });

        // Close current and show parent
        if (this.quickPick) {
            this.quickPick.hide();
            this.quickPick.dispose();
            this.quickPick = null;
        }

        await this.show(parentId);
    }

    /**
     * Navigate to a submenu
     */
    public async navigateToSubmenu(submenuId: string): Promise<void> {
        const currentMenuId = this.state.activeMenuId;

        // Close current menu
        if (this.quickPick) {
            this.quickPick.hide();
            this.quickPick.dispose();
            this.quickPick = null;
        }

        // Show submenu with current menu as parent
        await this.show(submenuId, {
            parentMenuId: currentMenuId || undefined,
        });
    }

    private async showQuickPick(
        menu: HydraMenuDefinition,
        options: HydraShowOptions
    ): Promise<void> {
        // Dispose any existing quick pick
        if (this.quickPick) {
            this.quickPick.dispose();
        }

        this.quickPick = vscode.window.createQuickPick<HydraQuickPickItem>();
        this.quickPick.title = options.title || menu.title;
        this.quickPick.placeholder = menu.hint || 'Press a key to select an action';
        this.quickPick.matchOnDescription = true;
        this.quickPick.matchOnDetail = true;

        // Build items from menu definition
        const items = await this.buildQuickPickItems(menu);
        this.quickPick.items = items;

        // Reset key buffer
        this.keyBuffer = '';

        // Handle keyboard input for single-key selection
        if (this.config.singleKeySelection) {
            this.quickPick.onDidChangeValue(async (value) => {
                if (!value) {
                    this.keyBuffer = '';
                    return;
                }

                // Check if the typed key matches any item
                const key = value.toLowerCase();
                const matchingItem = items.find(
                    (item) => item.menuItem.key.toLowerCase() === key
                );

                if (matchingItem) {
                    // Clear the input and execute
                    this.quickPick!.value = '';
                    await this.executeItem(matchingItem.menuItem, menu);
                } else {
                    // Let the filter work normally
                    this.keyBuffer = value;
                }
            });
        }

        // Handle selection via Enter or click
        this.quickPick.onDidAccept(async () => {
            const selected = this.quickPick?.selectedItems[0];
            if (selected) {
                await this.executeItem(selected.menuItem, menu);
            }
        });

        // Handle hide (Escape key or clicking outside)
        // If there's a parent menu, go back instead of closing
        this.quickPick.onDidHide(async () => {
            if (menu.onHide) {
                await menu.onHide();
            }

            if (this.quickPick) {
                this.quickPick.dispose();
                this.quickPick = null;
            }

            // Check if we should go back to parent instead of closing
            const hasParent = menu.parent || this.state.menuStack.length > 0;
            if (hasParent) {
                // Go back to parent menu
                await this.back();
                return;
            }

            const previousState = { ...this.state };
            this.state.activeMenuId = null;
            this.state.isVisible = false;

            this._onStateChange.fire({
                previousState,
                newState: { ...this.state },
                reason: 'hide',
            });
        });

        this.quickPick.show();
    }

    private async buildQuickPickItems(menu: HydraMenuDefinition): Promise<HydraQuickPickItem[]> {
        const items: HydraQuickPickItem[] = [];

        // Add back item if there's a parent
        if ((menu.parent || this.state.menuStack.length > 0) && menu.showBack !== false) {
            items.push({
                label: '$(arrow-left) Back',
                description: '',
                keyDisplay: '.',
                menuItem: {
                    key: '.',
                    label: 'Back',
                    exit: 'exit',
                    action: async () => {
                        await this.back();
                    },
                },
            });
        }

        for (const group of menu.groups) {
            // Check group visibility
            if (group.when && !group.when()) {
                continue;
            }

            // Add separator with group title if present
            if (group.title && items.length > 0) {
                items.push({
                    label: group.title,
                    kind: vscode.QuickPickItemKind.Separator,
                    keyDisplay: '',
                    menuItem: {
                        key: '',
                        label: group.title,
                        exit: 'exit',
                        action: '',
                    },
                });
            }

            for (const item of group.items) {
                // Check item visibility
                if (item.when && !item.when()) {
                    continue;
                }

                const quickPickItem = await this.menuItemToQuickPickItem(item);
                items.push(quickPickItem);
            }
        }

        // Sort by key if configured
        if (this.config.sortByKey) {
            items.sort((a, b) => {
                if (a.kind === vscode.QuickPickItemKind.Separator) return -1;
                if (b.kind === vscode.QuickPickItemKind.Separator) return 1;
                return a.menuItem.key.localeCompare(b.menuItem.key);
            });
        }

        return items;
    }

    private async menuItemToQuickPickItem(item: HydraMenuItem): Promise<HydraQuickPickItem> {
        const icon = item.icon ? `$(${item.icon}) ` : '';
        const keyHint = this.config.showKeyHints ? `[${item.key}] ` : '';

        // Handle toggle state
        let toggleIndicator = '';
        if (item.isToggle && item.getToggleState) {
            const isOn = await item.getToggleState();
            toggleIndicator = isOn ? ' $(check)' : ' $(circle-outline)';
        }

        // Exit behavior indicator
        let exitIndicator = '';
        if (item.exit === 'stay') {
            exitIndicator = ' $(sync)';
        } else if (item.exit === 'exit') {
            exitIndicator = ' $(sign-out)';
        }
        // submenus already have $(chevron-right) via their icon

        return {
            label: `${icon}${keyHint}${item.label}${toggleIndicator}${exitIndicator}`,
            description: item.description,
            keyDisplay: item.key,
            menuItem: item,
        };
    }

    private async executeItem(item: HydraMenuItem, menu: HydraMenuDefinition): Promise<void> {
        const previousState = { ...this.state };

        // Handle different exit behaviors
        if (item.exit === 'submenu') {
            // Navigate to submenu
            if (typeof item.action === 'string') {
                await this.navigateToSubmenu(item.action);
            }
            return;
        }

        if (item.exit === 'exit') {
            // Close menu before executing
            this.hide();
        }

        // Execute the action
        try {
            if (typeof item.action === 'function') {
                await item.action();
            } else if (typeof item.action === 'string') {
                await vscode.commands.executeCommand(item.action, ...(item.args || []));
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Error executing action: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        // If staying in menu, refresh items (for toggles, etc.)
        if (item.exit === 'stay' && this.quickPick && this.state.activeMenuId) {
            const currentMenu = this.registry[this.state.activeMenuId];
            if (currentMenu) {
                this.quickPick.items = await this.buildQuickPickItems(currentMenu);
            }
        }

        this._onStateChange.fire({
            previousState,
            newState: { ...this.state },
            reason: 'action',
        });
    }

    /**
     * Create a menu builder for fluent API
     */
    public createMenuBuilder(id: string): HydraMenuBuilder {
        return new MenuBuilder(id);
    }

    /**
     * Get current state
     */
    public getState(): Readonly<HydraState> {
        return { ...this.state };
    }

    /**
     * Check if a menu is currently visible
     */
    public isMenuVisible(): boolean {
        return this.state.isVisible;
    }

    public dispose(): void {
        this.hide();
        this._onStateChange.dispose();
    }
}

/**
 * Fluent builder for creating menu definitions
 */
class MenuBuilder implements HydraMenuBuilder {
    private menu: HydraMenuDefinition;
    private currentGroup: HydraMenuGroup;

    constructor(id: string) {
        this.currentGroup = { items: [] };
        this.menu = {
            id,
            title: id,
            groups: [this.currentGroup],
        };
    }

    title(title: string): HydraMenuBuilder {
        this.menu.title = title;
        return this;
    }

    hint(hint: string): HydraMenuBuilder {
        this.menu.hint = hint;
        return this;
    }

    group(title: string | undefined, items: HydraMenuItem[]): HydraMenuBuilder {
        this.currentGroup = { title, items };
        this.menu.groups.push(this.currentGroup);
        return this;
    }

    item(item: HydraMenuItem): HydraMenuBuilder {
        this.currentGroup.items.push(item);
        return this;
    }

    command(key: string, label: string, command: string, args?: unknown[]): HydraMenuBuilder {
        this.currentGroup.items.push({
            key,
            label,
            exit: 'exit',
            action: command,
            args,
        });
        return this;
    }

    persistentCommand(key: string, label: string, command: string, args?: unknown[]): HydraMenuBuilder {
        this.currentGroup.items.push({
            key,
            label,
            exit: 'stay',
            action: command,
            args,
        });
        return this;
    }

    submenu(key: string, label: string, menuId: string): HydraMenuBuilder {
        this.currentGroup.items.push({
            key,
            label,
            icon: 'chevron-right',
            exit: 'submenu',
            action: menuId,
        });
        return this;
    }

    parent(menuId: string): HydraMenuBuilder {
        this.menu.parent = menuId;
        return this;
    }

    build(): HydraMenuDefinition {
        // Filter out empty groups
        this.menu.groups = this.menu.groups.filter((g) => g.items.length > 0);
        return this.menu;
    }
}
