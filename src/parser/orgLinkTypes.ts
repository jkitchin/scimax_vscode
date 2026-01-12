/**
 * Org-mode link type handlers
 * Provides extensible link type support for cite:, doi:, file:, etc.
 */

import type { LinkObject } from './orgElementTypes';

// =============================================================================
// Link Type Handler Interface
// =============================================================================

/**
 * Result of resolving a link
 */
export interface LinkResolution {
    /** Display text for the link */
    displayText: string;
    /** Resolved URL or path */
    url?: string;
    /** Tooltip/hover text */
    tooltip?: string;
    /** Whether the link target exists */
    exists?: boolean;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Context for link resolution
 */
export interface LinkContext {
    /** Current file path */
    filePath?: string;
    /** Root directory for file resolution */
    rootDir?: string;
    /** Bibliography files for citation resolution */
    bibliographyFiles?: string[];
    /** Org-roam directory for ID links */
    roamDir?: string;
    /** Custom data passed to handlers */
    custom?: Record<string, unknown>;
}

/**
 * Handler for a specific link type
 */
export interface LinkTypeHandler {
    /** Link type name (e.g., 'cite', 'doi', 'file') */
    type: string;
    /** Short description */
    description: string;
    /** Pattern to match link path (optional) */
    pattern?: RegExp;

    /**
     * Resolve the link to a displayable/clickable form
     */
    resolve(path: string, context: LinkContext): Promise<LinkResolution> | LinkResolution;

    /**
     * Generate export output for different backends
     */
    export?(
        path: string,
        description: string | undefined,
        backend: 'html' | 'latex' | 'text',
        context: LinkContext
    ): string;

    /**
     * Get completion suggestions for this link type
     */
    complete?(prefix: string, context: LinkContext): Promise<LinkCompletion[]>;

    /**
     * Follow/open the link (VS Code action)
     */
    follow?(path: string, context: LinkContext): Promise<void>;
}

/**
 * Completion suggestion for link targets
 */
export interface LinkCompletion {
    /** Completion text */
    text: string;
    /** Display label */
    label: string;
    /** Description/details */
    detail?: string;
    /** Sort priority (lower = higher) */
    sortPriority?: number;
}

// =============================================================================
// Link Type Registry
// =============================================================================

/**
 * Registry for link type handlers
 */
class LinkTypeRegistry {
    private handlers: Map<string, LinkTypeHandler> = new Map();
    private defaultHandler: LinkTypeHandler | null = null;

    /**
     * Register a link type handler
     */
    register(handler: LinkTypeHandler): void {
        this.handlers.set(handler.type.toLowerCase(), handler);
    }

    /**
     * Unregister a link type handler
     */
    unregister(type: string): boolean {
        return this.handlers.delete(type.toLowerCase());
    }

    /**
     * Get handler for a link type
     */
    getHandler(type: string): LinkTypeHandler | undefined {
        return this.handlers.get(type.toLowerCase()) || this.defaultHandler || undefined;
    }

    /**
     * Set the default handler for unknown link types
     */
    setDefaultHandler(handler: LinkTypeHandler): void {
        this.defaultHandler = handler;
    }

    /**
     * Get all registered types
     */
    getTypes(): string[] {
        return Array.from(this.handlers.keys());
    }

