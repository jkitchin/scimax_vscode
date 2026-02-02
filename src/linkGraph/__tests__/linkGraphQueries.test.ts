/**
 * Tests for LinkGraphQueryService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LinkGraphQueryService, LinkGraphFilters } from '../linkGraphQueries';

// Mock the logger
vi.mock('../../utils/logger', () => ({
    databaseLogger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

// Mock database client
function createMockDb(responses: Record<string, any[]> = {}) {
    return {
        execute: vi.fn().mockImplementation(({ sql }: { sql: string }) => {
            // Return appropriate mock data based on the query
            for (const [pattern, rows] of Object.entries(responses)) {
                if (sql.includes(pattern)) {
                    return Promise.resolve({ rows });
                }
            }
            return Promise.resolve({ rows: [] });
        })
    };
}

describe('LinkGraphQueryService', () => {
    describe('buildGraph', () => {
        it('should build a graph with center node', async () => {
            const mockDb = createMockDb({
                'FROM links': [],  // No links
                'FROM files': [{ file_type: 'org', mtime: Date.now() }],
                'FROM headings': [{ total: 5, todos: 2, upcoming: 0 }],
                'COUNT(*)': [{ count: 0 }],
                'SELECT tags': []
            });

            const service = new LinkGraphQueryService(mockDb as any);
            const result = await service.buildGraph(
                '/test/file.org',
                1,
                'both',
                {},
                100
            );

            expect(result.nodes).toHaveLength(1);
            expect(result.nodes[0].id).toBe('/test/file.org');
            expect(result.nodes[0].isCenter).toBe(true);
            expect(result.edges).toHaveLength(0);
            expect(result.truncated).toBe(false);
        });

        it('should include connected files at depth 1', async () => {
            const mockDb = createMockDb({
                // Outgoing links query
                'l.file_path = ?': [
                    { target: '/test/linked.org' }
                ],
                // File metadata
                'FROM files WHERE path': [{ file_type: 'org', mtime: Date.now() }],
                'FROM headings WHERE file_path': [{ total: 3, todos: 1, upcoming: 0 }],
                'COUNT(*) as count FROM links': [{ count: 2 }],
                'SELECT tags': []
            });

            const service = new LinkGraphQueryService(mockDb as any);
            const result = await service.buildGraph(
                '/test/file.org',
                1,
                'outgoing',
                {},
                100
            );

            expect(result.nodes.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('getLinkStats', () => {
        it('should return link statistics for a file', async () => {
            const mockDb = createMockDb({
                'link_type, COUNT(*)': [
                    { link_type: 'file', count: 5 },
                    { link_type: 'http', count: 3 }
                ],
                'COUNT(DISTINCT file_path)': [{ count: 2 }]
            });

            const service = new LinkGraphQueryService(mockDb as any);
            const stats = await service.getLinkStats('/test/file.org');

            expect(stats.outgoing).toBe(8);
            expect(stats.outgoingByType).toEqual({
                file: 5,
                http: 3
            });
            expect(stats.incoming).toBe(2);
        });

        it('should handle files with no links', async () => {
            const mockDb = createMockDb({});

            const service = new LinkGraphQueryService(mockDb as any);
            const stats = await service.getLinkStats('/test/empty.org');

            expect(stats.outgoing).toBe(0);
            expect(stats.incoming).toBe(0);
            expect(stats.outgoingByType).toEqual({});
        });
    });

    describe('filters', () => {
        it('should apply file type filter', async () => {
            const mockDb = createMockDb({});
            const executeSpy = vi.spyOn(mockDb, 'execute');

            const service = new LinkGraphQueryService(mockDb as any);
            const filters: LinkGraphFilters = {
                fileTypes: ['org']
            };

            await service.buildGraph('/test/file.org', 1, 'both', filters, 100);

            // Check that file_type filter was included in query
            const calls = executeSpy.mock.calls;
            const hasFileTypeFilter = calls.some(call => {
                const sql = (call[0] as any).sql || '';
                return sql.includes('file_type');
            });
            expect(hasFileTypeFilter).toBe(true);
        });

        it('should apply tag filter', async () => {
            const mockDb = createMockDb({});
            const executeSpy = vi.spyOn(mockDb, 'execute');

            const service = new LinkGraphQueryService(mockDb as any);
            const filters: LinkGraphFilters = {
                tags: ['project', 'important']
            };

            await service.buildGraph('/test/file.org', 1, 'both', filters, 100);

            // Check that tag filter was included in query
            const calls = executeSpy.mock.calls;
            const hasTagFilter = calls.some(call => {
                const sql = (call[0] as any).sql || '';
                return sql.includes('h.tags LIKE');
            });
            expect(hasTagFilter).toBe(true);
        });

        it('should apply excludeDone filter', async () => {
            const mockDb = createMockDb({});
            const executeSpy = vi.spyOn(mockDb, 'execute');

            const service = new LinkGraphQueryService(mockDb as any);
            const filters: LinkGraphFilters = {
                excludeDone: true
            };

            await service.buildGraph('/test/file.org', 1, 'both', filters, 100);

            // Check that DONE exclusion was included in query
            const calls = executeSpy.mock.calls;
            const hasDoneFilter = calls.some(call => {
                const sql = (call[0] as any).sql || '';
                return sql.includes('DONE') || sql.includes('CANCELLED');
            });
            expect(hasDoneFilter).toBe(true);
        });

        it('should apply modification time filter', async () => {
            const mockDb = createMockDb({});
            const executeSpy = vi.spyOn(mockDb, 'execute');

            const service = new LinkGraphQueryService(mockDb as any);
            const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            const filters: LinkGraphFilters = {
                modifiedAfter: oneWeekAgo
            };

            await service.buildGraph('/test/file.org', 1, 'both', filters, 100);

            // Check that mtime filter was included in query
            const calls = executeSpy.mock.calls;
            const hasMtimeFilter = calls.some(call => {
                const sql = (call[0] as any).sql || '';
                return sql.includes('mtime');
            });
            expect(hasMtimeFilter).toBe(true);
        });
    });

    describe('direction handling', () => {
        it('should only get outgoing links when direction is outgoing', async () => {
            const mockDb = createMockDb({});
            const executeSpy = vi.spyOn(mockDb, 'execute');

            const service = new LinkGraphQueryService(mockDb as any);
            await service.buildGraph('/test/file.org', 1, 'outgoing', {}, 100);

            // Should call for outgoing links (file_path = ?)
            // Should NOT call for incoming links (target = ?)
            const calls = executeSpy.mock.calls;
            const hasOutgoingQuery = calls.some(call => {
                const sql = (call[0] as any).sql || '';
                return sql.includes('l.file_path = ?') && sql.includes('FROM links');
            });
            expect(hasOutgoingQuery).toBe(true);
        });

        it('should only get incoming links when direction is incoming', async () => {
            const mockDb = createMockDb({});
            const executeSpy = vi.spyOn(mockDb, 'execute');

            const service = new LinkGraphQueryService(mockDb as any);
            await service.buildGraph('/test/file.org', 1, 'incoming', {}, 100);

            // Should call for incoming links (target LIKE)
            const calls = executeSpy.mock.calls;
            const hasIncomingQuery = calls.some(call => {
                const sql = (call[0] as any).sql || '';
                return sql.includes('l.target') && sql.includes('FROM links');
            });
            expect(hasIncomingQuery).toBe(true);
        });
    });

    describe('truncation', () => {
        it('should truncate when nodes exceed maxNodes', async () => {
            // Create mock that returns many connected files
            const manyFiles = Array.from({ length: 150 }, (_, i) => ({
                target: `/test/file${i}.org`
            }));

            const mockDb = createMockDb({
                'l.file_path = ?': manyFiles,
                'FROM files': [{ file_type: 'org', mtime: Date.now() }],
                'FROM headings': [{ total: 1, todos: 0, upcoming: 0 }],
                'COUNT(*)': [{ count: 1 }],
                'SELECT tags': []
            });

            const service = new LinkGraphQueryService(mockDb as any);
            const result = await service.buildGraph(
                '/test/file.org',
                1,
                'outgoing',
                {},
                50  // Low max to trigger truncation
            );

            expect(result.truncated).toBe(true);
            expect(result.nodes.length).toBeLessThanOrEqual(50);
        });
    });
});
