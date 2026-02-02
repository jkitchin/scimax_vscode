/**
 * Query Provider Adapter
 *
 * Provides extension points for custom database query types.
 * Plugins can register query providers to add specialized search
 * capabilities like graph traversal, path finding, or semantic queries.
 *
 * This enables building knowledge graph queries, recommendation systems,
 * or custom search algorithms without modifying the core search logic.
 */

import * as vscode from 'vscode';

/**
 * Parameters for a query
 */
export interface QueryParams {
    /** Query-specific parameters */
    [key: string]: unknown;
}

/**
 * A single query result
 */
export interface QueryResult {
    /** Result type (file, heading, entity, path, etc.) */
    type: string;
    /** Primary identifier (usually file path) */
    id: string;
    /** Display label */
    label: string;
    /** Optional description */
    description?: string;
    /** Relevance score (higher is better) */
    score?: number;
    /** Result-specific data */
    data?: Record<string, unknown>;
}

/**
 * Query execution result
 */
export interface QueryResponse {
    /** Query results */
    results: QueryResult[];
    /** Total count (may be greater than results.length if paginated) */
    totalCount?: number;
    /** Execution time in milliseconds */
    executionTimeMs?: number;
    /** Additional metadata about the query */
    metadata?: Record<string, unknown>;
}

/**
 * Query provider capabilities
 */
export interface QueryCapabilities {
    /** Whether this provider supports pagination */
    supportsPagination?: boolean;
    /** Whether this provider supports filtering */
    supportsFiltering?: boolean;
    /** Whether results are ranked by relevance */
    supportsRanking?: boolean;
    /** Maximum results this provider can return */
    maxResults?: number;
}

/**
 * Query provider interface
 */
export interface QueryProvider {
    /** Unique query type identifier (e.g., 'graph-path', 'semantic', 'related') */
    queryType: string;

    /** Human-readable name */
    name: string;

    /** Description of what this query does */
    description?: string;

    /** Provider capabilities */
    capabilities?: QueryCapabilities;

    /**
     * Validate query parameters
     * @returns true if valid, or error message if invalid
     */
    validate?(params: QueryParams): true | string;

    /**
     * Execute the query
     * @param params Query parameters
     * @param db Database client
     * @returns Query response
     */
    execute(params: QueryParams, db: unknown): Promise<QueryResponse>;

    /**
     * Optional: Get parameter schema for documentation/UI
     * Returns JSON Schema for the params object
     */
    getParamSchema?(): Record<string, unknown>;
}

/**
 * Registry for query providers
 */
class QueryProviderRegistry {
    /** @internal */
    readonly providers: Map<string, QueryProvider> = new Map();

    /**
     * Register a new query provider
     */
    register(provider: QueryProvider): vscode.Disposable {
        if (!provider.queryType) {
            throw new Error('Query provider must have a queryType');
        }
        if (this.providers.has(provider.queryType)) {
            throw new Error(`Query provider for type '${provider.queryType}' is already registered`);
        }

        this.providers.set(provider.queryType, provider);

        return new vscode.Disposable(() => {
            this.providers.delete(provider.queryType);
        });
    }

    /**
     * Unregister a provider by query type
     */
    unregister(queryType: string): boolean {
        return this.providers.delete(queryType);
    }

    /**
     * Get a provider by query type
     */
    getProvider(queryType: string): QueryProvider | undefined {
        return this.providers.get(queryType);
    }

    /**
     * Get all registered providers
     */
    getAllProviders(): QueryProvider[] {
        return Array.from(this.providers.values());
    }

    /**
     * Get all query types
     */
    getQueryTypes(): string[] {
        return Array.from(this.providers.keys());
    }

    /**
     * Check if a query type is registered
     */
    hasProvider(queryType: string): boolean {
        return this.providers.has(queryType);
    }

    /**
     * Execute a query
     * @throws Error if query type is not registered or validation fails
     */
    async executeQuery(queryType: string, params: QueryParams, db: unknown): Promise<QueryResponse> {
        const provider = this.providers.get(queryType);
        if (!provider) {
            throw new Error(`Unknown query type: ${queryType}`);
        }

        // Validate parameters if validator exists
        if (provider.validate) {
            const validation = provider.validate(params);
            if (validation !== true) {
                throw new Error(`Invalid query parameters: ${validation}`);
            }
        }

        const startTime = Date.now();
        const response = await provider.execute(params, db);

        // Add execution time if not already set
        if (response.executionTimeMs === undefined) {
            response.executionTimeMs = Date.now() - startTime;
        }

        return response;
    }

    /**
     * Clear all providers (for testing)
     */
    clear(): void {
        this.providers.clear();
    }
}

/**
 * Global query provider registry instance
 */
export const queryProviderRegistry = new QueryProviderRegistry();

/**
 * Register a query provider
 * @returns Disposable that unregisters the provider when disposed
 */
export function registerQueryProvider(provider: QueryProvider): vscode.Disposable {
    return queryProviderRegistry.register(provider);
}

// ============================================================================
// Built-in Query Providers
// ============================================================================

/**
 * Graph path query provider - finds paths between files through links
 */