    /**
     * Check if a type is registered
     */
    hasType(type: string): boolean {
        return this.handlers.has(type.toLowerCase());
    }
}

// Global registry instance
export const linkTypeRegistry = new LinkTypeRegistry();

// =============================================================================
// Built-in Link Type Handlers
// =============================================================================

/**
 * HTTP/HTTPS link handler
 */
export const httpHandler: LinkTypeHandler = {
    type: 'http',
    description: 'Web URLs',

    resolve(path: string, context: LinkContext): LinkResolution {
        const url = path.startsWith('http') ? path : `http://${path}`;
        return {
            displayText: url,
            url,
            tooltip: `Open ${url} in browser`,
        };
    },

    export(path: string, description: string | undefined, backend: 'html' | 'latex' | 'text'): string {
        const url = path.startsWith('http') ? path : `http://${path}`;
        const text = description || url;

        switch (backend) {
            case 'html':
                return `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
            case 'latex':
                return description
                    ? `\\href{${escapeLatex(url)}}{${escapeLatex(text)}}`
                    : `\\url{${escapeLatex(url)}}`;
            case 'text':
            default:
                return description ? `${text} (${url})` : url;
        }
    },
};

/**
 * HTTPS link handler
 */
export const httpsHandler: LinkTypeHandler = {
    ...httpHandler,
    type: 'https',
    resolve(path: string, context: LinkContext): LinkResolution {
        const url = path.startsWith('https') ? path : `https://${path}`;
        return {
            displayText: url,
            url,
            tooltip: `Open ${url} in browser`,
        };
    },
};

/**
 * File link handler
 */
export const fileHandler: LinkTypeHandler = {
    type: 'file',
    description: 'Local files',

    resolve(path: string, context: LinkContext): LinkResolution {
        // Handle file:// protocol
        let filePath = path;
        if (filePath.startsWith('file://')) {
            filePath = filePath.slice(7);
        }

        // Resolve relative paths
        if (context.rootDir && !filePath.startsWith('/')) {
            filePath = `${context.rootDir}/${filePath}`;
        }

        // Extract search option (::search)
        let searchOption: string | undefined;
        const searchIdx = filePath.indexOf('::');
        if (searchIdx !== -1) {
            searchOption = filePath.slice(searchIdx + 2);
            filePath = filePath.slice(0, searchIdx);
        }

        return {
            displayText: filePath.split('/').pop() || filePath,
            url: `file://${filePath}`,
            tooltip: filePath + (searchOption ? ` (search: ${searchOption})` : ''),
            metadata: { searchOption },
        };
    },

    export(path: string, description: string | undefined, backend: 'html' | 'latex' | 'text'): string {
        const fileName = path.split('/').pop() || path;
        const text = description || fileName;

        switch (backend) {
            case 'html':
                // For HTML, convert .org to .html
                const htmlPath = path.replace(/\.org$/, '.html');
                return `<a href="${escapeHtml(htmlPath)}">${escapeHtml(text)}</a>`;
            case 'latex':
                return `\\texttt{${escapeLatex(text)}}`;
            case 'text':
            default:
                return text;
        }
    },
};

/**
 * ID link handler (org-id)
 */
export const idHandler: LinkTypeHandler = {
    type: 'id',
    description: 'Org ID links',

    resolve(path: string, context: LinkContext): LinkResolution {
        // ID resolution would typically involve a database lookup
        return {
            displayText: `ID: ${path}`,
            tooltip: `Link to ID: ${path}`,
            metadata: { id: path },
        };
    },

    export(path: string, description: string | undefined, backend: 'html' | 'latex' | 'text'): string {
        const text = description || `[${path}]`;

        switch (backend) {
            case 'html':
                return `<a href="#${escapeHtml(path)}">${escapeHtml(text)}</a>`;
            case 'latex':
                return description
                    ? `\\hyperref[${path}]{${escapeLatex(text)}}`
                    : `\\ref{${path}}`;
            case 'text':
            default:
                return text;
        }
    },
};

/**
 * DOI link handler
 */
export const doiHandler: LinkTypeHandler = {
    type: 'doi',
    description: 'Digital Object Identifier',

    resolve(path: string, context: LinkContext): LinkResolution {
        const doi = path.replace(/^doi:/, '');
        return {
            displayText: `doi:${doi}`,
            url: `https://doi.org/${doi}`,
            tooltip: `Open DOI: ${doi}`,
        };
    },

    export(path: string, description: string | undefined, backend: 'html' | 'latex' | 'text'): string {
        const doi = path.replace(/^doi:/, '');
        const url = `https://doi.org/${doi}`;
        const text = description || `doi:${doi}`;

        switch (backend) {
            case 'html':
                return `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
            case 'latex':
                return `\\href{${escapeLatex(url)}}{${escapeLatex(text)}}`;
            case 'text':
            default:
                return description ? `${text} (${url})` : url;
        }
    },
};

/**
 * Citation link handler (for org-ref style citations)
 */
export const citeHandler: LinkTypeHandler = {
    type: 'cite',
    description: 'BibTeX citations',

    resolve(path: string, context: LinkContext): LinkResolution {
        // Parse citation keys (can be comma-separated)
        const keys = path.split(',').map(k => k.trim());

        return {
            displayText: keys.map(k => `[${k}]`).join(', '),
            tooltip: `Citation: ${keys.join(', ')}`,
            metadata: { keys },
        };
    },

    export(path: string, description: string | undefined, backend: 'html' | 'latex' | 'text'): string {
        const keys = path.split(',').map(k => k.trim());

        switch (backend) {
            case 'html':
                // Simple bracketed citation for HTML
                return keys.map(k => `<cite>[${escapeHtml(k)}]</cite>`).join(', ');
            case 'latex':
                // Use \cite command for LaTeX
                return `\\cite{${keys.join(',')}}`;
            case 'text':
            default:
                return keys.map(k => `[${k}]`).join(', ');
        }
    },

    async complete(prefix: string, context: LinkContext): Promise<LinkCompletion[]> {
        // Would search bibliography files for matching keys
        // Placeholder implementation
        return [];
    },
};

/**
 * Mailto link handler
 */
export const mailtoHandler: LinkTypeHandler = {
    type: 'mailto',
    description: 'Email addresses',

    resolve(path: string, context: LinkContext): LinkResolution {
        const email = path.replace(/^mailto:/, '');
        return {
            displayText: email,
            url: `mailto:${email}`,
            tooltip: `Send email to ${email}`,
        };
    },

    export(path: string, description: string | undefined, backend: 'html' | 'latex' | 'text'): string {
        const email = path.replace(/^mailto:/, '');
        const text = description || email;

        switch (backend) {
            case 'html':
                return `<a href="mailto:${escapeHtml(email)}">${escapeHtml(text)}</a>`;
            case 'latex':
                return `\\href{mailto:${escapeLatex(email)}}{${escapeLatex(text)}}`;
            case 'text':
            default:
                return text;
        }
    },
};

/**
 * Shell command link handler
 */
export const shellHandler: LinkTypeHandler = {
    type: 'shell',
    description: 'Shell commands',

    resolve(path: string, context: LinkContext): LinkResolution {
        return {
            displayText: `$ ${path}`,
            tooltip: `Execute: ${path}`,
            metadata: { command: path },
        };
    },

    export(path: string, description: string | undefined, backend: 'html' | 'latex' | 'text'): string {
        const text = description || path;

        switch (backend) {
            case 'html':
                return `<code>${escapeHtml(text)}</code>`;
            case 'latex':
                return `\\texttt{${escapeLatex(text)}}`;
            case 'text':
            default:
                return text;
        }
    },
};

/**
 * Elisp link handler (for compatibility)
 */
export const elispHandler: LinkTypeHandler = {
    type: 'elisp',
    description: 'Emacs Lisp code',

    resolve(path: string, context: LinkContext): LinkResolution {
        return {
            displayText: `(elisp: ${path})`,
            tooltip: `Elisp: ${path}`,
            metadata: { code: path },
        };
    },

    export(path: string, description: string | undefined, backend: 'html' | 'latex' | 'text'): string {
        const text = description || path;
        switch (backend) {
            case 'html':
                return `<code class="elisp">${escapeHtml(text)}</code>`;
            case 'latex':
                return `\\texttt{${escapeLatex(text)}}`;
            case 'text':
            default:
                return text;
        }
    },
};

/**
 * Help link handler
 */
export const helpHandler: LinkTypeHandler = {
    type: 'help',
    description: 'Help topics',

    resolve(path: string, context: LinkContext): LinkResolution {
        return {
            displayText: path,
            tooltip: `Help: ${path}`,
        };
    },

    export(path: string, description: string | undefined, backend: 'html' | 'latex' | 'text'): string {
        return description || path;
    },
};

/**
 * Info link handler
 */
export const infoHandler: LinkTypeHandler = {
    type: 'info',
    description: 'Info manual nodes',

    resolve(path: string, context: LinkContext): LinkResolution {
        // Parse (manual)node format
        const match = path.match(/^\(([^)]+)\)(.*)$/);
        const manual = match ? match[1] : '';
        const node = match ? match[2] : path;

        return {
            displayText: `Info: ${manual ? `(${manual}) ${node}` : node}`,
            tooltip: `Info manual: ${path}`,
            metadata: { manual, node },
        };
    },

    export(path: string, description: string | undefined, backend: 'html' | 'latex' | 'text'): string {
        return description || path;
    },
};

/**
 * Roam link handler (org-roam style)
 */
export const roamHandler: LinkTypeHandler = {
    type: 'roam',
    description: 'Org-roam links',

    resolve(path: string, context: LinkContext): LinkResolution {
        return {
            displayText: path,
            tooltip: `Roam: ${path}`,
            metadata: { title: path },
        };
    },

    export(path: string, description: string | undefined, backend: 'html' | 'latex' | 'text'): string {
        const text = description || path;
        switch (backend) {
            case 'html':
                return `<a class="roam-link" href="#">${escapeHtml(text)}</a>`;
            case 'latex':
                return escapeLatex(text);
            case 'text':
            default:
                return text;
        }
    },
};

// =============================================================================
// Helper Functions
// =============================================================================

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeLatex(str: string): string {
    return str
        .replace(/[&%$#_{}]/g, '\\$&')
        .replace(/\\/g, '\\textbackslash{}')
        .replace(/\^/g, '\\textasciicircum{}')
        .replace(/~/g, '\\textasciitilde{}');
}

// =============================================================================
// Initialize Built-in Handlers
// =============================================================================

/**
 * Register all built-in link type handlers
 */
export function registerBuiltinHandlers(): void {
    linkTypeRegistry.register(httpHandler);
    linkTypeRegistry.register(httpsHandler);
    linkTypeRegistry.register(fileHandler);
    linkTypeRegistry.register(idHandler);
    linkTypeRegistry.register(doiHandler);
    linkTypeRegistry.register(citeHandler);
    linkTypeRegistry.register(mailtoHandler);
    linkTypeRegistry.register(shellHandler);
    linkTypeRegistry.register(elispHandler);
    linkTypeRegistry.register(helpHandler);
    linkTypeRegistry.register(infoHandler);
    linkTypeRegistry.register(roamHandler);
}

// Auto-register built-in handlers
registerBuiltinHandlers();

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Resolve a link using the appropriate handler
 */
export async function resolveLink(
    link: LinkObject,
    context: LinkContext = {}
): Promise<LinkResolution> {
    const handler = linkTypeRegistry.getHandler(link.properties.linkType);

    if (!handler) {
        return {
            displayText: link.properties.rawLink || link.properties.path,
            tooltip: `Unknown link type: ${link.properties.linkType}`,
        };
    }

    return handler.resolve(link.properties.path, context);
}

/**
 * Export a link using the appropriate handler
 */
export function exportLink(
    link: LinkObject,
    backend: 'html' | 'latex' | 'text',
    context: LinkContext = {}
): string {
    const handler = linkTypeRegistry.getHandler(link.properties.linkType);
    const description = link.children
        ? link.children.map(c => c.type === 'plain-text' ? (c as any).properties.value : '').join('')
        : undefined;

    if (handler?.export) {
        return handler.export(link.properties.path, description, backend, context);
    }

    // Fallback
    const text = description || link.properties.path;
    switch (backend) {
        case 'html':
            return `<a href="${escapeHtml(link.properties.rawLink || link.properties.path)}">${escapeHtml(text)}</a>`;
        case 'latex':
            return `\\href{${escapeLatex(link.properties.rawLink || link.properties.path)}}{${escapeLatex(text)}}`;
        case 'text':
        default:
            return text;
    }
}

/**
 * Get completions for a link type
 */
export async function getLinkCompletions(
    type: string,
    prefix: string,
    context: LinkContext = {}
): Promise<LinkCompletion[]> {
    const handler = linkTypeRegistry.getHandler(type);

    if (!handler?.complete) {
        return [];
    }

    return handler.complete(prefix, context);
}

// =============================================================================
// Exports
// =============================================================================

export {
    LinkTypeRegistry,
    escapeHtml,
    escapeLatex,
};
