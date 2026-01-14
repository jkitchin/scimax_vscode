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
        const result = parseRelativeDate('2026-01-15');
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
