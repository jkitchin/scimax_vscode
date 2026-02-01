/**
 * Block Export Adapter
 *
 * Registry for custom export handlers for special blocks (#+BEGIN_X...#+END_X).
 * This allows external extensions to define how custom block types render
 * in different export formats (HTML, LaTeX, text).
 *
 * Special blocks are parsed as 'special-block' elements with a blockType property.
 * Any #+BEGIN_foo...#+END_foo becomes a special block with blockType='foo'.
 *
 * @example
 * ```typescript
 * // Register a sidebar block export handler
 * const disposable = registerBlockExport({
 *     blockType: 'sidebar',
 *     export: (content, backend, context) => {
 *         if (backend === 'html') {
 *             return `<aside class="sidebar">${content}</aside>`;
 *         }
 *         if (backend === 'latex') {
 *             return `\\begin{tcolorbox}[title=Note]${content}\\end{tcolorbox}`;
 *         }
 *         return content;
 *     }
 * });
 * ```
 */

import * as vscode from 'vscode';

// =============================================================================
// Types
// =============================================================================

/**
 * Context passed to block export handlers
 */
export interface BlockExportContext {
    /** The block type (e.g., 'sidebar', 'warning') */
    blockType: string;
    /** Parameters from the BEGIN line (e.g., #+BEGIN_sidebar :title "Note") */
    parameters?: string;
    /** Current file path */
    filePath?: string;
    /** Any affiliated keywords (#+NAME:, #+CAPTION:, etc.) */
    affiliated?: {
        name?: string;
        caption?: string;
        [key: string]: string | undefined;
    };
}

/**
 * Handler for exporting a specific block type
 */
export interface BlockExportHandler {
    /** Block type name (case-insensitive, e.g., 'sidebar') */
    blockType: string;

    /** Optional description for documentation */
    description?: string;

    /**
     * Export the block content for a specific backend
     * @param content The processed content inside the block
     * @param backend The export backend ('html', 'latex', 'text')
     * @param context Additional context about the block
     * @returns The exported string, or undefined to use default handling
     */
    export(
        content: string,
        backend: 'html' | 'latex' | 'text',
        context: BlockExportContext
    ): string | undefined;
}

// =============================================================================
// Registry
// =============================================================================

/**
 * Registry for block export handlers
 */
class BlockExportRegistry {
    private handlers: Map<string, BlockExportHandler> = new Map();

    /**
     * Register a block export handler
     * @returns The handler for chaining or reference
     */
    register(handler: BlockExportHandler): BlockExportHandler {
        if (!handler.blockType || typeof handler.blockType !== 'string') {
            throw new Error('Block export handler must specify a blockType');
        }
        if (typeof handler.export !== 'function') {
            throw new Error('Block export handler must implement export()');
        }
        this.handlers.set(handler.blockType.toLowerCase(), handler);
        return handler;
    }

    /**
     * Unregister a block export handler
     */
    unregister(blockType: string): boolean {
        return this.handlers.delete(blockType.toLowerCase());
    }

    /**
     * Get handler for a block type
     */
    getHandler(blockType: string): BlockExportHandler | undefined {
        return this.handlers.get(blockType.toLowerCase());
    }

    /**
     * Check if a block type has a custom handler
     */
    hasHandler(blockType: string): boolean {
        return this.handlers.has(blockType.toLowerCase());
    }

    /**
     * Get all registered block types
     */
    getBlockTypes(): string[] {
        return Array.from(this.handlers.keys());
    }

    /**
     * Export a block using the appropriate handler
     * @returns The exported string, or undefined if no handler or handler returns undefined
     */
    export(
        blockType: string,
        content: string,
        backend: 'html' | 'latex' | 'text',
        context: Omit<BlockExportContext, 'blockType'>
    ): string | undefined {
        const handler = this.getHandler(blockType);
        if (!handler) {
            return undefined;
        }
        return handler.export(content, backend, { ...context, blockType });
    }
}

// Global registry instance
export const blockExportRegistry = new BlockExportRegistry();

// =============================================================================
// VS Code Integration
// =============================================================================

/**
 * Register a block export handler with VS Code Disposable support
 */
export function registerBlockExport(handler: BlockExportHandler): vscode.Disposable {
    blockExportRegistry.register(handler);
    return new vscode.Disposable(() => {
        blockExportRegistry.unregister(handler.blockType);
    });
}

// =============================================================================
// Built-in Block Handlers
// =============================================================================

/**
 * Warning block - renders as an alert/admonition
 */
