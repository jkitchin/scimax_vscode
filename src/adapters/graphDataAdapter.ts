/**
 * Graph Data Provider Adapter
 *
 * Provides extension points for enriching graph visualizations with custom data.
 * Plugins can register adapters to add custom node properties, edge properties,
 * or entirely new edges beyond the standard file links.
 *
 * This enables building knowledge graphs with computed properties, importance
 * scores, clusters, or semantic relationships derived from content analysis.
 */

import * as vscode from 'vscode';
import type { GraphNode, GraphEdge } from '../linkGraph/linkGraphQueries';

/**
 * Context for graph data operations
 */
export interface GraphDataContext {
    /** Center file of the graph */
    centerFile: string;
    /** Current traversal depth */
    depth: number;
    /** Maximum depth */
    maxDepth: number;
    /** Direction of traversal */
    direction: 'incoming' | 'outgoing' | 'both';
    /** Database client */
    db: unknown;
}

/**
 * Additional properties that can be added to nodes
 */
export interface NodeEnrichment {
    /** Custom properties to merge with node */
    properties?: Record<string, unknown>;
    /** Override node label */
    label?: string;
    /** Override node color */
    color?: string;
    /** Override node size */
    size?: number;
    /** Node shape (dot, square, triangle, star, etc.) */
    shape?: string;
    /** Custom tooltip content */
    tooltip?: string;
    /** Group/cluster identifier */
    group?: string;
    /** Importance score (affects layout) */
    importance?: number;
}

/**
 * Additional properties that can be added to edges
 */
export interface EdgeEnrichment {
    /** Custom properties to merge with edge */
    properties?: Record<string, unknown>;
    /** Override edge label */
    label?: string;
    /** Override edge color */
    color?: string;
    /** Edge width */
    width?: number;
    /** Edge style (solid, dashed, dotted) */
    style?: 'solid' | 'dashed' | 'dotted';
    /** Weight for layout algorithms */
    weight?: number;
}

/**
 * A custom edge to add to the graph
 */
export interface CustomEdge {
    /** Source node ID (file path) */
    from: string;
    /** Target node ID (file path) */
    to: string;
    /** Relationship type */
    type: string;
    /** Edge label */
    label?: string;
    /** Edge color */
    color?: string;
    /** Edge width */
    width?: number;
    /** Edge style */
    style?: 'solid' | 'dashed' | 'dotted';
    /** Custom properties */
    properties?: Record<string, unknown>;
}

/**
 * Graph data provider interface
 */
export interface GraphDataProvider {
    /** Unique identifier for this provider */
    id: string;

    /** Human-readable name */
    name: string;

    /** Description of what this provider adds */
    description?: string;

    /** Priority for ordering (higher runs first, default 0) */
    priority?: number;

    /**
     * Enrich a node with additional data
     * @param node The graph node to enrich
     * @param context Graph context
     * @returns Enrichment data or undefined to skip
     */
    enrichNode?(node: GraphNode, context: GraphDataContext): Promise<NodeEnrichment | undefined>;

    /**
     * Enrich an edge with additional data
     * @param edge The graph edge to enrich
     * @param context Graph context
     * @returns Enrichment data or undefined to skip
     */
    enrichEdge?(edge: GraphEdge, context: GraphDataContext): Promise<EdgeEnrichment | undefined>;

    /**
     * Get custom edges to add to the graph
     * These are edges beyond the standard file links (e.g., semantic relationships)
     * @param filePath File to get custom edges for
     * @param context Graph context
     * @returns Array of custom edges
     */
    getCustomEdges?(filePath: string, context: GraphDataContext): Promise<CustomEdge[]>;

    /**
     * Filter nodes from the graph
     * @param node Node to check
     * @param context Graph context
     * @returns true to include, false to exclude
     */
    filterNode?(node: GraphNode, context: GraphDataContext): boolean;

    /**
     * Filter edges from the graph
     * @param edge Edge to check
     * @param context Graph context
     * @returns true to include, false to exclude
     */
    filterEdge?(edge: GraphEdge, context: GraphDataContext): boolean;
}

/**
 * Result of applying all graph data providers
 */
export interface GraphEnrichmentResult {
    /** Node enrichments by node ID */
    nodeEnrichments: Map<string, NodeEnrichment>;
    /** Edge enrichments by edge key (from:to) */
    edgeEnrichments: Map<string, EdgeEnrichment>;
    /** Custom edges to add */
    customEdges: CustomEdge[];
    /** Nodes to filter out */
    filteredNodes: Set<string>;
    /** Edges to filter out (key: from:to) */
    filteredEdges: Set<string>;
    /** Any errors that occurred */
    errors: Array<{ providerId: string; error: Error }>;
}

/**
 * Registry for graph data providers
 */
class GraphDataProviderRegistry {
    /** @internal */
    readonly providers: Map<string, GraphDataProvider> = new Map();

    /**
     * Register a new graph data provider
     */
    register(provider: GraphDataProvider): vscode.Disposable {
        if (!provider.id) {
            throw new Error('Graph data provider must have an id');
        }
        if (this.providers.has(provider.id)) {
            throw new Error(`Graph data provider with id '${provider.id}' is already registered`);
        }

        this.providers.set(provider.id, provider);

        return new vscode.Disposable(() => {
            this.providers.delete(provider.id);
        });
    }

    /**
     * Unregister a provider by id
     */
    unregister(id: string): boolean {
        return this.providers.delete(id);
    }

    /**
     * Get all registered providers sorted by priority (higher first)
     */
    getProviders(): GraphDataProvider[] {
        return Array.from(this.providers.values())
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }

    /**
     * Get a specific provider by id
     */
    getProvider(id: string): GraphDataProvider | undefined {
        return this.providers.get(id);
    }

