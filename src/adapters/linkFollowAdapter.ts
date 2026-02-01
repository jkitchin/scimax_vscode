/**
 * Link Follow Adapter
 *
 * VS Code-specific handlers for following/opening links.
 * This separates VS Code dependencies from the core link type system,
 * enabling the parser to be extracted as a standalone npm library.
 *
 * The core LinkTypeHandler interface (in parser/orgLinkTypes.ts) handles:
 * - resolve(): Pure link resolution (display text, URL, tooltip)
 * - export(): Pure export to different backends (HTML, LaTeX, text)
 * - complete(): Completion suggestions (can be async but pure)
 *
 * This adapter handles:
 * - follow(): VS Code-specific actions (opening files, running commands)
 */

import * as vscode from 'vscode';
import type { LinkContext, ProjectInfo } from '../parser/orgLinkTypes';

// =============================================================================
// Link Follow Handler Interface
// =============================================================================

/**
 * Handler for following/opening a specific link type.
 * This is the VS Code-specific counterpart to LinkTypeHandler.
 */
export interface LinkFollowHandler {
    /** Link type name (must match LinkTypeHandler.type) */
    type: string;

    /**
     * Follow/open the link (VS Code action)
     * @param path The link path (after the type prefix)
     * @param context Resolution context
     */
    follow(path: string, context: LinkContext): Promise<void>;
}

// =============================================================================
// Link Follow Registry
// =============================================================================

/**
 * Registry for link follow handlers (VS Code layer)
 */
class LinkFollowRegistry {
    private handlers: Map<string, LinkFollowHandler> = new Map();

    /**
     * Register a follow handler
     */
    register(handler: LinkFollowHandler): vscode.Disposable {
        this.handlers.set(handler.type.toLowerCase(), handler);
        return new vscode.Disposable(() => this.unregister(handler.type));
    }

    /**
     * Unregister a follow handler
     */
    unregister(type: string): boolean {
        return this.handlers.delete(type.toLowerCase());
    }

    /**
     * Get handler for a link type
     */
    getHandler(type: string): LinkFollowHandler | undefined {
        return this.handlers.get(type.toLowerCase());
    }

    /**
     * Check if a type has a follow handler
     */
    hasHandler(type: string): boolean {
        return this.handlers.has(type.toLowerCase());
    }

    /**
     * Get all registered types
     */
    getTypes(): string[] {
        return Array.from(this.handlers.keys());
    }

    /**
     * Follow a link using the appropriate handler
     */
    async follow(type: string, path: string, context: LinkContext): Promise<boolean> {
        const handler = this.getHandler(type);
        if (!handler) {
            return false;
        }
        await handler.follow(path, context);
        return true;
    }
}

// Global registry instance
export const linkFollowRegistry = new LinkFollowRegistry();

// =============================================================================
// Built-in Follow Handlers
// =============================================================================

/**
 * Command link follow handler
 * Executes VS Code commands via cmd: links
 */
