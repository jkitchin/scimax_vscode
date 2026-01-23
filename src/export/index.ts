/**
 * Custom Export System
 *
 * This module provides:
 * - Custom exporter definitions via manifest.json + Handlebars templates
 * - Registry for loading and managing exporters
 * - VS Code commands for custom exports
 */

export {
    // Types
    KeywordDefinition,
    ExporterManifest,
    CustomExporter,
    TemplateContext,

    // Registry
    ExporterRegistry,

    // Functions
    compileTemplate,
    registerPartial,
    renderTemplate,
    extractCustomKeywords,
    executeCustomExport,
    getDefaultExporterPaths,
    initializeExporterRegistry,

    // Examples
    EXAMPLE_CMU_MEMO_MANIFEST,
    EXAMPLE_CMU_MEMO_TEMPLATE,
    EXAMPLE_CMU_DISSERTATION_MANIFEST,
} from './customExporter';

export { registerCustomExportCommands } from './commands';
