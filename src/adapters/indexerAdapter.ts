/**
 * Indexer Adapter
 *
 * Provides extension points for extracting custom data during file indexing.
 * Plugins can register adapters to extract entities, relationships, or other
 * metadata from files as they are indexed into the database.
 *
 * This enables building knowledge graphs, entity extraction systems, or
 * custom metadata tracking without modifying the core indexing logic.
 */

import * as vscode from 'vscode';
import type { OrgDocumentNode } from '../parser/orgElementTypes';

/**
 * Context passed to indexer adapters during file indexing
 */
export interface IndexContext {
    /** Absolute path to the file being indexed */
    filePath: string;
    /** File ID in the database */
    fileId: number;
    /** File type (org, md) */
    fileType: string;
    /** File modification time */
    mtime: number;
    /** Database client for custom queries/inserts */
    db: unknown;
}

/**
 * Types of extracted data
 */
export type ExtractedDataType = 'entity' | 'relationship' | 'metadata' | 'custom';

/**
 * Base interface for extracted data
 */
export interface ExtractedDataBase {
    /** Type of extracted data */
    type: ExtractedDataType;
}

/**
 * An entity extracted from a file (e.g., person, concept, term)
 */
export interface ExtractedEntity extends ExtractedDataBase {
    type: 'entity';
    /** Entity category (e.g., 'person', 'concept', 'project') */
    category: string;
    /** Entity name/identifier */
    name: string;
    /** Optional properties */
    properties?: Record<string, unknown>;
    /** Line number where entity was found */
    lineNumber?: number;
}

/**
 * A relationship between entities or files
 */
export interface ExtractedRelationship extends ExtractedDataBase {
    type: 'relationship';
    /** Source entity or file path */
    source: string;
    /** Target entity or file path */
    target: string;
    /** Relationship type (e.g., 'references', 'is_part_of', 'related_to') */
    relation: string;
    /** Optional weight/strength */
    weight?: number;
    /** Optional properties */
    properties?: Record<string, unknown>;
}

/**
 * Custom metadata about a file
 */
export interface ExtractedMetadata extends ExtractedDataBase {
    type: 'metadata';
    /** Metadata key */
    key: string;
    /** Metadata value (will be JSON serialized) */
    value: unknown;
}

/**
 * Custom data type for plugin-specific needs
 */
export interface ExtractedCustom extends ExtractedDataBase {
    type: 'custom';
    /** Custom data category */
    category: string;
    /** Custom data payload */
    data: unknown;
}

/**
 * Union type for all extracted data
 */
export type ExtractedData = ExtractedEntity | ExtractedRelationship | ExtractedMetadata | ExtractedCustom;

/**
 * Indexer adapter interface
 */
export interface IndexerAdapter {
    /** Unique identifier for this adapter */
    id: string;

    /** Human-readable description */
    description?: string;

    /** Priority for ordering (higher runs first, default 0) */
    priority?: number;

    /** File types to process (e.g., ['org', 'md']). Empty means all. */
    fileTypes?: string[];

    /**
     * Extract custom data from a file during indexing
     * @param content Raw file content
     * @param ast Parsed AST (may be undefined for non-org/md files)
     * @param context Indexing context
     * @returns Array of extracted data items
     */
    extract(
        content: string,
        ast: OrgDocumentNode | undefined,
        context: IndexContext
    ): Promise<ExtractedData[]>;

    /**
     * Optional: Called when a file is removed from the index
     * Use this to clean up any custom data associated with the file
     * @param filePath Path of the file being removed
     * @param fileId Database ID of the file
     * @param db Database client
     */
    onFileRemoved?(filePath: string, fileId: number, db: unknown): Promise<void>;
}

/**
 * Result of running indexer adapters
 */
export interface IndexerResult {
    /** All extracted entities */
    entities: ExtractedEntity[];
    /** All extracted relationships */
    relationships: ExtractedRelationship[];
    /** All extracted metadata */
    metadata: ExtractedMetadata[];
    /** All custom data by category */
    custom: Map<string, ExtractedCustom[]>;
    /** Any errors that occurred */
    errors: Array<{ adapterId: string; error: Error }>;
}

