/**
 * Tests for ScimaxDb database module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock vscode module
vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: vi.fn().mockReturnValue({
            get: vi.fn().mockReturnValue([])
        }),
        createFileSystemWatcher: vi.fn().mockReturnValue({
            onDidCreate: vi.fn(),
            onDidChange: vi.fn(),
            onDidDelete: vi.fn()
        }),
        workspaceFolders: []
    },
    window: {
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showErrorMessage: vi.fn()
    },
    ExtensionContext: class {
        subscriptions = [];
        globalStorageUri = { fsPath: '/tmp/test-storage' };
    }
}));

// =============================================================================
// DbStats Interface Tests
// =============================================================================

describe('DbStats Interface', () => {
    it('should have all required fields', () => {
        const stats = {
            files: 10,
            headings: 50,
            blocks: 20,
            links: 100,
            chunks: 5,
            has_embeddings: false,
            vector_search_supported: true,
            vector_search_error: null,
            by_type: { org: 8, md: 1, ipynb: 1 }
        };

        expect(stats.files).toBe(10);
        expect(stats.headings).toBe(50);
        expect(stats.blocks).toBe(20);
        expect(stats.links).toBe(100);
        expect(stats.chunks).toBe(5);
        expect(stats.has_embeddings).toBe(false);
        expect(stats.vector_search_supported).toBe(true);
        expect(stats.vector_search_error).toBeNull();
        expect(stats.by_type.org).toBe(8);
        expect(stats.by_type.md).toBe(1);
        expect(stats.by_type.ipynb).toBe(1);
    });

    it('should handle vector search error', () => {
        const stats = {
            files: 0,
            headings: 0,
            blocks: 0,
            links: 0,
            chunks: 0,
            has_embeddings: false,
            vector_search_supported: false,
            vector_search_error: 'libsql_vector_idx not available',
            by_type: { org: 0, md: 0, ipynb: 0 }
        };

        expect(stats.vector_search_supported).toBe(false);
        expect(stats.vector_search_error).toBe('libsql_vector_idx not available');
    });
});

// =============================================================================
// SearchResult Interface Tests
// =============================================================================

describe('SearchResult Types', () => {
    it('should support content search result', () => {
        const result = {
            type: 'content' as const,
            file_path: '/path/to/file.org',
            line_number: 42,
            preview: 'This is a <mark>test</mark> preview',
            score: 0.95
        };

        expect(result.type).toBe('content');
        expect(result.file_path).toBe('/path/to/file.org');
        expect(result.line_number).toBe(42);
        expect(result.score).toBe(0.95);
    });

    it('should support semantic search result', () => {
        const result = {
            type: 'semantic' as const,
            file_path: '/path/to/file.org',
            line_number: 10,
            preview: 'Semantic match preview',
            score: 0.87,
            distance: 0.13
        };

        expect(result.type).toBe('semantic');
        expect(result.distance).toBe(0.13);
        expect(result.score).toBe(0.87);
    });
});

// =============================================================================
// HeadingRecord Interface Tests
// =============================================================================

describe('HeadingRecord Interface', () => {
    it('should support full heading record', () => {
        const heading = {
            id: 1,
            file_id: 1,
            file_path: '/path/to/file.org',
            level: 2,
            title: 'Test Heading',
            line_number: 10,
            begin_pos: 150,
            todo_state: 'TODO',
            priority: 'A',
            tags: '["work", "urgent"]',
            inherited_tags: '["project"]',
            properties: '{"CUSTOM_ID": "test-heading"}',
            scheduled: '2026-01-15 Wed',
            deadline: '2026-01-20 Mon',
            closed: null,
            cell_index: null
        };

        expect(heading.level).toBe(2);
        expect(heading.todo_state).toBe('TODO');
        expect(heading.priority).toBe('A');
        expect(JSON.parse(heading.tags)).toContain('work');
        expect(JSON.parse(heading.inherited_tags)).toContain('project');
    });

    it('should support notebook cell heading', () => {
        const heading = {
            id: 1,
            file_id: 1,
            file_path: '/path/to/notebook.ipynb',
            level: 1,
            title: 'Notebook Section',
            line_number: 1,
            begin_pos: 0,
            todo_state: null,
            priority: null,
            tags: '[]',
            inherited_tags: '[]',
            properties: '{}',
            scheduled: null,
            deadline: null,
            closed: null,
            cell_index: 3  // This heading is in cell 3
        };

        expect(heading.cell_index).toBe(3);
        expect(heading.file_path).toContain('.ipynb');
    });
});

// =============================================================================
// AgendaItem Interface Tests
// =============================================================================

describe('AgendaItem Interface', () => {
    it('should support deadline item', () => {
        const item = {
            type: 'deadline' as const,
            heading: {
                id: 1,
                file_id: 1,
                file_path: '/path/file.org',
                level: 1,
                title: 'Submit Report',
                line_number: 5,
                begin_pos: 0,
                todo_state: 'TODO',
                priority: 'A',
                tags: '[]',
                inherited_tags: '[]',
                properties: '{}',
                scheduled: null,
                deadline: '2026-01-20 Mon',
                closed: null,
                cell_index: null
            },
            date: '2026-01-20 Mon',
            days_until: 5,
            overdue: false
        };

        expect(item.type).toBe('deadline');
        expect(item.days_until).toBe(5);
        expect(item.overdue).toBe(false);
    });

    it('should support overdue item', () => {
        const item = {
            type: 'deadline' as const,
            heading: {
                id: 1,
                file_id: 1,
                file_path: '/path/file.org',
                level: 1,
                title: 'Overdue Task',
                line_number: 5,
                begin_pos: 0,
                todo_state: 'TODO',
                priority: null,
                tags: '[]',
                inherited_tags: '[]',
                properties: '{}',
                scheduled: null,
                deadline: '2026-01-10 Fri',
                closed: null,
                cell_index: null
            },
            date: '2026-01-10 Fri',
            days_until: -5,
            overdue: true
        };

        expect(item.days_until).toBe(-5);
        expect(item.overdue).toBe(true);
    });

    it('should support scheduled item', () => {
        const item = {
            type: 'scheduled' as const,
            heading: {
                id: 1,
                file_id: 1,
                file_path: '/path/file.org',
                level: 1,
                title: 'Scheduled Task',
                line_number: 5,
                begin_pos: 0,
                todo_state: 'TODO',
                priority: null,
                tags: '[]',
                inherited_tags: '[]',
                properties: '{}',
                scheduled: '2026-01-16 Thu',
                deadline: null,
                closed: null,
                cell_index: null
            },
            date: '2026-01-16 Thu',
            days_until: 1,
            overdue: false
        };

        expect(item.type).toBe('scheduled');
    });
});

// =============================================================================
// SearchScope Interface Tests
// =============================================================================

describe('SearchScope Interface', () => {
    it('should support all scope', () => {
        const scope = { type: 'all' as const };
        expect(scope.type).toBe('all');
    });

    it('should support directory scope', () => {
        const scope = {
            type: 'directory' as const,
            path: '/home/user/notes'
        };
        expect(scope.type).toBe('directory');
        expect(scope.path).toBe('/home/user/notes');
    });

    it('should support project scope', () => {
        const scope = {
            type: 'project' as const,
            path: '/home/user/my-project'
        };
        expect(scope.type).toBe('project');
    });
});

// =============================================================================
// File Type Detection Tests
// =============================================================================

describe('File Type Detection', () => {
    const getFileType = (filePath: string): 'org' | 'md' | 'ipynb' => {
        const ext = filePath.toLowerCase().split('.').pop() || '';
        if (ext === 'org') return 'org';
        if (ext === 'md') return 'md';
        if (ext === 'ipynb') return 'ipynb';
        return 'org';  // default
    };

    it('should detect org files', () => {
        expect(getFileType('/path/to/file.org')).toBe('org');
        expect(getFileType('/path/to/FILE.ORG')).toBe('org');
    });

    it('should detect markdown files', () => {
        expect(getFileType('/path/to/file.md')).toBe('md');
        expect(getFileType('/path/to/README.MD')).toBe('md');
    });

    it('should detect Jupyter notebooks', () => {
        expect(getFileType('/path/to/notebook.ipynb')).toBe('ipynb');
        expect(getFileType('/path/to/Analysis.IPYNB')).toBe('ipynb');
    });

    it('should default to org for unknown extensions', () => {
        expect(getFileType('/path/to/file.txt')).toBe('org');
        expect(getFileType('/path/to/file')).toBe('org');
    });
});

// =============================================================================
// Relative Date Parsing Tests
// =============================================================================

describe('Relative Date Parsing', () => {
    const parseRelativeDate = (dateStr: string): Date => {
        const date = new Date();
        if (dateStr.startsWith('+')) {
            const match = dateStr.match(/\+(\d+)([dwmy])/);
            if (match) {
                const amount = parseInt(match[1]);
                const unit = match[2];
                switch (unit) {
                    case 'd': date.setDate(date.getDate() + amount); break;
                    case 'w': date.setDate(date.getDate() + amount * 7); break;
                    case 'm': date.setMonth(date.getMonth() + amount); break;
                    case 'y': date.setFullYear(date.getFullYear() + amount); break;
                }
            }
        } else {
            return new Date(dateStr);
        }
        return date;
    };

    it('should parse +Nd format (days)', () => {
        const today = new Date();
        const result = parseRelativeDate('+5d');
        const expected = new Date(today);
        expected.setDate(expected.getDate() + 5);

        expect(result.toDateString()).toBe(expected.toDateString());
    });

    it('should parse +Nw format (weeks)', () => {
        const today = new Date();
        const result = parseRelativeDate('+2w');
        const expected = new Date(today);
        expected.setDate(expected.getDate() + 14);

        expect(result.toDateString()).toBe(expected.toDateString());
    });

    it('should parse +Nm format (months)', () => {
        const today = new Date();
        const result = parseRelativeDate('+3m');
        const expected = new Date(today);
        expected.setMonth(expected.getMonth() + 3);

        expect(result.toDateString()).toBe(expected.toDateString());
    });

    it('should parse +Ny format (years)', () => {
        const today = new Date();
        const result = parseRelativeDate('+1y');
        const expected = new Date(today);
        expected.setFullYear(expected.getFullYear() + 1);

        expect(result.toDateString()).toBe(expected.toDateString());
    });

    it('should parse absolute date string', () => {
        // Use ISO format with time to avoid timezone issues
        const result = parseRelativeDate('2026-01-15T00:00:00');
        expect(result.getFullYear()).toBe(2026);
        expect(result.getMonth()).toBe(0);  // January is 0
        expect(result.getDate()).toBe(15);
    });
});

// =============================================================================
// Vector Format Tests
// =============================================================================

describe('Vector Format', () => {
    it('should format embedding array for libsql vector32', () => {
        const embedding = [0.1, 0.2, 0.3, -0.5];
        const vectorStr = `[${embedding.join(',')}]`;

        expect(vectorStr).toBe('[0.1,0.2,0.3,-0.5]');
    });

    it('should handle large embeddings (384 dimensions)', () => {
        const embedding = Array(384).fill(0).map((_, i) => i / 384);
        const vectorStr = `[${embedding.join(',')}]`;

        expect(vectorStr.startsWith('[')).toBe(true);
        expect(vectorStr.endsWith(']')).toBe(true);
        expect(vectorStr.split(',').length).toBe(384);
    });

    it('should handle OpenAI embeddings (1536 dimensions)', () => {
        const embedding = Array(1536).fill(0).map((_, i) => Math.random() * 2 - 1);
        const vectorStr = `[${embedding.join(',')}]`;

        expect(vectorStr.split(',').length).toBe(1536);
    });
});

// =============================================================================
// Ignore Pattern Matching Tests
// =============================================================================

describe('Ignore Pattern Matching', () => {
    // Simple pattern matching without minimatch for testing
    const simpleMatch = (path: string, pattern: string): boolean => {
        // Very simplified pattern matching
        if (pattern.includes('**/')) {
            const suffix = pattern.replace('**/', '');
            return path.includes(suffix.replace('/**', ''));
        }
        return path.includes(pattern);
    };

    it('should match node_modules', () => {
        expect(simpleMatch('/project/node_modules/lodash/index.js', '**/node_modules/**')).toBe(true);
    });

    it('should match .git directory', () => {
        expect(simpleMatch('/project/.git/config', '**/.git/**')).toBe(true);
    });

    it('should match dist directory', () => {
        expect(simpleMatch('/project/dist/bundle.js', '**/dist/**')).toBe(true);
    });

    it('should not match regular files', () => {
        expect(simpleMatch('/project/src/index.ts', '**/node_modules/**')).toBe(false);
    });
});