export const graphPathProvider: QueryProvider = {
    queryType: 'graph-path',
    name: 'Graph Path Finder',
    description: 'Find shortest path between two files through link connections',
    capabilities: {
        supportsRanking: true,
        maxResults: 100
    },

    validate(params) {
        if (!params.from || typeof params.from !== 'string') {
            return 'Missing or invalid "from" parameter (file path)';
        }
        if (!params.to || typeof params.to !== 'string') {
            return 'Missing or invalid "to" parameter (file path)';
        }
        if (params.maxHops !== undefined && (typeof params.maxHops !== 'number' || params.maxHops < 1)) {
            return 'Invalid "maxHops" parameter (must be positive number)';
        }
        return true;
    },

    async execute(params, db): Promise<QueryResponse> {
        const from = params.from as string;
        const to = params.to as string;
        const maxHops = (params.maxHops as number) || 5;

        // BFS to find shortest path
        const paths = await findPaths(from, to, maxHops, db as any);

        return {
            results: paths.map((path, index) => ({
                type: 'path',
                id: `path-${index}`,
                label: `Path (${path.length - 1} hops)`,
                description: path.join(' → '),
                score: 1 / path.length, // Shorter paths score higher
                data: { path, hops: path.length - 1 }
            })),
            totalCount: paths.length,
            metadata: { from, to, maxHops }
        };
    },

    getParamSchema() {
        return {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Source file path' },
                to: { type: 'string', description: 'Target file path' },
                maxHops: { type: 'number', description: 'Maximum path length', default: 5 }
            },
            required: ['from', 'to']
        };
    }
};

/**
 * Related files query provider - finds files related to a given file
 */
export const relatedFilesProvider: QueryProvider = {
    queryType: 'related-files',
    name: 'Related Files Finder',
    description: 'Find files related to a given file based on shared links, tags, or content',
    capabilities: {
        supportsPagination: true,
        supportsRanking: true,
        maxResults: 50
    },

    validate(params) {
        if (!params.filePath || typeof params.filePath !== 'string') {
            return 'Missing or invalid "filePath" parameter';
        }
        return true;
    },

    async execute(params, db): Promise<QueryResponse> {
        const filePath = params.filePath as string;
        const limit = (params.limit as number) || 20;

        const related = await findRelatedFiles(filePath, limit, db as any);

        return {
            results: related,
            totalCount: related.length,
            metadata: { filePath }
        };
    }
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * BFS to find paths between files
 */
async function findPaths(
    from: string,
    to: string,
    maxHops: number,
    db: { execute: (opts: { sql: string; args: unknown[] }) => Promise<{ rows: any[] }> }
): Promise<string[][]> {
    const visited = new Set<string>();
    const queue: Array<{ path: string[]; depth: number }> = [{ path: [from], depth: 0 }];
    const paths: string[][] = [];

    while (queue.length > 0 && paths.length < 10) {
        const { path, depth } = queue.shift()!;
        const current = path[path.length - 1];

        if (current === to) {
            paths.push(path);
            continue;
        }

        if (depth >= maxHops) {
            continue;
        }

        if (visited.has(current)) {
            continue;
        }
        visited.add(current);

        // Get neighbors (files this file links to)
        try {
            const result = await db.execute({
                sql: `SELECT DISTINCT target FROM links
                      WHERE file_path = ? AND link_type = 'file'
                      AND target IN (SELECT path FROM files)`,
                args: [current]
            });

            for (const row of result.rows) {
                const target = row.target as string;
                if (!path.includes(target)) {
                    queue.push({ path: [...path, target], depth: depth + 1 });
                }
            }
        } catch {
            // Ignore errors, just skip this node
        }
    }

    return paths;
}

/**
 * Find files related to a given file
 */
async function findRelatedFiles(
    filePath: string,
    limit: number,
    db: { execute: (opts: { sql: string; args: unknown[] }) => Promise<{ rows: any[] }> }
): Promise<QueryResult[]> {
    const results: QueryResult[] = [];
    const scores = new Map<string, number>();

    try {
        // Files that this file links to (outgoing)
        const outgoing = await db.execute({
            sql: `SELECT target, COUNT(*) as count FROM links
                  WHERE file_path = ? AND link_type = 'file'
                  AND target IN (SELECT path FROM files)
                  GROUP BY target`,
            args: [filePath]
        });

        for (const row of outgoing.rows) {
            const target = row.target as string;
            const count = row.count as number;
            scores.set(target, (scores.get(target) || 0) + count * 2);
        }

        // Files that link to this file (incoming/backlinks)
        const incoming = await db.execute({
            sql: `SELECT file_path, COUNT(*) as count FROM links
                  WHERE target LIKE ? AND link_type = 'file'
                  GROUP BY file_path`,
            args: [`%${filePath.split('/').pop()}`]
        });

        for (const row of incoming.rows) {
            const source = row.file_path as string;
            const count = row.count as number;
            if (source !== filePath) {
                scores.set(source, (scores.get(source) || 0) + count * 2);
            }
        }

        // Files with shared tags
        const tagsResult = await db.execute({
            sql: `SELECT tags FROM headings WHERE file_path = ? AND tags != '[]'`,
            args: [filePath]
        });

        const fileTags = new Set<string>();
        for (const row of tagsResult.rows) {
            try {
                const tags = JSON.parse(row.tags as string) as string[];
                tags.forEach(t => fileTags.add(t));
            } catch { /* ignore */ }
        }

        if (fileTags.size > 0) {
            const tagArray = Array.from(fileTags);
            for (const tag of tagArray) {
                const taggedFiles = await db.execute({
                    sql: `SELECT DISTINCT file_path FROM headings
                          WHERE tags LIKE ? AND file_path != ?`,
                    args: [`%"${tag}"%`, filePath]
                });

                for (const row of taggedFiles.rows) {
                    const fp = row.file_path as string;
                    scores.set(fp, (scores.get(fp) || 0) + 1);
                }
            }
        }

        // Sort by score and convert to results
        const sorted = Array.from(scores.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit);

        for (const [fp, score] of sorted) {
            const fileName = fp.split('/').pop() || fp;
            results.push({
                type: 'file',
                id: fp,
                label: fileName,
                description: fp,
                score: score / 10, // Normalize
                data: { filePath: fp, relationScore: score }
            });
        }
    } catch (error) {
        console.error('Error finding related files:', error);
    }

    return results;
}
