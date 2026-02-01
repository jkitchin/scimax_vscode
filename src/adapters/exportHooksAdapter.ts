/**
 * Export Hooks Adapter
 *
 * Provides extension points for customizing the export process without
 * implementing a full ExportBackend. Hooks run at specific points during
 * export and can modify options, transform output, or filter elements.
 *
 * This is part of the VS Code adapter layer - it provides the registration
 * mechanism while the actual hook invocation happens in the export backends.
 */

import * as vscode from 'vscode';
import type { ExportOptions } from '../parser/orgExport';
import type { OrgElement, OrgDocumentNode } from '../parser/orgElementTypes';

/**
 * Context passed to pre-export hooks
 */
export interface PreExportContext {
    /** The document being exported */
    document: OrgDocumentNode;
    /** Current export options */
    options: ExportOptions;
    /** Export backend name (html, latex, etc.) */
    backend: string;
    /** Source file path if available */
    filePath?: string;
}

/**
 * Context passed to post-export hooks
 */
export interface PostExportContext {
    /** Export backend name */
    backend: string;
    /** Export options used */
    options: ExportOptions;
    /** Source file path if available */
    filePath?: string;
}

/**
 * Context passed to element filter hooks
 */
export interface ElementFilterContext {
    /** The element being exported */
    element: OrgElement;
    /** Export backend name */
    backend: string;
    /** Export options */
    options: ExportOptions;
    /** Parent element if any */
    parent?: OrgElement;
}

/**
 * Export hook definition
 */
export interface ExportHook {
    /** Unique identifier for this hook */
    id: string;

    /** Optional description */
    description?: string;

    /** Priority for ordering (higher runs first, default 0) */
    priority?: number;

    /**
     * Pre-export hook - runs before export starts
     * Can modify export options
     * @returns Modified options or undefined to keep original
     */
    preExport?: (context: PreExportContext) => ExportOptions | undefined;

    /**
     * Post-export hook - runs after export completes
     * Can transform the final output
     * @returns Transformed output or undefined to keep original
     */
    postExport?: (output: string, context: PostExportContext) => string | undefined;

    /**
     * Element filter - runs for each element during export
     * Can override the rendered output for specific elements
     * @returns Custom rendering or undefined to use default
     */
    elementFilter?: (rendered: string, context: ElementFilterContext) => string | undefined;
}

/**
 * Registry for export hooks
 */
class ExportHookRegistry {
    /** @internal */
    readonly hooks: Map<string, ExportHook> = new Map();

    /**
     * Register a new export hook
     */
    register(hook: ExportHook): vscode.Disposable {
        if (!hook.id) {
            throw new Error('Export hook must have an id');
        }
        if (this.hooks.has(hook.id)) {
            throw new Error(`Export hook with id '${hook.id}' is already registered`);
        }

        this.hooks.set(hook.id, hook);

        return new vscode.Disposable(() => {
            this.hooks.delete(hook.id);
        });
    }

    /**
     * Unregister a hook by id
     */
    unregister(id: string): boolean {
        return this.hooks.delete(id);
    }

    /**
     * Get all registered hooks sorted by priority (higher first)
     */
    getHooks(): ExportHook[] {
        return Array.from(this.hooks.values())
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }

    /**
     * Get a specific hook by id
     */
    getHook(id: string): ExportHook | undefined {
        return this.hooks.get(id);
    }

    /**
     * Check if a hook is registered
     */
    hasHook(id: string): boolean {
        return this.hooks.has(id);
    }

    /**
     * Get all hook ids
     */
    getHookIds(): string[] {
        return Array.from(this.hooks.keys());
    }

    /**
     * Run all pre-export hooks
     * @returns Final modified options
     */
    runPreExportHooks(context: PreExportContext): ExportOptions {
        let options = { ...context.options };

        for (const hook of this.getHooks()) {
            if (hook.preExport) {
                try {
                    const modified = hook.preExport({ ...context, options });
                    if (modified !== undefined) {
                        options = modified;
                    }
                } catch (error) {
                    console.error(`Export hook '${hook.id}' preExport failed:`, error);
                }
            }
        }

        return options;
    }

    /**
     * Run all post-export hooks
     * @returns Final transformed output
     */
    runPostExportHooks(output: string, context: PostExportContext): string {
        let result = output;

        for (const hook of this.getHooks()) {
            if (hook.postExport) {
                try {
                    const transformed = hook.postExport(result, context);
                    if (transformed !== undefined) {
                        result = transformed;
                    }
                } catch (error) {
                    console.error(`Export hook '${hook.id}' postExport failed:`, error);
                }
            }
        }

        return result;
    }

    /**
     * Run all element filter hooks
     * @returns Final rendered output or undefined if no hook modified it
     */
    runElementFilters(rendered: string, context: ElementFilterContext): string {
        let result = rendered;
        let modified = false;

        for (const hook of this.getHooks()) {
            if (hook.elementFilter) {
                try {
                    const filtered = hook.elementFilter(result, context);
                    if (filtered !== undefined) {
                        result = filtered;
                        modified = true;
                    }
                } catch (error) {
                    console.error(`Export hook '${hook.id}' elementFilter failed:`, error);
                }
            }
        }

        return modified ? result : rendered;
    }

    /**
     * Clear all hooks (for testing)
     */
    clear(): void {
        this.hooks.clear();
    }
}

/**
 * Global export hook registry instance
 */
export const exportHookRegistry = new ExportHookRegistry();

/**
 * Register an export hook
 * @returns Disposable that unregisters the hook when disposed
 */
export function registerExportHook(hook: ExportHook): vscode.Disposable {
    return exportHookRegistry.register(hook);
}

/**
 * Helper to create a simple post-export wrapper hook
 */
export function createWrapperHook(
    id: string,
    options: {
        backend?: string | string[];
        before?: string;
        after?: string;
        priority?: number;
    }
): ExportHook {
    const backends = options.backend
        ? Array.isArray(options.backend) ? options.backend : [options.backend]
        : undefined;

    return {
        id,
        priority: options.priority,
        postExport: (output, context) => {
            // Only apply to specified backends
            if (backends && !backends.includes(context.backend)) {
                return undefined;
            }

            const before = options.before ?? '';
            const after = options.after ?? '';
            return `${before}${output}${after}`;
        }
    };
}

/**
 * Helper to create an element replacement hook
 */
export function createElementReplacerHook(
    id: string,
    options: {
        elementType: string | string[];
        backend?: string | string[];
        replace: (rendered: string, element: OrgElement) => string;
        priority?: number;
    }
): ExportHook {
    const elementTypes = Array.isArray(options.elementType)
        ? options.elementType
        : [options.elementType];
    const backends = options.backend
        ? Array.isArray(options.backend) ? options.backend : [options.backend]
        : undefined;

    return {
        id,
        priority: options.priority,
        elementFilter: (rendered, context) => {
            // Check backend filter
            if (backends && !backends.includes(context.backend)) {
                return undefined;
            }

            // Check element type filter
            if (!elementTypes.includes(context.element.type)) {
                return undefined;
            }

            return options.replace(rendered, context.element);
        }
    };
}