export const cmdFollowHandler: LinkFollowHandler = {
    type: 'cmd',

    async follow(path: string, context: LinkContext): Promise<void> {
        try {
            // Support command arguments: cmd:command?arg1&arg2 or cmd:command?json={"key":"value"}
            let command = path;
            let args: unknown[] = [];

            const queryIndex = path.indexOf('?');
            if (queryIndex !== -1) {
                command = path.substring(0, queryIndex);
                const queryString = path.substring(queryIndex + 1);

                // Check if it's JSON format
                if (queryString.startsWith('json=')) {
                    try {
                        args = [JSON.parse(decodeURIComponent(queryString.substring(5)))];
                    } catch {
                        // Fall back to treating as simple string argument
                        args = [queryString.substring(5)];
                    }
                } else {
                    // Simple format: arg1&arg2&arg3 (each becomes a separate argument)
                    args = queryString.split('&').map(arg => decodeURIComponent(arg));
                }
            }

            await vscode.commands.executeCommand(command, ...args);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to execute command: ${path}`);
        }
    },
};

/**
 * Parse a notebook link path into its components
 * Format: project-name::file-path::target
 */
function parseNotebookLinkPath(path: string): { projectName: string; filePath: string; target?: string } | null {
    const firstSep = path.indexOf('::');
    if (firstSep === -1) {
        return null;
    }

    const projectName = path.slice(0, firstSep);
    const rest = path.slice(firstSep + 2);

    if (!projectName || !rest) {
        return null;
    }

    const secondSep = rest.indexOf('::');
    if (secondSep === -1) {
        return { projectName, filePath: rest };
    }

    const filePath = rest.slice(0, secondSep);
    const target = rest.slice(secondSep + 2);

    if (!filePath) {
        return null;
    }

    return { projectName, filePath, target: target || undefined };
}

/**
 * Notebook link follow handler
 * Opens files in projects via nb: links
 */
export const notebookFollowHandler: LinkFollowHandler = {
    type: 'nb',

    async follow(path: string, context: LinkContext): Promise<void> {
        const parsed = parseNotebookLinkPath(path);
        if (!parsed) {
            vscode.window.showErrorMessage('Invalid notebook link format');
            return;
        }

        const { projectName, filePath, target } = parsed;
        const projects = context.getProjects?.() || [];

        // Find matching projects
        const matchingProjects = projects.filter(
            proj => proj.name === projectName ||
                  proj.name.toLowerCase() === projectName.toLowerCase() ||
                  proj.path.endsWith(`/${projectName}`) ||
                  proj.path.endsWith(`\\${projectName}`)
        );

        if (matchingProjects.length === 0) {
            vscode.window.showErrorMessage(`Project not found: ${projectName}`);
            return;
        }

        let project: ProjectInfo;
        if (matchingProjects.length > 1) {
            // Show picker for ambiguous matches
            const items = matchingProjects.map(proj => ({
                label: proj.name,
                description: proj.path,
                project: proj,
            }));
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Multiple projects match "${projectName}". Select one:`,
            });
            if (!selected) return;
            project = selected.project;
        } else {
            project = matchingProjects[0];
        }

        // Build full path
        const fullPath = `${project.path}/${filePath}`.replace(/\\/g, '/');

        // Open via command with target handling (reuses existing file link logic)
        const fileLink = target ? `file:${fullPath}::${target}` : `file:${fullPath}`;
        await vscode.commands.executeCommand('scimax.org.openLink', fileLink);
    },
};

/**
 * HTTP/HTTPS link follow handler
 * Opens URLs in external browser
 */
export const httpFollowHandler: LinkFollowHandler = {
    type: 'http',

    async follow(path: string, context: LinkContext): Promise<void> {
        const url = path.startsWith('http') ? path : `http://${path}`;
        await vscode.env.openExternal(vscode.Uri.parse(url));
    },
};

export const httpsFollowHandler: LinkFollowHandler = {
    type: 'https',

    async follow(path: string, context: LinkContext): Promise<void> {
        const url = path.startsWith('https') ? path : `https://${path}`;
        await vscode.env.openExternal(vscode.Uri.parse(url));
    },
};

/**
 * DOI link follow handler
 * Opens DOI URLs in external browser
 */
export const doiFollowHandler: LinkFollowHandler = {
    type: 'doi',

    async follow(path: string, context: LinkContext): Promise<void> {
        const doi = path.replace(/^doi:/, '');
        await vscode.env.openExternal(vscode.Uri.parse(`https://doi.org/${doi}`));
    },
};

/**
 * Mailto link follow handler
 * Opens email client
 */
export const mailtoFollowHandler: LinkFollowHandler = {
    type: 'mailto',

    async follow(path: string, context: LinkContext): Promise<void> {
        const email = path.replace(/^mailto:/, '');
        await vscode.env.openExternal(vscode.Uri.parse(`mailto:${email}`));
    },
};

// =============================================================================
// Registration
// =============================================================================

/**
 * Register all built-in follow handlers
 * Call this during extension activation
 */
export function registerBuiltinFollowHandlers(): vscode.Disposable[] {
    return [
        linkFollowRegistry.register(cmdFollowHandler),
        linkFollowRegistry.register(notebookFollowHandler),
        linkFollowRegistry.register(httpFollowHandler),
        linkFollowRegistry.register(httpsFollowHandler),
        linkFollowRegistry.register(doiFollowHandler),
        linkFollowRegistry.register(mailtoFollowHandler),
    ];
}

// =============================================================================
// Exports
// =============================================================================

export { LinkFollowRegistry };