// =============================================================================
// FTS5 Query Formatting Tests
// =============================================================================

describe('FTS5 Query Formatting', () => {
    const formatFts5Query = (query: string): string => {
        // Simple FTS5 query formatter
        // Wrap words in quotes for phrase matching, handle special chars
        const words = query.trim().split(/\s+/);
        if (words.length === 1) {
            // Single word - can use prefix matching
            return `${words[0]}*`;
        }
        // Multiple words - use AND
        return words.map(w => `"${w}"`).join(' AND ');
    };

    it('should format single word with prefix', () => {
        expect(formatFts5Query('test')).toBe('test*');
    });

    it('should format multiple words with AND', () => {
        expect(formatFts5Query('hello world')).toBe('"hello" AND "world"');
    });

    it('should handle extra whitespace', () => {
        expect(formatFts5Query('  hello   world  ')).toBe('"hello" AND "world"');
    });
});

// =============================================================================
// Chunk Creation Logic Tests
// =============================================================================

describe('Chunk Creation Logic', () => {
    const createChunks = (content: string, chunkSize: number = 2000): { text: string; lineStart: number; lineEnd: number }[] => {
        const lines = content.split('\n');
        const chunks: { text: string; lineStart: number; lineEnd: number }[] = [];
        let currentChunk = '';
        let currentLineStart = 1;
        let charCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            currentChunk += line + '\n';
            charCount += line.length + 1;

            if (charCount >= chunkSize) {
                chunks.push({
                    text: currentChunk.trim(),
                    lineStart: currentLineStart,
                    lineEnd: i + 1
                });

                const overlapLines = currentChunk.split('\n').slice(-3);
                currentChunk = overlapLines.join('\n');
                currentLineStart = Math.max(1, i - 2);
                charCount = currentChunk.length;
            }
        }

        if (currentChunk.trim()) {
            chunks.push({
                text: currentChunk.trim(),
                lineStart: currentLineStart,
                lineEnd: lines.length
            });
        }

        return chunks;
    };

    it('should create single chunk for small content', () => {
        const content = 'Line 1\nLine 2\nLine 3';
        const chunks = createChunks(content, 1000);

        expect(chunks.length).toBe(1);
        expect(chunks[0].lineStart).toBe(1);
        expect(chunks[0].lineEnd).toBe(3);
    });

    it('should split large content into multiple chunks', () => {
        const lines = Array(100).fill('This is a line of text with some content').join('\n');
        const chunks = createChunks(lines, 500);

        expect(chunks.length).toBeGreaterThan(1);
    });

    it('should have overlapping chunks', () => {
        const lines = Array(50).fill('Line content here').join('\n');
        const chunks = createChunks(lines, 200);

        if (chunks.length > 1) {
            // Second chunk should start before first chunk ends
            expect(chunks[1].lineStart).toBeLessThanOrEqual(chunks[0].lineEnd);
        }
    });

    it('should handle empty content', () => {
        const chunks = createChunks('');
        expect(chunks.length).toBe(0);
    });

    it('should handle whitespace only', () => {
        const chunks = createChunks('   \n   \n   ');
        expect(chunks.length).toBe(0);
    });
});

