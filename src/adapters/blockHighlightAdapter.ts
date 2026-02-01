/**
 * Block Highlight Adapter
 *
 * Registry for custom syntax highlighting and decoration of special blocks.
 * This allows external extensions to define how custom block types should be
 * visually styled in the editor.
 *
 * Two types of highlighting:
 * 1. Block decorations (background color) - applied per-line via blockDecorations.ts
 * 2. Content highlighting (syntax) - requires TextMate grammar patterns
 *
 * For content syntax highlighting, blocks must be defined in the TextMate grammar
 * (syntaxes/org.tmLanguage.json). This adapter handles decoration colors only.
 *
 * @example
 * ```typescript
 * // Register custom decoration for a block type
 * const disposable = registerBlockHighlight({
 *     blockType: 'myblock',
 *     backgroundColor: '#fff3cd',  // Light yellow
 *     headerColor: '#856404',      // Dark yellow for #+BEGIN/END lines
 * });
 * ```
 */

import * as vscode from 'vscode';

// =============================================================================
// Types
// =============================================================================

/**
 * Highlight configuration for a block type
 */
export interface BlockHighlightConfig {
    /** Block type name (case-insensitive, e.g., 'sidebar') */
    blockType: string;

    /** Background color for the block body (hex or CSS color) */
    backgroundColor?: string;

    /** Background color for the #+BEGIN/#+END lines */
    headerColor?: string;

    /** Border color (left border for visual distinction) */
    borderColor?: string;

    /** Whether to use italic text */
    italic?: boolean;

    /** Optional icon to show in gutter (VS Code icon name) */
    gutterIcon?: string;
}

// =============================================================================
// Registry
// =============================================================================

/**
 * Registry for block highlight configurations
 */
class BlockHighlightRegistry {
    private configs: Map<string, BlockHighlightConfig> = new Map();
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    /**
     * Register a block highlight configuration
     */
    register(config: BlockHighlightConfig): void {
        if (!config.blockType || typeof config.blockType !== 'string') {
            throw new Error('Block highlight config must specify a blockType');
        }
        this.configs.set(config.blockType.toLowerCase(), config);
        this._onDidChange.fire();
    }

    /**
     * Unregister a block highlight configuration
     */
    unregister(blockType: string): boolean {
        const result = this.configs.delete(blockType.toLowerCase());
        if (result) {
            this._onDidChange.fire();
        }
        return result;
    }

    /**
     * Get highlight configuration for a block type
     */
    getConfig(blockType: string): BlockHighlightConfig | undefined {
        return this.configs.get(blockType.toLowerCase());
    }

    /**
     * Check if a block type has custom highlighting
     */
    hasConfig(blockType: string): boolean {
        return this.configs.has(blockType.toLowerCase());
    }

    /**
     * Get all registered block types
     */
    getBlockTypes(): string[] {
        return Array.from(this.configs.keys());
    }

    /**
     * Get all configurations
     */
    getAllConfigs(): BlockHighlightConfig[] {
        return Array.from(this.configs.values());
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}

// Global registry instance
export const blockHighlightRegistry = new BlockHighlightRegistry();

// =============================================================================
// VS Code Integration
// =============================================================================

/**
 * Register a block highlight configuration with VS Code Disposable support
 */
export function registerBlockHighlight(config: BlockHighlightConfig): vscode.Disposable {
    blockHighlightRegistry.register(config);
    return new vscode.Disposable(() => {
        blockHighlightRegistry.unregister(config.blockType);
    });
}

// =============================================================================
// Built-in Highlight Configs
// =============================================================================

/** Warning block - yellow/orange theme */
export const warningHighlightConfig: BlockHighlightConfig = {
    blockType: 'warning',
    backgroundColor: 'rgba(255, 243, 205, 0.3)',  // Light yellow
    headerColor: 'rgba(255, 193, 7, 0.2)',        // Yellow header
    borderColor: '#ffc107',
};

/** Note block - blue theme */
export const noteHighlightConfig: BlockHighlightConfig = {
    blockType: 'note',
    backgroundColor: 'rgba(209, 236, 241, 0.3)',  // Light blue
    headerColor: 'rgba(23, 162, 184, 0.2)',       // Blue header
    borderColor: '#17a2b8',
};

/** Tip block - green theme */
export const tipHighlightConfig: BlockHighlightConfig = {
    blockType: 'tip',
    backgroundColor: 'rgba(212, 237, 218, 0.3)',  // Light green
    headerColor: 'rgba(40, 167, 69, 0.2)',        // Green header
    borderColor: '#28a745',
};

/** Important block - red theme */
export const importantHighlightConfig: BlockHighlightConfig = {
    blockType: 'important',
    backgroundColor: 'rgba(248, 215, 218, 0.3)',  // Light red
    headerColor: 'rgba(220, 53, 69, 0.2)',        // Red header
    borderColor: '#dc3545',
};

/** Caution block - orange theme */
export const cautionHighlightConfig: BlockHighlightConfig = {
    blockType: 'caution',
    backgroundColor: 'rgba(255, 229, 208, 0.3)',  // Light orange
    headerColor: 'rgba(253, 126, 20, 0.2)',       // Orange header
    borderColor: '#fd7e14',
};

/** Sidebar block - gray theme */
export const sidebarHighlightConfig: BlockHighlightConfig = {
    blockType: 'sidebar',
    backgroundColor: 'rgba(233, 236, 239, 0.3)',  // Light gray
    headerColor: 'rgba(108, 117, 125, 0.2)',      // Gray header
    borderColor: '#6c757d',
    italic: true,
};

/** Details block - purple theme */
export const detailsHighlightConfig: BlockHighlightConfig = {
    blockType: 'details',
    backgroundColor: 'rgba(232, 222, 248, 0.3)',  // Light purple
    headerColor: 'rgba(111, 66, 193, 0.2)',       // Purple header
    borderColor: '#6f42c1',
};

// =============================================================================
// Registration
// =============================================================================

/**
 * Register built-in block highlight configurations
 */
export function registerBuiltinBlockHighlights(): vscode.Disposable[] {
    return [
        registerBlockHighlight(warningHighlightConfig),
        registerBlockHighlight(noteHighlightConfig),
        registerBlockHighlight(tipHighlightConfig),
        registerBlockHighlight(importantHighlightConfig),
        registerBlockHighlight(cautionHighlightConfig),
        registerBlockHighlight(sidebarHighlightConfig),
        registerBlockHighlight(detailsHighlightConfig),
    ];
}

// =============================================================================
// Exports
// =============================================================================

export { BlockHighlightRegistry };
