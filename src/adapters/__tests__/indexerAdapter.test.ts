/**
 * Tests for IndexerAdapter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    indexerRegistry,
    IndexerAdapter,
    IndexContext,
    ExtractedEntity,
    ExtractedRelationship,
    ExtractedMetadata
} from '../indexerAdapter';

// Mock vscode
vi.mock('vscode', () => ({
    Disposable: class {
        constructor(private callback: () => void) {}
        dispose() { this.callback(); }
    }
}));

describe('IndexerAdapterRegistry', () => {
    beforeEach(() => {
        indexerRegistry.clear();
    });

    describe('register', () => {
        it('should register an adapter', () => {
            const adapter: IndexerAdapter = {
                id: 'test-adapter',
                extract: async () => []
            };

            const disposable = indexerRegistry.register(adapter);

            expect(indexerRegistry.hasAdapter('test-adapter')).toBe(true);
            expect(indexerRegistry.getAdapterIds()).toContain('test-adapter');

            disposable.dispose();
            expect(indexerRegistry.hasAdapter('test-adapter')).toBe(false);
        });

        it('should throw on duplicate id', () => {
            const adapter: IndexerAdapter = {
                id: 'test-adapter',
                extract: async () => []
            };

            indexerRegistry.register(adapter);

            expect(() => indexerRegistry.register(adapter)).toThrow(/already registered/);
        });

        it('should throw on missing id', () => {
            const adapter = {
                extract: async () => []
            } as any;

            expect(() => indexerRegistry.register(adapter)).toThrow(/must have an id/);
        });
    });

    describe('getAdaptersForFileType', () => {
        it('should filter adapters by file type', () => {
            indexerRegistry.register({
                id: 'org-only',
                fileTypes: ['org'],
                extract: async () => []
            });

            indexerRegistry.register({
                id: 'md-only',
                fileTypes: ['md'],
                extract: async () => []
            });

            indexerRegistry.register({
                id: 'all-files',
                extract: async () => []
            });

            const orgAdapters = indexerRegistry.getAdaptersForFileType('org');
            expect(orgAdapters.map(a => a.id)).toContain('org-only');
            expect(orgAdapters.map(a => a.id)).toContain('all-files');
            expect(orgAdapters.map(a => a.id)).not.toContain('md-only');

            const mdAdapters = indexerRegistry.getAdaptersForFileType('md');
            expect(mdAdapters.map(a => a.id)).toContain('md-only');
            expect(mdAdapters.map(a => a.id)).toContain('all-files');
            expect(mdAdapters.map(a => a.id)).not.toContain('org-only');
        });
    });

    describe('runAdapters', () => {
        it('should run adapters and collect results', async () => {
            indexerRegistry.register({
                id: 'entity-extractor',
                extract: async () => [
                    {
                        type: 'entity' as const,
                        category: 'concept',
                        name: 'Machine Learning'
                    }
                ]
            });

            indexerRegistry.register({
                id: 'relationship-extractor',
                extract: async () => [
                    {
                        type: 'relationship' as const,
                        source: 'file1.org',
                        target: 'file2.org',
                        relation: 'references'
                    }
                ]
            });

            const context: IndexContext = {
                filePath: '/test/file.org',
                fileId: 1,
                fileType: 'org',
                mtime: Date.now(),
                db: {}
            };

            const result = await indexerRegistry.runAdapters('content', undefined, context);

            expect(result.entities).toHaveLength(1);
            expect(result.entities[0].name).toBe('Machine Learning');

            expect(result.relationships).toHaveLength(1);
            expect(result.relationships[0].relation).toBe('references');

            expect(result.errors).toHaveLength(0);
        });

        it('should collect errors without stopping', async () => {
            indexerRegistry.register({
                id: 'failing-adapter',
                extract: async () => { throw new Error('Test error'); }
            });

            indexerRegistry.register({
                id: 'working-adapter',
                extract: async () => [
                    { type: 'entity' as const, category: 'test', name: 'Test' }
                ]
            });

            const context: IndexContext = {
                filePath: '/test/file.org',
                fileId: 1,
                fileType: 'org',
                mtime: Date.now(),
                db: {}
            };

            const result = await indexerRegistry.runAdapters('content', undefined, context);

            expect(result.entities).toHaveLength(1);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].adapterId).toBe('failing-adapter');
        });

        it('should respect priority ordering', async () => {
            const order: string[] = [];

            indexerRegistry.register({
                id: 'low-priority',
                priority: 0,
                extract: async () => { order.push('low'); return []; }
            });

            indexerRegistry.register({
                id: 'high-priority',
                priority: 10,
                extract: async () => { order.push('high'); return []; }
            });

            const context: IndexContext = {
                filePath: '/test/file.org',
                fileId: 1,
                fileType: 'org',
                mtime: Date.now(),
                db: {}
            };

            await indexerRegistry.runAdapters('content', undefined, context);

            expect(order).toEqual(['high', 'low']);
        });
    });

    describe('notifyFileRemoved', () => {
        it('should call onFileRemoved for adapters that implement it', async () => {
            const removedFiles: string[] = [];

            indexerRegistry.register({
                id: 'cleanup-adapter',
                extract: async () => [],
                onFileRemoved: async (filePath) => {
                    removedFiles.push(filePath);
                }
            });

            indexerRegistry.register({
                id: 'no-cleanup-adapter',
                extract: async () => []
            });

            await indexerRegistry.notifyFileRemoved('/test/removed.org', 1, {});

            expect(removedFiles).toEqual(['/test/removed.org']);
        });
    });
});