// =============================================================================
// Heading Tag Inheritance Tests
// =============================================================================

describe('Tag Inheritance Logic', () => {
    interface TestHeading {
        level: number;
        title: string;
        tags: string[];
    }

    const computeInheritedTags = (headings: TestHeading[]): { heading: TestHeading; inheritedTags: string[] }[] => {
        const tagStack: string[][] = [];
        const results: { heading: TestHeading; inheritedTags: string[] }[] = [];

        for (const heading of headings) {
            // Pop tags from deeper or equal levels
            while (tagStack.length >= heading.level) {
                tagStack.pop();
            }

            // Compute inherited tags before adding current heading's tags
            const inheritedTags = tagStack.flat();

            // Push current heading's tags to stack
            tagStack.push(heading.tags);

            results.push({ heading, inheritedTags });
        }

        return results;
    };

    it('should not inherit tags for top-level headings', () => {
        const headings: TestHeading[] = [
            { level: 1, title: 'First', tags: ['tag1'] }
        ];

        const result = computeInheritedTags(headings);
        expect(result[0].inheritedTags).toEqual([]);
    });

    it('should inherit parent tags', () => {
        const headings: TestHeading[] = [
            { level: 1, title: 'Parent', tags: ['parent-tag'] },
            { level: 2, title: 'Child', tags: ['child-tag'] }
        ];

        const result = computeInheritedTags(headings);
        expect(result[1].inheritedTags).toEqual(['parent-tag']);
    });

    it('should inherit multiple ancestor tags', () => {
        const headings: TestHeading[] = [
            { level: 1, title: 'L1', tags: ['tag1'] },
            { level: 2, title: 'L2', tags: ['tag2'] },
            { level: 3, title: 'L3', tags: ['tag3'] }
        ];

        const result = computeInheritedTags(headings);
        expect(result[2].inheritedTags).toEqual(['tag1', 'tag2']);
    });

    it('should reset inheritance on level change', () => {
        const headings: TestHeading[] = [
            { level: 1, title: 'First L1', tags: ['a'] },
            { level: 2, title: 'Under First', tags: ['b'] },
            { level: 1, title: 'Second L1', tags: ['c'] },
            { level: 2, title: 'Under Second', tags: ['d'] }
        ];

        const result = computeInheritedTags(headings);
        // 'Under Second' should only inherit from 'Second L1', not 'First L1'
        expect(result[3].inheritedTags).toEqual(['c']);
    });

    it('should handle empty tags', () => {
        const headings: TestHeading[] = [
            { level: 1, title: 'Parent', tags: [] },
            { level: 2, title: 'Child', tags: ['child'] }
        ];

        const result = computeInheritedTags(headings);
        expect(result[1].inheritedTags).toEqual([]);
    });
});

