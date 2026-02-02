/**
 * Link Graph Query Service
 *
 * Provides SQL queries and data structures for building file link graphs.
 * Supports filtering by file metadata, heading properties, tags, TODO states, etc.
 */

import type { Client } from '@libsql/client';
import { databaseLogger as log } from '../utils/logger';
import { graphDataRegistry, type GraphDataContext, type CustomEdge } from '../adapters/graphDataAdapter';

/**
 * Filters for graph queries
 */
export interface LinkGraphFilters {
    // File-level filters
    fileTypes?: ('org' | 'md')[];
    modifiedAfter?: number;      // timestamp ms
    modifiedBefore?: number;
    projectIds?: number[];

    // Heading-level filters
    tags?: string[];             // ANY of these tags
    excludeTags?: string[];      // NONE of these tags
    todoStates?: string[];       // 'TODO', 'NEXT', etc.
    excludeDone?: boolean;       // Exclude DONE/CANCELLED
    priorities?: string[];       // 'A', 'B', 'C'
    hasDeadline?: boolean;
    hasScheduled?: boolean;
    deadlineWithinDays?: number; // Upcoming deadlines

    // Property filters
    properties?: Record<string, string>;

    // Link-level filters
    linkTypes?: string[];        // 'file', 'id', 'cite', etc.
}

/**
 * Graph node representing a file
 */
export interface GraphNode {
    id: string;                  // file path
    label: string;               // filename
    title: string;               // hover tooltip HTML
    level: number;               // distance from center (0 = center)
    isCenter: boolean;
    fileType: 'org' | 'md';
    mtime: number;

    // Aggregated metadata for display
    headingCount: number;
    todoCount: number;
    linkCount: number;
    hasUpcomingDeadline: boolean;
    topTags: string[];

    // Extension point: custom metadata from graph data providers
    metadata?: Record<string, unknown>;
}

/**
 * Graph edge representing a link between files
 */
export interface GraphEdge {
    id: string;                  // unique edge id
    from: string;                // source file path
    to: string;                  // target file path
    linkType: string;
    count: number;               // number of links (for edge thickness)
    title: string;               // hover tooltip
    arrows: 'to';

    // Extension point: custom metadata from graph data providers
    metadata?: Record<string, unknown>;
}

/**
 * Complete graph data for visualization
 */
export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
    truncated: boolean;          // true if max nodes reached
    totalEdges: number;
}

/**
 * File metadata for node building
 */
interface FileMetadata {
    fileType: 'org' | 'md';
    mtime: number;
    headingCount: number;
    todoCount: number;
    linkCount: number;
    hasUpcomingDeadline: boolean;
    topTags: string[];
}

/**
 * Link Graph Query Service
 * Builds graph data from the database for visualization
 */
export class LinkGraphQueryService {
    constructor(private db: Client) {}