export const warningBlockHandler: BlockExportHandler = {
    blockType: 'warning',
    description: 'Warning/alert block',
    export(content, backend, context) {
        switch (backend) {
            case 'html':
                return `<div class="org-warning admonition warning">\n<p class="admonition-title">Warning</p>\n${content}</div>`;
            case 'latex':
                return `\\begin{tcolorbox}[colback=yellow!10,colframe=yellow!50!black,title=Warning]\n${content}\\end{tcolorbox}`;
            default:
                return undefined; // Use default
        }
    }
};

/**
 * Note block - renders as an info admonition
 */
export const noteBlockHandler: BlockExportHandler = {
    blockType: 'note',
    description: 'Note/info block',
    export(content, backend, context) {
        switch (backend) {
            case 'html':
                return `<div class="org-note admonition note">\n<p class="admonition-title">Note</p>\n${content}</div>`;
            case 'latex':
                return `\\begin{tcolorbox}[colback=blue!5,colframe=blue!50!black,title=Note]\n${content}\\end{tcolorbox}`;
            default:
                return undefined;
        }
    }
};

/**
 * Tip block - renders as a tip admonition
 */
export const tipBlockHandler: BlockExportHandler = {
    blockType: 'tip',
    description: 'Tip/hint block',
    export(content, backend, context) {
        switch (backend) {
            case 'html':
                return `<div class="org-tip admonition tip">\n<p class="admonition-title">Tip</p>\n${content}</div>`;
            case 'latex':
                return `\\begin{tcolorbox}[colback=green!5,colframe=green!50!black,title=Tip]\n${content}\\end{tcolorbox}`;
            default:
                return undefined;
        }
    }
};

/**
 * Important block - renders as an important admonition
 */
export const importantBlockHandler: BlockExportHandler = {
    blockType: 'important',
    description: 'Important block',
    export(content, backend, context) {
        switch (backend) {
            case 'html':
                return `<div class="org-important admonition important">\n<p class="admonition-title">Important</p>\n${content}</div>`;
            case 'latex':
                return `\\begin{tcolorbox}[colback=red!5,colframe=red!50!black,title=Important]\n${content}\\end{tcolorbox}`;
            default:
                return undefined;
        }
    }
};

/**
 * Caution block
 */
export const cautionBlockHandler: BlockExportHandler = {
    blockType: 'caution',
    description: 'Caution block',
    export(content, backend, context) {
        switch (backend) {
            case 'html':
                return `<div class="org-caution admonition caution">\n<p class="admonition-title">Caution</p>\n${content}</div>`;
            case 'latex':
                return `\\begin{tcolorbox}[colback=orange!10,colframe=orange!50!black,title=Caution]\n${content}\\end{tcolorbox}`;
            default:
                return undefined;
        }
    }
};

/**
 * Sidebar block
 */
export const sidebarBlockHandler: BlockExportHandler = {
    blockType: 'sidebar',
    description: 'Sidebar content',
    export(content, backend, context) {
        switch (backend) {
            case 'html':
                return `<aside class="org-sidebar">\n${content}</aside>`;
            case 'latex':
                return `\\begin{minipage}{0.3\\textwidth}\n\\fbox{\\parbox{\\textwidth}{${content}}}\n\\end{minipage}`;
            default:
                return undefined;
        }
    }
};

/**
 * Details/collapsible block
 */
export const detailsBlockHandler: BlockExportHandler = {
    blockType: 'details',
    description: 'Collapsible details block',
    export(content, backend, context) {
        const summary = context.parameters?.trim() || 'Details';
        switch (backend) {
            case 'html':
                return `<details>\n<summary>${summary}</summary>\n${content}</details>`;
            case 'latex':
                // LaTeX doesn't have native collapsible, use a framed box
                return `\\begin{framed}\n\\textbf{${summary}}\n\n${content}\\end{framed}`;
            default:
                return undefined;
        }
    }
};

// =============================================================================
// Registration
// =============================================================================

/**
 * Register built-in block export handlers
 */
export function registerBuiltinBlockHandlers(): vscode.Disposable[] {
    return [
        registerBlockExport(warningBlockHandler),
        registerBlockExport(noteBlockHandler),
        registerBlockExport(tipBlockHandler),
        registerBlockExport(importantBlockHandler),
        registerBlockExport(cautionBlockHandler),
        registerBlockExport(sidebarBlockHandler),
        registerBlockExport(detailsBlockHandler),
    ];
}

// =============================================================================
// Exports
// =============================================================================

export { BlockExportRegistry };