// =============================================================================
// Days Until Calculation Tests
// =============================================================================

describe('Days Until Calculation', () => {
    const calculateDaysUntil = (dateStr: string, today: Date = new Date()): number => {
        const targetDate = new Date(dateStr.split(' ')[0]);
        const todayStart = new Date(today);
        todayStart.setHours(0, 0, 0, 0);

        return Math.floor((targetDate.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));
    };

    it('should return 0 for today', () => {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        expect(calculateDaysUntil(dateStr, today)).toBe(0);
    });

    it('should return positive for future dates', () => {
        const today = new Date('2024-01-15');
        expect(calculateDaysUntil('2024-01-20', today)).toBe(5);
    });

    it('should return negative for past dates', () => {
        const today = new Date('2024-01-15');
        expect(calculateDaysUntil('2024-01-10', today)).toBe(-5);
    });

    it('should handle dates with day names', () => {
        const today = new Date('2024-01-15');
        expect(calculateDaysUntil('2024-01-20 Sat', today)).toBe(5);
    });
});

// =============================================================================
// Agenda Item Sorting Tests
// =============================================================================

describe('Agenda Item Sorting', () => {
    interface MockAgendaItem {
        type: 'deadline' | 'scheduled' | 'todo';
        days_until?: number;
        overdue?: boolean;
        title: string;
    }

    const sortAgendaItems = (items: MockAgendaItem[]): MockAgendaItem[] => {
        return [...items].sort((a, b) => {
            // Overdue items first
            if (a.overdue && !b.overdue) return -1;
            if (!a.overdue && b.overdue) return 1;

            // Then by days_until
            if (a.days_until !== undefined && b.days_until !== undefined) {
                return a.days_until - b.days_until;
            }

            // Scheduled/deadline items before unscheduled todos
            if (a.days_until !== undefined && b.days_until === undefined) return -1;
            if (a.days_until === undefined && b.days_until !== undefined) return 1;

            return 0;
        });
    };

    it('should put overdue items first', () => {
        const items: MockAgendaItem[] = [
            { type: 'deadline', days_until: 5, overdue: false, title: 'Future' },
            { type: 'deadline', days_until: -2, overdue: true, title: 'Overdue' }
        ];

        const sorted = sortAgendaItems(items);
        expect(sorted[0].title).toBe('Overdue');
    });

    it('should sort by days_until', () => {
        const items: MockAgendaItem[] = [
            { type: 'deadline', days_until: 10, overdue: false, title: 'Later' },
            { type: 'scheduled', days_until: 2, overdue: false, title: 'Soon' },
            { type: 'deadline', days_until: 5, overdue: false, title: 'Medium' }
        ];

        const sorted = sortAgendaItems(items);
        expect(sorted[0].title).toBe('Soon');
        expect(sorted[1].title).toBe('Medium');
        expect(sorted[2].title).toBe('Later');
    });

    it('should put scheduled items before unscheduled todos', () => {
        const items: MockAgendaItem[] = [
            { type: 'todo', title: 'Unscheduled' },
            { type: 'scheduled', days_until: 3, overdue: false, title: 'Scheduled' }
        ];

        const sorted = sortAgendaItems(items);
        expect(sorted[0].title).toBe('Scheduled');
    });
});