    /**
     * Build graph data starting from a center file
     */
    async buildGraph(
        centerFile: string,
        depth: number,
        direction: 'both' | 'outgoing' | 'incoming',
        filters: LinkGraphFilters,
        maxNodes: number = 100
    ): Promise<GraphData> {
        log.debug('Building link graph', { centerFile, depth, direction, maxNodes });

        // Step 1: Get all connected files up to depth
        const connectedFiles = await this.getConnectedFiles(
            centerFile, depth, direction, filters
        );

        log.debug('Found connected files', { count: connectedFiles.size });

        // Step 2: Build nodes with metadata
        const nodes = await this.buildNodes(centerFile, connectedFiles, filters);

        // Step 3: Build edges between nodes
        const edges = await this.buildEdges(
            nodes.map(n => n.id),
            direction,
            filters
        );

        // Step 4: Apply graph data providers for enrichment
        let enrichedNodes = nodes;
        let enrichedEdges = edges;

        if (graphDataRegistry.getProviders().length > 0) {
            const graphContext: GraphDataContext = {
                centerFile,
                depth,
                maxDepth: depth,
                direction,
                db: this.db
            };

            try {
                const enrichment = await graphDataRegistry.applyProviders(
                    nodes,
                    edges,
                    graphContext
                );

                // Apply node enrichments
                enrichedNodes = nodes
                    .filter(n => !enrichment.filteredNodes.has(n.id))
                    .map(node => {
                        const nodeEnrich = enrichment.nodeEnrichments.get(node.id);
                        if (!nodeEnrich) return node;

                        return {
                            ...node,
                            label: nodeEnrich.label ?? node.label,
                            // Store enrichment data in metadata for webview
                            metadata: {
                                ...node.metadata,
                                ...nodeEnrich.properties,
                                enrichedColor: nodeEnrich.color,
                                enrichedSize: nodeEnrich.size,
                                enrichedShape: nodeEnrich.shape,
                                importance: nodeEnrich.importance,
                                group: nodeEnrich.group
                            }
                        };
                    });

                // Apply edge enrichments
                enrichedEdges = edges
                    .filter(e => !enrichment.filteredEdges.has(`${e.from}:${e.to}`))
                    .map(edge => {
                        const edgeEnrich = enrichment.edgeEnrichments.get(`${edge.from}:${edge.to}`);
                        if (!edgeEnrich) return edge;

                        return {
                            ...edge,
                            title: edgeEnrich.label ?? edge.title,
                            // Store enrichment data for webview
                            metadata: {
                                ...edgeEnrich.properties,
                                enrichedColor: edgeEnrich.color,
                                enrichedWidth: edgeEnrich.width,
                                enrichedStyle: edgeEnrich.style
                            }
                        };
                    });

                // Add custom edges from providers
                for (const customEdge of enrichment.customEdges) {
                    enrichedEdges.push({
                        id: `custom-${customEdge.from}-${customEdge.to}-${customEdge.type}`,
                        from: customEdge.from,
                        to: customEdge.to,
                        linkType: customEdge.type,
                        count: 1,
                        title: customEdge.label || customEdge.type,
                        arrows: 'to',
                        metadata: {
                            isCustom: true,
                            customType: customEdge.type,
                            ...customEdge.properties
                        }
                    } as GraphEdge);
                }

                // Log any errors from providers
                for (const err of enrichment.errors) {
                    log.warn('Graph data provider error', { providerId: err.providerId, error: err.error.message });
                }
            } catch (providerError) {
                log.warn('Graph data providers failed', { error: (providerError as Error).message });
            }
        }

        // Step 5: Truncate if needed
        const truncated = enrichedNodes.length > maxNodes;
        const finalNodes = truncated ? enrichedNodes.slice(0, maxNodes) : enrichedNodes;
        const nodeIds = new Set(finalNodes.map(n => n.id));
        const finalEdges = enrichedEdges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));

        log.debug('Graph built', {
            nodes: finalNodes.length,
            edges: finalEdges.length,
            truncated
        });

        return {
            nodes: finalNodes,
            edges: finalEdges,
            truncated,
            totalEdges: enrichedEdges.length
        };
    }

    /**
     * Get all files connected within depth, applying filters
     */
    private async getConnectedFiles(
        centerFile: string,
        depth: number,
        direction: 'both' | 'outgoing' | 'incoming',
        filters: LinkGraphFilters
    ): Promise<Map<string, number>> {  // file path -> depth level
        const visited = new Map<string, number>();
        visited.set(centerFile, 0);

        let frontier = [centerFile];

        for (let currentDepth = 0; currentDepth < depth; currentDepth++) {
            const nextFrontier: string[] = [];

            for (const file of frontier) {
                // Get outgoing links
                if (direction !== 'incoming') {
                    const outgoing = await this.getFilteredLinksFrom(file, filters);
                    for (const target of outgoing) {
                        if (!visited.has(target)) {
                            visited.set(target, currentDepth + 1);
                            nextFrontier.push(target);
                        }
                    }
                }

                // Get incoming links (backlinks)
                if (direction !== 'outgoing') {
                    const incoming = await this.getFilteredLinksTo(file, filters);
                    for (const source of incoming) {
                        if (!visited.has(source)) {
                            visited.set(source, currentDepth + 1);
                            nextFrontier.push(source);
                        }
                    }
                }
            }

            frontier = nextFrontier;
            if (frontier.length === 0) break;
        }

        return visited;
    }

    /**
     * Get outgoing file links with filters applied
     */
    private async getFilteredLinksFrom(
        filePath: string,
        filters: LinkGraphFilters
    ): Promise<string[]> {
        const conditions: string[] = ['l.file_path = ?'];
        const args: any[] = [filePath];

        // Add filter conditions
        this.addFilterConditions(conditions, args, filters);

        const sql = `
            SELECT DISTINCT l.target
            FROM links l
            LEFT JOIN files f ON l.target = f.path
            LEFT JOIN headings h ON l.heading_id = h.id
            WHERE ${conditions.join(' AND ')}
              AND f.id IS NOT NULL
        `;

        try {
            const result = await this.db.execute({ sql, args });
            return result.rows.map((r: any) => r.target as string);
        } catch (e) {
            log.error('Error getting outgoing links', e as Error, { filePath });
            return [];
        }
    }

    /**
     * Get incoming file links (backlinks) with filters applied
     */
    private async getFilteredLinksTo(
        filePath: string,
        filters: LinkGraphFilters
    ): Promise<string[]> {
        // Match exact path or path with search string suffix
        const conditions: string[] = [
            "(l.target = ? OR l.target LIKE ? OR l.target LIKE ?)"
        ];
        const fileName = filePath.split('/').pop() || filePath;
        const args: any[] = [filePath, `%${filePath}`, `%${fileName}::%`];

        this.addFilterConditions(conditions, args, filters);

        const sql = `
            SELECT DISTINCT l.file_path
            FROM links l
            LEFT JOIN files f ON l.file_path = f.path
            LEFT JOIN headings h ON l.heading_id = h.id
            WHERE ${conditions.join(' AND ')}
              AND f.id IS NOT NULL
        `;

        try {
            const result = await this.db.execute({ sql, args });
            return result.rows.map((r: any) => r.file_path as string);
        } catch (e) {
            log.error('Error getting incoming links', e as Error, { filePath });
            return [];
        }
    }

    /**
     * Add filter conditions to query
     */
    private addFilterConditions(
        conditions: string[],
        args: any[],
        filters: LinkGraphFilters
    ): void {
        // Default to file links only
        const linkTypes = filters.linkTypes?.length ? filters.linkTypes : ['file'];
        conditions.push(`l.link_type IN (${linkTypes.map(() => '?').join(',')})`);
        args.push(...linkTypes);

        // File type filter
        if (filters.fileTypes?.length) {
            conditions.push(`(f.file_type IS NULL OR f.file_type IN (${filters.fileTypes.map(() => '?').join(',')}))`);
            args.push(...filters.fileTypes);
        }

        // Modification time filters
        if (filters.modifiedAfter) {
            conditions.push('(f.mtime IS NULL OR f.mtime > ?)');
            args.push(filters.modifiedAfter);
        }
        if (filters.modifiedBefore) {
            conditions.push('(f.mtime IS NULL OR f.mtime < ?)');
            args.push(filters.modifiedBefore);
        }

        // Project filter
        if (filters.projectIds?.length) {
            conditions.push(`(f.project_id IS NULL OR f.project_id IN (${filters.projectIds.map(() => '?').join(',')}))`);
            args.push(...filters.projectIds);
        }

        // Tag filters (requires heading association)
        if (filters.tags?.length) {
            const tagConditions = filters.tags.map(() => "h.tags LIKE ?");
            conditions.push(`(h.id IS NULL OR (${tagConditions.join(' OR ')}))`);
            args.push(...filters.tags.map(t => `%"${t}"%`));
        }

        if (filters.excludeTags?.length) {
            for (const tag of filters.excludeTags) {
                conditions.push("(h.id IS NULL OR h.tags NOT LIKE ?)");
                args.push(`%"${tag}"%`);
            }
        }

        // TODO state filters
        if (filters.todoStates?.length) {
            conditions.push(`(h.id IS NULL OR h.todo_state IN (${filters.todoStates.map(() => '?').join(',')}))`);
            args.push(...filters.todoStates);
        }

        if (filters.excludeDone) {
            conditions.push("(h.id IS NULL OR h.todo_state IS NULL OR h.todo_state NOT IN ('DONE', 'CANCELLED'))");
        }

        // Priority filter
        if (filters.priorities?.length) {
            conditions.push(`(h.id IS NULL OR h.priority IN (${filters.priorities.map(() => '?').join(',')}))`);
            args.push(...filters.priorities);
        }

        // Deadline filters
        if (filters.hasDeadline) {
            conditions.push("h.deadline IS NOT NULL");
        }

        if (filters.deadlineWithinDays !== undefined) {
            const futureDate = Date.now() + (filters.deadlineWithinDays * 24 * 60 * 60 * 1000);
            conditions.push("(h.deadline IS NOT NULL AND h.deadline <= ?)");
            args.push(new Date(futureDate).toISOString().split('T')[0]);
        }

        // Scheduled filter
        if (filters.hasScheduled) {
            conditions.push("h.scheduled IS NOT NULL");
        }

        // Property filters
        if (filters.properties) {
            for (const [key, value] of Object.entries(filters.properties)) {
                conditions.push("(h.id IS NULL OR json_extract(h.properties, ?) = ?)");
                args.push(`$.${key}`, value);
            }
        }
    }

    /**
     * Build node objects with metadata
     */
    private async buildNodes(
        centerFile: string,
        connectedFiles: Map<string, number>,
        _filters: LinkGraphFilters
    ): Promise<GraphNode[]> {
        const nodes: GraphNode[] = [];

        for (const [filePath, level] of connectedFiles) {
            const metadata = await this.getFileMetadata(filePath);

            nodes.push({
                id: filePath,
                label: this.getFileName(filePath),
                title: this.buildTooltip(filePath, metadata),
                level,
                isCenter: filePath === centerFile,
                fileType: metadata.fileType,
                mtime: metadata.mtime,
                headingCount: metadata.headingCount,
                todoCount: metadata.todoCount,
                linkCount: metadata.linkCount,
                hasUpcomingDeadline: metadata.hasUpcomingDeadline,
                topTags: metadata.topTags
            });
        }

        // Sort by level, then by link count (most connected first)
        nodes.sort((a, b) => {
            if (a.level !== b.level) return a.level - b.level;
            return b.linkCount - a.linkCount;
        });

        return nodes;
    }

    /**
     * Get metadata for a file
     */
    private async getFileMetadata(filePath: string): Promise<FileMetadata> {
        try {
            // File info
            const fileResult = await this.db.execute({
                sql: 'SELECT file_type, mtime FROM files WHERE path = ?',
                args: [filePath]
            });
            const file = fileResult.rows[0];

            // Heading stats
            const headingResult = await this.db.execute({
                sql: `SELECT
                        COUNT(*) as total,
                        SUM(CASE WHEN todo_state IS NOT NULL AND todo_state NOT IN ('DONE', 'CANCELLED') THEN 1 ELSE 0 END) as todos,
                        SUM(CASE WHEN deadline IS NOT NULL AND deadline > date('now') AND deadline < date('now', '+7 days') THEN 1 ELSE 0 END) as upcoming
                      FROM headings WHERE file_path = ?`,
                args: [filePath]
            });
            const headings = headingResult.rows[0];

            // Link count (outgoing)
            const linkResult = await this.db.execute({
                sql: 'SELECT COUNT(*) as count FROM links WHERE file_path = ?',
                args: [filePath]
            });

            // Top tags
            const tagResult = await this.db.execute({
                sql: `SELECT tags FROM headings WHERE file_path = ? AND tags != '[]'`,
                args: [filePath]
            });
            const allTags = tagResult.rows
                .flatMap((r: any) => {
                    try {
                        return JSON.parse(r.tags as string) as string[];
                    } catch {
                        return [];
                    }
                });
            const tagCounts = new Map<string, number>();
            for (const tag of allTags) {
                tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            }
            const topTags = [...tagCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([tag]) => tag);

            return {
                fileType: (file?.file_type || 'org') as 'org' | 'md',
                mtime: (file?.mtime || 0) as number,
                headingCount: (headings?.total || 0) as number,
                todoCount: (headings?.todos || 0) as number,
                linkCount: (linkResult.rows[0]?.count || 0) as number,
                hasUpcomingDeadline: ((headings?.upcoming || 0) as number) > 0,
                topTags
            };
        } catch (e) {
            log.error('Error getting file metadata', e as Error, { filePath });
            return {
                fileType: 'org',
                mtime: 0,
                headingCount: 0,
                todoCount: 0,
                linkCount: 0,
                hasUpcomingDeadline: false,
                topTags: []
            };
        }
    }

    /**
     * Build edges between nodes
     */
    private async buildEdges(
        nodePaths: string[],
        direction: 'both' | 'outgoing' | 'incoming',
        filters: LinkGraphFilters
    ): Promise<GraphEdge[]> {
        if (nodePaths.length === 0) return [];

        const nodeSet = new Set(nodePaths);
        const edgeMap = new Map<string, GraphEdge>();

        // Default to file links
        const linkTypes = filters.linkTypes?.length ? filters.linkTypes : ['file'];

        // Build placeholders for IN clause
        const placeholders = nodePaths.map(() => '?').join(',');
        const linkTypePlaceholders = linkTypes.map(() => '?').join(',');

        const sql = `
            SELECT l.file_path, l.target, l.link_type, COUNT(*) as count
            FROM links l
            WHERE l.file_path IN (${placeholders})
              AND l.link_type IN (${linkTypePlaceholders})
            GROUP BY l.file_path, l.target, l.link_type
        `;

        const args = [...nodePaths, ...linkTypes];

        try {
            const result = await this.db.execute({ sql, args });

            for (const row of result.rows) {
                const from = row.file_path as string;
                const to = row.target as string;

                // Only include edges where both endpoints are in our node set
                // For target, we need to check if it matches any node (could be partial path)
                const toNode = this.findMatchingNode(to, nodeSet);
                if (!toNode) continue;
                if (!nodeSet.has(from)) continue;

                if (direction === 'outgoing' && !nodePaths.includes(from)) continue;
                if (direction === 'incoming' && !nodePaths.includes(toNode)) continue;

                const edgeKey = `${from}|${toNode}|${row.link_type}`;

                if (!edgeMap.has(edgeKey)) {
                    edgeMap.set(edgeKey, {
                        id: edgeKey,
                        from,
                        to: toNode,
                        linkType: row.link_type as string,
                        count: row.count as number,
                        title: `${row.count} link(s)`,
                        arrows: 'to'
                    });
                } else {
                    // Aggregate counts for same edge
                    const existing = edgeMap.get(edgeKey)!;
                    existing.count += row.count as number;
                    existing.title = `${existing.count} link(s)`;
                }
            }
        } catch (e) {
            log.error('Error building edges', e as Error);
        }

        return [...edgeMap.values()];
    }

    /**
     * Find a matching node for a link target
     * Link targets may be partial paths or include search strings
     */
    private findMatchingNode(target: string, nodeSet: Set<string>): string | null {
        // Exact match
        if (nodeSet.has(target)) return target;

        // Check if target ends with any node's filename
        for (const node of nodeSet) {
            const nodeName = node.split('/').pop() || node;
            if (target.endsWith(nodeName) || target.startsWith(nodeName)) {
                return node;
            }
            // Handle targets like "file.org::*Heading"
            if (target.includes('::')) {
                const [filePart] = target.split('::');
                if (node.endsWith(filePart) || filePart.endsWith(nodeName)) {
                    return node;
                }
            }
        }

        return null;
    }

    /**
     * Get just the filename from a path
     */
    private getFileName(filePath: string): string {
        return filePath.split('/').pop() || filePath;
    }

    /**
     * Build HTML tooltip for a node
     */
    private buildTooltip(filePath: string, metadata: FileMetadata): string {
        const deadlineIcon = metadata.hasUpcomingDeadline ? '⚠️ ' : '';
        const tags = metadata.topTags.length > 0
            ? `\n🏷️ ${metadata.topTags.map((t: string) => ':' + t + ':').join(' ')}`
            : '';
        const modDate = metadata.mtime
            ? new Date(metadata.mtime).toLocaleDateString()
            : 'Unknown';

        return `<b>${this.getFileName(filePath)}</b>${deadlineIcon ? ' ' + deadlineIcon : ''}
<hr>
📁 ${filePath}
📑 ${metadata.headingCount} headings
☐ ${metadata.todoCount} active TODOs
🔗 ${metadata.linkCount} links
📅 ${modDate}${tags}`.trim();
    }

    /**
     * Get simple link statistics for a file
     */
    async getLinkStats(filePath: string): Promise<{
        outgoing: number;
        incoming: number;
        outgoingByType: Record<string, number>;
    }> {
        try {
            // Outgoing links
            const outResult = await this.db.execute({
                sql: 'SELECT link_type, COUNT(*) as count FROM links WHERE file_path = ? GROUP BY link_type',
                args: [filePath]
            });

            const outgoingByType: Record<string, number> = {};
            let outgoing = 0;
            for (const row of outResult.rows) {
                outgoingByType[row.link_type as string] = row.count as number;
                outgoing += row.count as number;
            }

            // Incoming links (backlinks)
            const fileName = filePath.split('/').pop() || filePath;
            const inResult = await this.db.execute({
                sql: `SELECT COUNT(DISTINCT file_path) as count FROM links
                      WHERE target = ? OR target LIKE ? OR target LIKE ?`,
                args: [filePath, `%${filePath}`, `%${fileName}::%`]
            });

            const incoming = (inResult.rows[0]?.count || 0) as number;

            return { outgoing, incoming, outgoingByType };
        } catch (e) {
            log.error('Error getting link stats', e as Error, { filePath });
            return { outgoing: 0, incoming: 0, outgoingByType: {} };
        }
    }
}
