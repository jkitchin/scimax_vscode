/**
 * Tests for GraphDataProviderAdapter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    graphDataRegistry,
    GraphDataProvider,
    GraphDataContext,
    NodeEnrichment,
    EdgeEnrichment
} from '../graphDataAdapter';

// Mock vscode
vi.mock('vscode', () => ({
    Disposable: class {
        constructor(private callback: () => void) {}
        dispose() { this.callback(); }
    }
}));

// Mock GraphNode and GraphEdge types
interface MockGraphNode {
    id: string;
    label: string;
    title: string;
    level: number;
    isCenter: boolean;
    fileType: 'org' | 'md';
    mtime: number;
    headingCount: number;
    todoCount: number;
    linkCount: number;
    hasUpcomingDeadline: boolean;
    topTags: string[];
    metadata?: Record<string, unknown>;
}

interface MockGraphEdge {
    id: string;
    from: string;
    to: string;
    linkType: string;
    count: number;
    title: string;
    arrows: 'to';
    metadata?: Record<string, unknown>;
}

describe('GraphDataProviderRegistry', () => {
    beforeEach(() => {
        graphDataRegistry.clear();
    });

    const createMockNode = (id: string): MockGraphNode => ({
        id,
        label: id.split('/').pop() || id,
        title: id,
        level: 0,
        isCenter: false,
        fileType: 'org',
        mtime: Date.now(),
        headingCount: 5,
        todoCount: 2,
        linkCount: 3,
        hasUpcomingDeadline: false,
        topTags: ['project']
    });

    const createMockEdge = (from: string, to: string): MockGraphEdge => ({
        id: `${from}->${to}`,
        from,
        to,
        linkType: 'file',
        count: 1,
        title: 'Link',
        arrows: 'to'
    });

    const createMockContext = (): GraphDataContext => ({
        centerFile: '/test/center.org',
        depth: 1,
        maxDepth: 2,
        direction: 'both',
        db: {}
    });

    describe('register', () => {
        it('should register a provider', () => {
            const provider: GraphDataProvider = {
                id: 'test-provider',
                name: 'Test Provider'
            };

            const disposable = graphDataRegistry.register(provider);

            expect(graphDataRegistry.hasProvider('test-provider')).toBe(true);
            expect(graphDataRegistry.getProviderIds()).toContain('test-provider');

            disposable.dispose();
            expect(graphDataRegistry.hasProvider('test-provider')).toBe(false);
        });

        it('should throw on duplicate id', () => {
            const provider: GraphDataProvider = {
                id: 'test-provider',
                name: 'Test Provider'
            };

            graphDataRegistry.register(provider);

            expect(() => graphDataRegistry.register(provider)).toThrow(/already registered/);
        });
    });

    describe('applyProviders', () => {
        it('should apply node enrichments', async () => {
            graphDataRegistry.register({
                id: 'color-provider',
                name: 'Color Provider',
                async enrichNode(node) {
                    return { color: '#ff0000' };
                }
            });

            const nodes = [createMockNode('/test/file1.org')];
            const edges: MockGraphEdge[] = [];
            const context = createMockContext();

            const result = await graphDataRegistry.applyProviders(
                nodes as any,
                edges as any,
                context
            );

            expect(result.nodeEnrichments.get('/test/file1.org')).toEqual({
                color: '#ff0000',
                properties: {}
            });
        });

        it('should apply edge enrichments', async () => {
            graphDataRegistry.register({
                id: 'edge-styler',
                name: 'Edge Styler',
                async enrichEdge(edge) {
                    return { style: 'dashed', width: 2 };
                }
            });

            const nodes = [createMockNode('/test/file1.org'), createMockNode('/test/file2.org')];
            const edges = [createMockEdge('/test/file1.org', '/test/file2.org')];
            const context = createMockContext();

            const result = await graphDataRegistry.applyProviders(
                nodes as any,
                edges as any,
                context
            );

            expect(result.edgeEnrichments.get('/test/file1.org:/test/file2.org')).toEqual({
                style: 'dashed',
                width: 2,
                properties: {}
            });
        });

        it('should collect custom edges', async () => {
            graphDataRegistry.register({
                id: 'semantic-edges',
                name: 'Semantic Edges',
                async getCustomEdges(filePath) {
                    if (filePath === '/test/file1.org') {
                        return [{
                            from: '/test/file1.org',
                            to: '/test/file3.org',
                            type: 'semantic-similarity',
                            label: 'Similar content'
                        }];
                    }
                    return [];
                }
            });

            const nodes = [createMockNode('/test/file1.org'), createMockNode('/test/file2.org')];
            const edges: MockGraphEdge[] = [];
            const context = createMockContext();

            const result = await graphDataRegistry.applyProviders(
                nodes as any,
                edges as any,
                context
            );

            expect(result.customEdges).toHaveLength(1);
            expect(result.customEdges[0].type).toBe('semantic-similarity');
        });

        it('should filter nodes', async () => {
            graphDataRegistry.register({
                id: 'node-filter',
                name: 'Node Filter',
                filterNode(node) {
                    return !node.id.includes('excluded');
                }
            });

            const nodes = [
                createMockNode('/test/file1.org'),
                createMockNode('/test/excluded.org')
            ];
            const edges: MockGraphEdge[] = [];
            const context = createMockContext();

            const result = await graphDataRegistry.applyProviders(
                nodes as any,
                edges as any,
                context
            );

            expect(result.filteredNodes.has('/test/excluded.org')).toBe(true);
            expect(result.filteredNodes.has('/test/file1.org')).toBe(false);
        });

        it('should filter edges', async () => {
            graphDataRegistry.register({
                id: 'edge-filter',
                name: 'Edge Filter',
                filterEdge(edge) {
                    return edge.linkType !== 'http';
                }
            });

            const nodes = [createMockNode('/test/file1.org'), createMockNode('/test/file2.org')];
            const edges = [
                createMockEdge('/test/file1.org', '/test/file2.org'),
                { ...createMockEdge('/test/file1.org', '/test/file3.org'), linkType: 'http' }
            ];
            const context = createMockContext();

            const result = await graphDataRegistry.applyProviders(
                nodes as any,
                edges as any,
                context
            );

            expect(result.filteredEdges.has('/test/file1.org:/test/file3.org')).toBe(true);
            expect(result.filteredEdges.has('/test/file1.org:/test/file2.org')).toBe(false);
        });

        it('should collect errors without stopping', async () => {
            graphDataRegistry.register({
                id: 'failing-provider',
                name: 'Failing Provider',
                async enrichNode() {
                    throw new Error('Test error');
                }
            });

            graphDataRegistry.register({
                id: 'working-provider',
                name: 'Working Provider',
                async enrichNode() {
                    return { color: '#00ff00' };
                }
            });

            const nodes = [createMockNode('/test/file1.org')];
            const edges: MockGraphEdge[] = [];
            const context = createMockContext();

            const result = await graphDataRegistry.applyProviders(
                nodes as any,
                edges as any,
                context
            );

            // Working provider should still have run
            expect(result.nodeEnrichments.get('/test/file1.org')?.color).toBe('#00ff00');

            // Error should be collected
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].providerId).toBe('failing-provider');
        });

        it('should respect priority ordering', async () => {
            const order: string[] = [];

            graphDataRegistry.register({
                id: 'low-priority',
                name: 'Low Priority',
                priority: 0,
                async enrichNode() {
                    order.push('low');
                    return { color: '#000000' };
                }
            });

            graphDataRegistry.register({
                id: 'high-priority',
                name: 'High Priority',
                priority: 10,
                async enrichNode() {
                    order.push('high');
                    return { color: '#ffffff' };
                }
            });

            const nodes = [createMockNode('/test/file1.org')];
            const edges: MockGraphEdge[] = [];
            const context = createMockContext();

            await graphDataRegistry.applyProviders(
                nodes as any,
                edges as any,
                context
            );

            expect(order).toEqual(['high', 'low']);
        });

        it('should merge enrichments from multiple providers', async () => {
            graphDataRegistry.register({
                id: 'color-provider',
                name: 'Color Provider',
                async enrichNode() {
                    return { color: '#ff0000', properties: { colored: true } };
                }
            });

            graphDataRegistry.register({
                id: 'size-provider',
                name: 'Size Provider',
                async enrichNode() {
                    return { size: 20, properties: { sized: true } };
                }
            });

            const nodes = [createMockNode('/test/file1.org')];
            const edges: MockGraphEdge[] = [];
            const context = createMockContext();

            const result = await graphDataRegistry.applyProviders(
                nodes as any,
                edges as any,
                context
            );

            const enrichment = result.nodeEnrichments.get('/test/file1.org');
            expect(enrichment?.color).toBe('#ff0000');
            expect(enrichment?.size).toBe(20);
            expect(enrichment?.properties?.colored).toBe(true);
            expect(enrichment?.properties?.sized).toBe(true);
        });
    });

    describe('built-in providers', () => {
        it('should export linkCountImportanceProvider', async () => {
            const { linkCountImportanceProvider } = await import('../graphDataAdapter');
            expect(linkCountImportanceProvider.id).toBe('link-count-importance');
            expect(linkCountImportanceProvider.enrichNode).toBeDefined();
        });

        it('should export recencyColoringProvider', async () => {
            const { recencyColoringProvider } = await import('../graphDataAdapter');
            expect(recencyColoringProvider.id).toBe('recency-coloring');
            expect(recencyColoringProvider.enrichNode).toBeDefined();
        });
    });
});