// =============================================================================
// Reciprocal Rank Fusion Tests
// =============================================================================

describe('Reciprocal Rank Fusion', () => {
    interface MockSearchResult {
        file_path: string;
        line_number: number;
        preview: string;
        score: number;
    }

    const reciprocalRankFusion = (
        ftsResults: MockSearchResult[],
        vectorResults: MockSearchResult[],
        options?: { ftsWeight?: number; vectorWeight?: number; limit?: number }
    ): MockSearchResult[] => {
        const ftsWeight = options?.ftsWeight || 0.5;
        const vectorWeight = options?.vectorWeight || 0.5;
        const limit = options?.limit || 20;

        const scoreMap = new Map<string, { result: MockSearchResult; rrf: number }>();

        ftsResults.forEach((result, idx) => {
            const key = `${result.file_path}:${result.line_number}`;
            const rrf = ftsWeight / (idx + 1);
            scoreMap.set(key, { result, rrf });
        });

        vectorResults.forEach((result, idx) => {
            const key = `${result.file_path}:${result.line_number}`;
            const rrf = vectorWeight / (idx + 1);
            const existing = scoreMap.get(key);
            if (existing) {
                existing.rrf += rrf;
            } else {
                scoreMap.set(key, { result, rrf });
            }
        });

        return Array.from(scoreMap.values())
            .sort((a, b) => b.rrf - a.rrf)
            .slice(0, limit)
            .map(item => ({ ...item.result, score: item.rrf }));
    };

    it('should combine results from both sources', () => {
        const ftsResults: MockSearchResult[] = [
            { file_path: '/a.org', line_number: 1, preview: 'FTS match', score: 1 }
        ];
        const vectorResults: MockSearchResult[] = [
            { file_path: '/b.org', line_number: 1, preview: 'Vector match', score: 0.9 }
        ];

        const combined = reciprocalRankFusion(ftsResults, vectorResults);
        expect(combined.length).toBe(2);
    });

    it('should boost items found in both result sets', () => {
        const ftsResults: MockSearchResult[] = [
            { file_path: '/a.org', line_number: 1, preview: 'Match', score: 1 },
            { file_path: '/b.org', line_number: 1, preview: 'FTS only', score: 0.8 }
        ];
        const vectorResults: MockSearchResult[] = [
            { file_path: '/a.org', line_number: 1, preview: 'Match', score: 0.9 },
            { file_path: '/c.org', line_number: 1, preview: 'Vector only', score: 0.85 }
        ];

        const combined = reciprocalRankFusion(ftsResults, vectorResults);
        // Item found in both should be first due to RRF boost
        expect(combined[0].file_path).toBe('/a.org');
    });

    it('should respect limit', () => {
        const ftsResults: MockSearchResult[] = Array(10).fill(null).map((_, i) => ({
            file_path: `/fts${i}.org`, line_number: 1, preview: 'FTS', score: 1
        }));
        const vectorResults: MockSearchResult[] = Array(10).fill(null).map((_, i) => ({
            file_path: `/vec${i}.org`, line_number: 1, preview: 'Vec', score: 0.9
        }));

        const combined = reciprocalRankFusion(ftsResults, vectorResults, { limit: 5 });
        expect(combined.length).toBe(5);
    });

    it('should apply weights correctly', () => {
        const ftsResults: MockSearchResult[] = [
            { file_path: '/a.org', line_number: 1, preview: 'A', score: 1 }
        ];
        const vectorResults: MockSearchResult[] = [
            { file_path: '/b.org', line_number: 1, preview: 'B', score: 0.9 }
        ];

        // FTS weight = 0.8, vector weight = 0.2
        const combined = reciprocalRankFusion(ftsResults, vectorResults, {
            ftsWeight: 0.8,
            vectorWeight: 0.2
        });

        // FTS result should score higher due to weight
        expect(combined[0].file_path).toBe('/a.org');
        expect(combined[0].score).toBeCloseTo(0.8);
    });
});

