/**
 * Fuzzy Quick Pick Utility
 *
 * Provides a quick pick with fuzzy matching that splits the query by spaces
 * and matches each part independently (AND logic).
 *
 * Example: "agile dig" matches "Agile synthesis...diglycolamides..."
 */

import * as vscode from 'vscode';

/**
 * Item for fuzzy quick pick - extends QuickPickItem with searchable text
 */
export interface FuzzyQuickPickItem<T = unknown> extends vscode.QuickPickItem {
    /** The data associated with this item */
    data: T;
    /**
     * Text to search against (should be lowercase).
     * If not provided, will be generated from label + description + detail.
     */
    searchText?: string;
}

/**
 * Options for fuzzy quick pick
 */
export interface FuzzyQuickPickOptions {
    /** Placeholder text shown in the input */
    placeholder?: string;
    /** Title shown at the top of the quick pick */
    title?: string;
    /** Whether to allow selecting multiple items */
    canPickMany?: boolean;
    /** Whether the quick pick should stay open after losing focus */
    ignoreFocusOut?: boolean;
}

/**
 * Prepare search text for an item by combining label, description, and detail
 */
export function prepareSearchText(item: vscode.QuickPickItem, additionalText?: string): string {
    const parts = [
        item.label,
        item.description,
        item.detail,
        additionalText
    ].filter(Boolean);
    return parts.join(' ').toLowerCase();
}

/**
 * Fuzzy filter function: split query by spaces, all parts must match
 */
export function fuzzyFilter<T extends FuzzyQuickPickItem>(
    items: T[],
    query: string
): T[] {
    if (!query.trim()) return items;

    const parts = query.toLowerCase().split(/\s+/).filter(p => p.length > 0);

    return items
        .filter(item => {
            const searchText = item.searchText || prepareSearchText(item);
            return parts.every(part => searchText.includes(part));
        })
        .map(item => ({ ...item, alwaysShow: true })); // Bypass VS Code's filtering
}

/**
 * Show a quick pick with fuzzy matching
 *
 * @param items - Items to show in the quick pick
 * @param options - Quick pick options
 * @returns The selected item, or undefined if cancelled
 *
 * @example
 * ```typescript
 * const items = entries.map(entry => ({
 *     label: entry.name,
 *     description: entry.author,
 *     detail: entry.title,
 *     data: entry,
 *     searchText: `${entry.name} ${entry.author} ${entry.title}`.toLowerCase()
 * }));
 *
 * const selected = await showFuzzyQuickPick(items, {
 *     placeholder: 'Search entries (space-separated terms)...'
 * });
 *
 * if (selected) {
 *     console.log('Selected:', selected.data);
 * }
 * ```
 */
export async function showFuzzyQuickPick<T>(
    items: FuzzyQuickPickItem<T>[],
    options: FuzzyQuickPickOptions = {}
): Promise<FuzzyQuickPickItem<T> | undefined> {
    const quickPick = vscode.window.createQuickPick<FuzzyQuickPickItem<T>>();

    quickPick.placeholder = options.placeholder || 'Type to filter (space-separated terms)...';
    if (options.title) quickPick.title = options.title;
    quickPick.canSelectMany = options.canPickMany || false;
    quickPick.ignoreFocusOut = options.ignoreFocusOut || false;

    // Disable VS Code's built-in filtering - we do our own
    quickPick.matchOnDescription = false;
    quickPick.matchOnDetail = false;

    // Ensure all items have searchText
    const preparedItems = items.map(item => ({
        ...item,
        searchText: item.searchText || prepareSearchText(item)
    }));

    quickPick.items = preparedItems;

    // Custom filtering on value change
    quickPick.onDidChangeValue(value => {
        quickPick.items = fuzzyFilter(preparedItems, value);
    });

    return new Promise<FuzzyQuickPickItem<T> | undefined>(resolve => {
        quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0];
            quickPick.hide();
            resolve(selected);
        });

        quickPick.onDidHide(() => {
            quickPick.dispose();
            resolve(undefined);
        });

        quickPick.show();
    });
}

/**
 * Show a quick pick with fuzzy matching that allows multiple selections
 *
 * @param items - Items to show in the quick pick
 * @param options - Quick pick options
 * @returns The selected items, or undefined if cancelled
 */
export async function showFuzzyQuickPickMany<T>(
    items: FuzzyQuickPickItem<T>[],
    options: FuzzyQuickPickOptions = {}
): Promise<FuzzyQuickPickItem<T>[] | undefined> {
    const quickPick = vscode.window.createQuickPick<FuzzyQuickPickItem<T>>();

    quickPick.placeholder = options.placeholder || 'Type to filter (space-separated terms)...';
    if (options.title) quickPick.title = options.title;
    quickPick.canSelectMany = true;
    quickPick.ignoreFocusOut = options.ignoreFocusOut || false;

    // Disable VS Code's built-in filtering
    quickPick.matchOnDescription = false;
    quickPick.matchOnDetail = false;

    // Ensure all items have searchText
    const preparedItems = items.map(item => ({
        ...item,
        searchText: item.searchText || prepareSearchText(item)
    }));

    quickPick.items = preparedItems;

    // Custom filtering on value change
    quickPick.onDidChangeValue(value => {
        quickPick.items = fuzzyFilter(preparedItems, value);
    });

    return new Promise<FuzzyQuickPickItem<T>[] | undefined>(resolve => {
        quickPick.onDidAccept(() => {
            const selected = [...quickPick.selectedItems];
            quickPick.hide();
            resolve(selected.length > 0 ? selected : undefined);
        });

        quickPick.onDidHide(() => {
            quickPick.dispose();
            resolve(undefined);
        });

        quickPick.show();
    });
}