/**
 * Registry for indexer adapters
 */
class IndexerAdapterRegistry {
    /** @internal */
    readonly adapters: Map<string, IndexerAdapter> = new Map();

    /**
     * Register a new indexer adapter
     */
    register(adapter: IndexerAdapter): vscode.Disposable {
        if (!adapter.id) {
            throw new Error('Indexer adapter must have an id');
        }
        if (this.adapters.has(adapter.id)) {
            throw new Error(`Indexer adapter with id '${adapter.id}' is already registered`);
        }

        this.adapters.set(adapter.id, adapter);

        return new vscode.Disposable(() => {
            this.adapters.delete(adapter.id);
        });
    }

    /**
     * Unregister an adapter by id
     */
    unregister(id: string): boolean {
        return this.adapters.delete(id);
    }

    /**
     * Get all registered adapters sorted by priority (higher first)
     */
    getAdapters(): IndexerAdapter[] {
        return Array.from(this.adapters.values())
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }

    /**
     * Get adapters that handle a specific file type
     */
    getAdaptersForFileType(fileType: string): IndexerAdapter[] {
        return this.getAdapters().filter(adapter => {
            if (!adapter.fileTypes || adapter.fileTypes.length === 0) {
                return true; // Handle all file types
            }
            return adapter.fileTypes.includes(fileType);
        });
    }

    /**
     * Get a specific adapter by id
     */
    getAdapter(id: string): IndexerAdapter | undefined {
        return this.adapters.get(id);
    }

    /**
     * Check if an adapter is registered
     */
    hasAdapter(id: string): boolean {
        return this.adapters.has(id);
    }

    /**
     * Get all adapter ids
     */
    getAdapterIds(): string[] {
        return Array.from(this.adapters.keys());
    }

    /**
     * Run all applicable adapters for a file
     */
    async runAdapters(
        content: string,
        ast: OrgDocumentNode | undefined,
        context: IndexContext
    ): Promise<IndexerResult> {
        const result: IndexerResult = {
            entities: [],
            relationships: [],
            metadata: [],
            custom: new Map(),
            errors: []
        };

        const adapters = this.getAdaptersForFileType(context.fileType);

        for (const adapter of adapters) {
            try {
                const extracted = await adapter.extract(content, ast, context);

                for (const item of extracted) {
                    switch (item.type) {
                        case 'entity':
                            result.entities.push(item);
                            break;
                        case 'relationship':
                            result.relationships.push(item);
                            break;
                        case 'metadata':
                            result.metadata.push(item);
                            break;
                        case 'custom':
                            if (!result.custom.has(item.category)) {
                                result.custom.set(item.category, []);
                            }
                            result.custom.get(item.category)!.push(item);
                            break;
                    }
                }
            } catch (error) {
                result.errors.push({
                    adapterId: adapter.id,
                    error: error as Error
                });
                console.error(`Indexer adapter '${adapter.id}' failed:`, error);
            }
        }

        return result;
    }

    /**
     * Notify adapters of file removal
     */
    async notifyFileRemoved(filePath: string, fileId: number, db: unknown): Promise<void> {
        for (const adapter of this.getAdapters()) {
            if (adapter.onFileRemoved) {
                try {
                    await adapter.onFileRemoved(filePath, fileId, db);
                } catch (error) {
                    console.error(`Indexer adapter '${adapter.id}' onFileRemoved failed:`, error);
                }
            }
        }
    }

    /**
     * Clear all adapters (for testing)
     */
    clear(): void {
        this.adapters.clear();
    }
}

/**
 * Global indexer adapter registry instance
 */
export const indexerRegistry = new IndexerAdapterRegistry();

/**
 * Register an indexer adapter
 * @returns Disposable that unregisters the adapter when disposed
 */
export function registerIndexer(adapter: IndexerAdapter): vscode.Disposable {
    return indexerRegistry.register(adapter);
}