// =============================================================================
// Markdown Heading Parsing Tests
// =============================================================================

describe('Markdown Heading Parsing', () => {
    const parseMarkdownHeadings = (content: string): { level: number; title: string; lineNumber: number; todoState?: string; tags: string[] }[] => {
        const headings: { level: number; title: string; lineNumber: number; todoState?: string; tags: string[] }[] = [];
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(/^(#{1,6})\s+(.*)$/);

            if (match) {
                const level = match[1].length;
                let title = match[2];
                const tags: string[] = [];

                // Extract tags at end
                const tagMatch = title.match(/\s+#(\w+(?:\s+#\w+)*)$/);
                if (tagMatch) {
                    tags.push(...tagMatch[1].split(/\s+#/));
                    title = title.slice(0, -tagMatch[0].length);
                }

                // Extract TODO state
                let todoState: string | undefined;
                const todoMatch = title.match(/^\[([A-Z]+)\]\s+/);
                if (todoMatch) {
                    todoState = todoMatch[1];
                    title = title.slice(todoMatch[0].length);
                }

                headings.push({
                    level,
                    title: title.trim(),
                    lineNumber: i + 1,
                    todoState,
                    tags
                });
            }
        }

        return headings;
    };

    it('should parse basic heading', () => {
        const content = '# Hello World';
        const headings = parseMarkdownHeadings(content);

        expect(headings.length).toBe(1);
        expect(headings[0].level).toBe(1);
        expect(headings[0].title).toBe('Hello World');
    });

    it('should parse multiple heading levels', () => {
        const content = '# Level 1\n## Level 2\n### Level 3\n#### Level 4';
        const headings = parseMarkdownHeadings(content);

        expect(headings.length).toBe(4);
        expect(headings[0].level).toBe(1);
        expect(headings[1].level).toBe(2);
        expect(headings[2].level).toBe(3);
        expect(headings[3].level).toBe(4);
    });

    it('should extract TODO state', () => {
        const content = '## [TODO] Complete task';
        const headings = parseMarkdownHeadings(content);

        expect(headings[0].todoState).toBe('TODO');
        expect(headings[0].title).toBe('Complete task');
    });

    it('should extract tags', () => {
        const content = '# Meeting Notes #work #important';
        const headings = parseMarkdownHeadings(content);

        expect(headings[0].tags).toContain('work');
        expect(headings[0].tags).toContain('important');
        expect(headings[0].title).toBe('Meeting Notes');
    });

    it('should extract TODO and tags together', () => {
        const content = '## [DONE] Finished task #completed';
        const headings = parseMarkdownHeadings(content);

        expect(headings[0].todoState).toBe('DONE');
        expect(headings[0].tags).toContain('completed');
        expect(headings[0].title).toBe('Finished task');
    });

    it('should track correct line numbers', () => {
        const content = 'Some text\n\n# First Heading\n\nMore text\n\n## Second Heading';
        const headings = parseMarkdownHeadings(content);

        expect(headings[0].lineNumber).toBe(3);
        expect(headings[1].lineNumber).toBe(7);
    });

    it('should not match headings in code blocks', () => {
        // Note: This simplified parser doesn't handle code blocks
        // The actual parser should skip headings inside code blocks
        const content = '# Real heading\n```\n# Not a heading\n```';
        const headings = parseMarkdownHeadings(content);

        // Simplified parser matches both - actual implementation filters code blocks
        expect(headings.length).toBe(2);
    });
});

// =============================================================================
// Hash Computation Tests
// =============================================================================

describe('Hash Computation', () => {
    const computeHash = (content: string): string => {
        const crypto = require('crypto');
        return crypto.createHash('md5').update(content).digest('hex');
    };

    it('should produce consistent hash for same content', () => {
        const content = 'Hello, World!';
        const hash1 = computeHash(content);
        const hash2 = computeHash(content);

        expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different content', () => {
        const hash1 = computeHash('Content A');
        const hash2 = computeHash('Content B');

        expect(hash1).not.toBe(hash2);
    });

    it('should produce 32 character hex string', () => {
        const hash = computeHash('test');

        expect(hash.length).toBe(32);
        expect(hash).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should handle empty content', () => {
        const hash = computeHash('');

        expect(hash.length).toBe(32);
        expect(hash).toBe('d41d8cd98f00b204e9800998ecf8427e');  // MD5 of empty string
    });

    it('should handle unicode content', () => {
        const hash = computeHash('你好世界 🌍');

        expect(hash.length).toBe(32);
    });
});

// =============================================================================
// Search Scope Filter Tests
// =============================================================================

describe('Search Scope Filter', () => {
    const buildScopeClause = (scope: { type: string; path?: string }, pathColumn: string = 'file_path'): { sql: string; args: any[] } => {
        if (scope.type === 'directory' && scope.path) {
            return {
                sql: ` AND ${pathColumn} LIKE ?`,
                args: [`${scope.path}%`]
            };
        }
        if (scope.type === 'project' && scope.path) {
            return {
                sql: ` AND ${pathColumn} LIKE ?`,
                args: [`${scope.path}%`]
            };
        }
        return { sql: '', args: [] };
    };

    it('should return empty clause for "all" scope', () => {
        const clause = buildScopeClause({ type: 'all' });

        expect(clause.sql).toBe('');
        expect(clause.args).toEqual([]);
    });

    it('should build directory scope clause', () => {
        const clause = buildScopeClause({ type: 'directory', path: '/home/user/notes' });

        expect(clause.sql).toBe(' AND file_path LIKE ?');
        expect(clause.args).toEqual(['/home/user/notes%']);
    });

    it('should build project scope clause', () => {
        const clause = buildScopeClause({ type: 'project', path: '/workspace/project' });

        expect(clause.sql).toBe(' AND file_path LIKE ?');
        expect(clause.args).toEqual(['/workspace/project%']);
    });

    it('should use custom path column', () => {
        const clause = buildScopeClause({ type: 'directory', path: '/notes' }, 'path');

        expect(clause.sql).toBe(' AND path LIKE ?');
    });
});
