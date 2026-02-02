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

// Block Export Adapter
export {
    BlockExportHandler,
    BlockExportContext,
    BlockExportRegistry,
    blockExportRegistry,
    registerBlockExport,
    registerBuiltinBlockHandlers,
    // Built-in handlers for reference
    warningBlockHandler,
    noteBlockHandler,
    tipBlockHandler,
    importantBlockHandler,
    cautionBlockHandler,
    sidebarBlockHandler,
    detailsBlockHandler,
} from './blockExportAdapter';

// Block Highlight Adapter
export {
    BlockHighlightConfig,
    BlockHighlightRegistry,
    blockHighlightRegistry,
    registerBlockHighlight,
    registerBuiltinBlockHighlights,
    // Built-in configs for reference
    warningHighlightConfig,
    noteHighlightConfig,
    tipHighlightConfig,
    importantHighlightConfig,
    cautionHighlightConfig,
    sidebarHighlightConfig,
    detailsHighlightConfig,
} from './blockHighlightAdapter';

// Re-export core link types for convenience
export {
    LinkTypeHandler,
    LinkContext,
    LinkResolution,
    LinkCompletion,
    linkTypeRegistry,
} from '../parser/orgLinkTypes';

// Export Hooks Adapter
export {
    ExportHook,
    PreExportContext,
    PostExportContext,
    ElementFilterContext,
    exportHookRegistry,
    registerExportHook,
    // Helper functions
    createWrapperHook,
    createElementReplacerHook,
} from './exportHooksAdapter';

// Indexer Adapter (for knowledge graph extraction)
export {
    IndexerAdapter,
    IndexContext,
    ExtractedData,
    ExtractedDataType,
    ExtractedEntity,
    ExtractedRelationship,
    ExtractedMetadata,
    ExtractedCustom,
    IndexerResult,
    indexerRegistry,
    registerIndexer,
} from './indexerAdapter';

// Query Provider Adapter (for custom search types)
export {
    QueryProvider,
    QueryParams,
    QueryResult,
    QueryResponse,
    QueryCapabilities,
    queryProviderRegistry,
    registerQueryProvider,
    // Built-in providers
    graphPathProvider,
    relatedFilesProvider,
} from './queryProviderAdapter';

// Graph Data Provider Adapter (for graph enrichment)
export {
    GraphDataProvider,
    GraphDataContext,
    NodeEnrichment,
    EdgeEnrichment,
    CustomEdge,
    GraphEnrichmentResult,
    graphDataRegistry,
    registerGraphDataProvider,
    // Built-in providers
    linkCountImportanceProvider,
    recencyColoringProvider,
} from './graphDataAdapter';
