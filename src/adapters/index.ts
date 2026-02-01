/**
 * Adapters Index
 *
 * This module exports all adapter layer functionality for plugin extensions.
 * The adapter layer separates VS Code-specific code from the core parser,
 * enabling the parser to be extracted as a standalone npm library.
 *
 * Extension Points:
 * - Link Types: Register custom link handlers (resolve, export, follow)
 * - Babel Executors: Register custom language executors
 *
 * @example
 * ```typescript
 * // In your VS Code extension
 * const scimaxApi = vscode.extensions.getExtension('scimax.scimax-vscode')?.exports;
 *
 * if (scimaxApi) {
 *     // Register a custom link type
 *     const linkDisposable = scimaxApi.registerLinkType({
 *         type: 'jira',
 *         resolve: (path) => ({ displayText: path, url: `https://jira.example.com/${path}` }),
 *     });
 *
 *     // Register a custom language executor
 *     const execDisposable = scimaxApi.registerBabelExecutor({
 *         languages: ['mylang'],
 *         execute: async (code, ctx) => ({ success: true, stdout: 'result', stderr: '', executionTime: 10 }),
 *         isAvailable: async () => true,
 *     });
 *
 *     context.subscriptions.push(linkDisposable, execDisposable);
 * }
 * ```
 */

// Link Follow Adapter
export {
    LinkFollowHandler,
    LinkFollowRegistry,
    linkFollowRegistry,
    registerBuiltinFollowHandlers,
    // Individual handlers for reference
    cmdFollowHandler,
    notebookFollowHandler,
    httpFollowHandler,
    httpsFollowHandler,
    doiFollowHandler,
    mailtoFollowHandler,
} from './linkFollowAdapter';

// Babel Executor Adapter
export {
    // Core types (re-exported from parser)
    LanguageExecutor,
    ExecutionContext,
    ExecutionResult,
    // Registration
    registerBabelExecutor,
    isLanguageSupported,
    getRegisteredLanguages,
    // Helpers for creating executors
    createSimpleExecutor,
    createSessionExecutor,
    SimpleExecutorOptions,
    SessionExecutorOptions,
    validateExecutor,
} from './babelExecutorAdapter';

// Re-export core link types for convenience
export {
    LinkTypeHandler,
    LinkContext,
    LinkResolution,
    LinkCompletion,
    linkTypeRegistry,
} from '../parser/orgLinkTypes';