    /**
     * Check if a provider is registered
     */
    hasProvider(id: string): boolean {
        return this.providers.has(id);
    }

    /**
     * Get all provider ids
     */
    getProviderIds(): string[] {
        return Array.from(this.providers.keys());
    }

    /**
     * Apply all providers to enrich graph data
     */
    async applyProviders(
        nodes: GraphNode[],
        edges: GraphEdge[],
        context: GraphDataContext
    ): Promise<GraphEnrichmentResult> {
        const result: GraphEnrichmentResult = {
            nodeEnrichments: new Map(),
            edgeEnrichments: new Map(),
            customEdges: [],
            filteredNodes: new Set(),
            filteredEdges: new Set(),
            errors: []
        };

        const providers = this.getProviders();

        for (const provider of providers) {
            try {
                // Enrich nodes
                if (provider.enrichNode) {
                    for (const node of nodes) {
                        try {
                            const enrichment = await provider.enrichNode(node, context);
                            if (enrichment) {
                                const existing = result.nodeEnrichments.get(node.id) || {};
                                result.nodeEnrichments.set(node.id, {
                                    ...existing,
                                    ...enrichment,
                                    properties: {
                                        ...existing.properties,
                                        ...enrichment.properties
                                    }
                                });
                            }
                        } catch (error) {
                            result.errors.push({
                                providerId: provider.id,
                                error: error as Error
                            });
                        }
                    }
                }

                // Filter nodes
                if (provider.filterNode) {
                    for (const node of nodes) {
                        if (!provider.filterNode(node, context)) {
                            result.filteredNodes.add(node.id);
                        }
                    }
                }

                // Enrich edges
                if (provider.enrichEdge) {
                    for (const edge of edges) {
                        try {
                            const enrichment = await provider.enrichEdge(edge, context);
                            if (enrichment) {
                                const key = `${edge.from}:${edge.to}`;
                                const existing = result.edgeEnrichments.get(key) || {};
                                result.edgeEnrichments.set(key, {
                                    ...existing,
                                    ...enrichment,
                                    properties: {
                                        ...existing.properties,
                                        ...enrichment.properties
                                    }
                                });
                            }
                        } catch (error) {
                            result.errors.push({
                                providerId: provider.id,
                                error: error as Error
                            });
                        }
                    }
                }

                // Filter edges
                if (provider.filterEdge) {
                    for (const edge of edges) {
                        if (!provider.filterEdge(edge, context)) {
                            result.filteredEdges.add(`${edge.from}:${edge.to}`);
                        }
                    }
                }

                // Get custom edges
                if (provider.getCustomEdges) {
                    for (const node of nodes) {
                        try {
                            const customEdges = await provider.getCustomEdges(node.id, context);
                            result.customEdges.push(...customEdges);
                        } catch (error) {
                            result.errors.push({
                                providerId: provider.id,
                                error: error as Error
                            });
                        }
                    }
                }
            } catch (error) {
                result.errors.push({
                    providerId: provider.id,
                    error: error as Error
                });
                console.error(`Graph data provider '${provider.id}' failed:`, error);
            }
        }

        return result;
    }

    /**
     * Clear all providers (for testing)
     */
    clear(): void {
        this.providers.clear();
    }
}

/**
 * Global graph data provider registry instance
 */
export const graphDataRegistry = new GraphDataProviderRegistry();

/**
 * Register a graph data provider
 * @returns Disposable that unregisters the provider when disposed
 */
export function registerGraphDataProvider(provider: GraphDataProvider): vscode.Disposable {
    return graphDataRegistry.register(provider);
}

// ============================================================================
// Built-in Providers
// ============================================================================

/**
 * Link count importance provider - sizes nodes by their link count
 */
export const linkCountImportanceProvider: GraphDataProvider = {
    id: 'link-count-importance',
    name: 'Link Count Importance',
    description: 'Sizes nodes based on their incoming and outgoing link count',
    priority: -10, // Run last so other providers can override

    async enrichNode(node, context) {
        // Use existing metadata if available
        const incomingLinks = node.metadata?.incomingLinks ?? 0;
        const outgoingLinks = node.metadata?.outgoingLinks ?? 0;
        const totalLinks = (incomingLinks as number) + (outgoingLinks as number);

        // Scale size based on link count (10-50 range)
        const size = Math.min(50, Math.max(10, 10 + Math.log2(totalLinks + 1) * 10));

        return {
            size,
            importance: totalLinks,
            properties: {
                linkCount: totalLinks,
                incomingLinks,
                outgoingLinks
            }
        };
    }
};

/**
 * Recency coloring provider - colors nodes by modification time
 */
export const recencyColoringProvider: GraphDataProvider = {
    id: 'recency-coloring',
    name: 'Recency Coloring',
    description: 'Colors nodes based on how recently they were modified',
    priority: -10,

    async enrichNode(node, context) {
        const mtime = node.metadata?.mtime as number | undefined;
        if (!mtime) {
            return undefined;
        }

        const now = Date.now();
        const age = now - mtime;
        const dayMs = 24 * 60 * 60 * 1000;

        // Color based on age
        let color: string;
        if (age < dayMs) {
            color = '#4caf50'; // Green - modified today
        } else if (age < 7 * dayMs) {
            color = '#2196f3'; // Blue - modified this week
        } else if (age < 30 * dayMs) {
            color = '#ff9800'; // Orange - modified this month
        } else {
            color = '#9e9e9e'; // Gray - older
        }

        return {
            color,
            properties: {
                ageInDays: Math.floor(age / dayMs),
                lastModified: new Date(mtime).toISOString()
            }
        };
    }
};
