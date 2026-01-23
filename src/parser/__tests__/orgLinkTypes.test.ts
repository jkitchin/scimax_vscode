/**
 * Tests for org-mode link type handlers, especially notebook links
 */

import { describe, it, expect } from 'vitest';
import {
    linkTypeRegistry,
    notebookHandler,
    type LinkContext,
    type ProjectInfo,
} from '../orgLinkTypes';

describe('orgLinkTypes', () => {
    describe('linkTypeRegistry', () => {
        it('should have notebook handler registered', () => {
            expect(linkTypeRegistry.hasType('nb')).toBe(true);
        });

        it('should return notebook handler for nb type', () => {
            const handler = linkTypeRegistry.getHandler('nb');
            expect(handler).toBeDefined();
            expect(handler?.type).toBe('nb');
        });
    });

    describe('notebookHandler', () => {
        const mockProjects: ProjectInfo[] = [
            { name: 'my-research', path: '/home/user/projects/my-research' },
            { name: 'scimax', path: '/home/user/projects/scimax' },
            { name: 'data-analysis', path: '/home/user/projects/data-analysis' },
        ];

        const createContext = (projects: ProjectInfo[] = mockProjects): LinkContext => ({
            getProjects: () => projects,
            listProjectFiles: async (projectPath: string) => [
                `${projectPath}/README.org`,
                `${projectPath}/notes.org`,
                `${projectPath}/data/results.org`,
            ],
        });

        describe('resolve', () => {
            it('should resolve valid notebook link', async () => {
                const result = await notebookHandler.resolve('my-research::README.org', createContext());
                expect(result.exists).toBe(true);
                expect(result.displayText).toBe('my-research::README.org');
                expect(result.url).toContain('/home/user/projects/my-research/README.org');
            });

            it('should resolve link with nested file path', async () => {
                const result = await notebookHandler.resolve('my-research::data/results.org', createContext());
                expect(result.exists).toBe(true);
                expect(result.url).toContain('/home/user/projects/my-research/data/results.org');
            });

            it('should resolve link with line number target', async () => {
                const result = await notebookHandler.resolve('my-research::notes.org::42', createContext());
                expect(result.exists).toBe(true);
                expect(result.metadata?.target).toBe('42');
                expect(result.tooltip).toContain('42');
            });

            it('should resolve link with character offset target', async () => {
                const result = await notebookHandler.resolve('my-research::notes.org::c1234', createContext());
                expect(result.exists).toBe(true);
                expect(result.metadata?.target).toBe('c1234');
            });

            it('should resolve link with heading target', async () => {
                const result = await notebookHandler.resolve('my-research::paper.org::*Methods', createContext());
                expect(result.exists).toBe(true);
                expect(result.metadata?.target).toBe('*Methods');
            });

            it('should resolve link with custom ID target', async () => {
                const result = await notebookHandler.resolve('my-research::paper.org::#intro', createContext());
                expect(result.exists).toBe(true);
                expect(result.metadata?.target).toBe('#intro');
            });

            it('should handle case-insensitive project name matching', async () => {
                const result = await notebookHandler.resolve('MY-RESEARCH::README.org', createContext());
                expect(result.exists).toBe(true);
            });

            it('should report project not found', async () => {
                const result = await notebookHandler.resolve('unknown-project::file.org', createContext());
                expect(result.exists).toBe(false);
                expect(result.tooltip).toContain('not found');
            });

            it('should report invalid link format (missing file)', async () => {
                const result = await notebookHandler.resolve('my-research', createContext());
                expect(result.exists).toBe(false);
                expect(result.tooltip).toContain('Invalid');
            });

            it('should handle ambiguous project matches', async () => {
                const duplicateProjects: ProjectInfo[] = [
                    { name: 'project', path: '/path/a/project' },
                    { name: 'project', path: '/path/b/project' },
                ];
                const result = await notebookHandler.resolve('project::file.org', createContext(duplicateProjects));
                expect(result.metadata?.ambiguous).toBe(true);
                expect(result.metadata?.candidates).toHaveLength(2);
            });

            it('should work with empty projects list', async () => {
                const result = await notebookHandler.resolve('project::file.org', createContext([]));
                expect(result.exists).toBe(false);
            });

            it('should work without getProjects callback', async () => {
                const result = await notebookHandler.resolve('project::file.org', {});
                expect(result.exists).toBe(false);
            });
        });

        describe('export', () => {
            it('should export to HTML', () => {
                const html = notebookHandler.export!(
                    'my-research::paper.org',
                    'Research Paper',
                    'html',
                    createContext()
                );
                expect(html).toContain('Research Paper');
                expect(html).toContain('paper.html');
            });

            it('should export to HTML without description', () => {
                const html = notebookHandler.export!(
                    'my-research::paper.org',
                    undefined,
                    'html',
                    createContext()
                );
                expect(html).toContain('my-research::paper.org');
            });

            it('should export to LaTeX', () => {
                const latex = notebookHandler.export!(
                    'my-research::paper.org',
                    'Research Paper',
                    'latex',
                    createContext()
                );
                expect(latex).toContain('\\texttt{');
                expect(latex).toContain('Research Paper');
            });

            it('should export to text', () => {
                const text = notebookHandler.export!(
                    'my-research::paper.org',
                    'Research Paper',
                    'text',
                    createContext()
                );
                expect(text).toBe('Research Paper');
            });
        });

        describe('complete', () => {
            it('should complete project names', async () => {
                const completions = await notebookHandler.complete!('my-', createContext());
                expect(completions.length).toBeGreaterThan(0);
                expect(completions[0].text).toContain('my-research::');
            });

            it('should complete file paths after project name', async () => {
                const completions = await notebookHandler.complete!('my-research::README', createContext());
                expect(completions.some(c => c.text.includes('README.org'))).toBe(true);
            });

            it('should return empty for unknown prefix', async () => {
                const completions = await notebookHandler.complete!('xyz', createContext());
                expect(completions).toHaveLength(0);
            });

            it('should work without callbacks', async () => {
                const completions = await notebookHandler.complete!('my-', {});
                expect(completions).toHaveLength(0);
            });
        });
    });

    describe('parseNotebookLinkPath edge cases', () => {
        // Test through resolve since parseNotebookLinkPath is internal
        const mockContext: LinkContext = {
            getProjects: () => [
                { name: 'test', path: '/test' },
            ],
        };

        it('should handle empty project name', async () => {
            const result = await notebookHandler.resolve('::file.org', mockContext);
            expect(result.exists).toBe(false);
        });

        it('should handle empty file path', async () => {
            const result = await notebookHandler.resolve('test::', mockContext);
            expect(result.exists).toBe(false);
        });

        it('should handle multiple :: separators', async () => {
            const result = await notebookHandler.resolve('test::file.org::123::extra', mockContext);
            // Should parse: project=test, file=file.org, target=123::extra
            expect(result.metadata?.projectName).toBe('test');
            expect(result.metadata?.filePath).toBe('file.org');
            expect(result.metadata?.target).toBe('123::extra');
        });

        it('should handle paths with spaces (URL encoded)', async () => {
            const result = await notebookHandler.resolve('test::my file.org', mockContext);
            expect(result.metadata?.filePath).toBe('my file.org');
        });

        it('should handle Windows-style backslashes in path', async () => {
            const windowsProjects: ProjectInfo[] = [
                { name: 'project', path: 'C:\\Users\\test\\project' },
            ];
            const result = await notebookHandler.resolve('project::file.org', {
                getProjects: () => windowsProjects,
            });
            expect(result.exists).toBe(true);
            // Path should be normalized to forward slashes
            expect(result.url).toContain('/');
        });
    });
});
