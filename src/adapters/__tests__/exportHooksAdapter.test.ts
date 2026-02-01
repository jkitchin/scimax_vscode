/**
 * Tests for Export Hooks Adapter
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock VS Code API
vi.mock('vscode', () => ({
    Disposable: class {
        constructor(private callback: () => void) {}
        dispose() {
            this.callback();
        }
    },
}));
import {
    exportHookRegistry,
    registerExportHook,
    createWrapperHook,
    createElementReplacerHook,
    ExportHook,
} from '../exportHooksAdapter';

describe('ExportHookRegistry', () => {
    beforeEach(() => {
        exportHookRegistry.clear();
    });

    afterEach(() => {
        exportHookRegistry.clear();
    });

    describe('registration', () => {
        it('should register a hook', () => {
            const hook: ExportHook = {
                id: 'test-hook',
                postExport: (output) => output + ' modified',
            };

            const disposable = registerExportHook(hook);
            expect(exportHookRegistry.hasHook('test-hook')).toBe(true);

            disposable.dispose();
            expect(exportHookRegistry.hasHook('test-hook')).toBe(false);
        });

        it('should throw if hook has no id', () => {
            const hook = { postExport: () => 'test' } as unknown as ExportHook;
            expect(() => registerExportHook(hook)).toThrow('Export hook must have an id');
        });

        it('should throw if hook id is already registered', () => {
            registerExportHook({ id: 'duplicate' });
            expect(() => registerExportHook({ id: 'duplicate' })).toThrow(
                "Export hook with id 'duplicate' is already registered"
            );
        });

        it('should return all hook ids', () => {
            registerExportHook({ id: 'hook-1' });
            registerExportHook({ id: 'hook-2' });
            registerExportHook({ id: 'hook-3' });

            const ids = exportHookRegistry.getHookIds();
            expect(ids).toContain('hook-1');
            expect(ids).toContain('hook-2');
            expect(ids).toContain('hook-3');
        });

        it('should unregister by id', () => {
            registerExportHook({ id: 'to-remove' });
            expect(exportHookRegistry.hasHook('to-remove')).toBe(true);

            const removed = exportHookRegistry.unregister('to-remove');
            expect(removed).toBe(true);
            expect(exportHookRegistry.hasHook('to-remove')).toBe(false);
        });
    });

    describe('priority ordering', () => {
        it('should order hooks by priority (higher first)', () => {
            registerExportHook({ id: 'low', priority: 1 });
            registerExportHook({ id: 'high', priority: 100 });
            registerExportHook({ id: 'medium', priority: 50 });

            const hooks = exportHookRegistry.getHooks();
            expect(hooks[0].id).toBe('high');
            expect(hooks[1].id).toBe('medium');
            expect(hooks[2].id).toBe('low');
        });

        it('should use 0 as default priority', () => {
            registerExportHook({ id: 'no-priority' });
            registerExportHook({ id: 'negative', priority: -10 });
            registerExportHook({ id: 'positive', priority: 10 });

            const hooks = exportHookRegistry.getHooks();
            expect(hooks[0].id).toBe('positive');
            expect(hooks[1].id).toBe('no-priority');
            expect(hooks[2].id).toBe('negative');
        });
    });

    describe('preExport hooks', () => {
        it('should run preExport hooks and return modified options', () => {
            registerExportHook({
                id: 'add-toc',
                preExport: (ctx) => ({ ...ctx.options, toc: true }),
            });

            const result = exportHookRegistry.runPreExportHooks({
                document: { type: 'org-document', children: [], keywords: {}, properties: {} } as any,
                options: { toc: false },
                backend: 'html',
            });

            expect(result.toc).toBe(true);
        });

        it('should chain multiple preExport hooks', () => {
            registerExportHook({
                id: 'hook-1',
                priority: 10,
                preExport: (ctx) => ({ ...ctx.options, title: 'Modified' }),
            });
            registerExportHook({
                id: 'hook-2',
                priority: 5,
                preExport: (ctx) => ({ ...ctx.options, author: ctx.options.title + ' Author' }),
            });

            const result = exportHookRegistry.runPreExportHooks({
                document: { type: 'org-document', children: [], keywords: {}, properties: {} } as any,
                options: { title: 'Original' },
                backend: 'html',
            });

            expect(result.title).toBe('Modified');
            expect(result.author).toBe('Modified Author');
        });

        it('should skip hooks that return undefined', () => {
            registerExportHook({
                id: 'skip-hook',
                preExport: () => undefined,
            });
            registerExportHook({
                id: 'modify-hook',
                preExport: (ctx) => ({ ...ctx.options, toc: true }),
            });

            const result = exportHookRegistry.runPreExportHooks({
                document: { type: 'org-document', children: [], keywords: {}, properties: {} } as any,
                options: { toc: false, author: 'Test' },
                backend: 'html',
            });

            expect(result.toc).toBe(true);
            expect(result.author).toBe('Test');
        });

        it('should handle errors gracefully', () => {
            registerExportHook({
                id: 'error-hook',
                preExport: () => { throw new Error('Test error'); },
            });

            const result = exportHookRegistry.runPreExportHooks({
                document: { type: 'org-document', children: [], keywords: {}, properties: {} } as any,
                options: { title: 'Original' },
                backend: 'html',
            });

            // Should return original options on error
            expect(result.title).toBe('Original');
        });
    });

    describe('postExport hooks', () => {
        it('should run postExport hooks and transform output', () => {
            registerExportHook({
                id: 'wrapper',
                postExport: (output) => `<wrapper>${output}</wrapper>`,
            });

            const result = exportHookRegistry.runPostExportHooks('<p>Content</p>', {
                backend: 'html',
                options: {},
            });

            expect(result).toBe('<wrapper><p>Content</p></wrapper>');
        });

        it('should chain multiple postExport hooks', () => {
            registerExportHook({
                id: 'first',
                priority: 10,
                postExport: (output) => output + ' [first]',
            });
            registerExportHook({
                id: 'second',
                priority: 5,
                postExport: (output) => output + ' [second]',
            });

            const result = exportHookRegistry.runPostExportHooks('Content', {
                backend: 'html',
                options: {},
            });

            expect(result).toBe('Content [first] [second]');
        });

        it('should skip hooks that return undefined', () => {
            registerExportHook({
                id: 'skip-hook',
                postExport: () => undefined,
            });

            const result = exportHookRegistry.runPostExportHooks('Original', {
                backend: 'html',
                options: {},
            });

            expect(result).toBe('Original');
        });

        it('should handle errors gracefully', () => {
            registerExportHook({
                id: 'error-hook',
                postExport: () => { throw new Error('Test error'); },
            });

            const result = exportHookRegistry.runPostExportHooks('Original', {
                backend: 'html',
                options: {},
            });

            expect(result).toBe('Original');
        });
    });

    describe('elementFilter hooks', () => {
        it('should run element filters', () => {
            registerExportHook({
                id: 'bold-filter',
                elementFilter: (rendered, ctx) => {
                    if (ctx.element.type === 'paragraph') {
                        return `<div class="para">${rendered}</div>`;
                    }
                    return undefined;
                },
            });

            const result = exportHookRegistry.runElementFilters('<p>Text</p>', {
                element: { type: 'paragraph' } as any,
                backend: 'html',
                options: {},
            });

            expect(result).toBe('<div class="para"><p>Text</p></div>');
        });

        it('should return original if no hook modifies', () => {
            registerExportHook({
                id: 'skip-filter',
                elementFilter: () => undefined,
            });

            const result = exportHookRegistry.runElementFilters('<p>Original</p>', {
                element: { type: 'paragraph' } as any,
                backend: 'html',
                options: {},
            });

            expect(result).toBe('<p>Original</p>');
        });

        it('should chain multiple element filters', () => {
            registerExportHook({
                id: 'filter-1',
                priority: 10,
                elementFilter: (rendered) => rendered.replace('Text', 'Modified'),
            });
            registerExportHook({
                id: 'filter-2',
                priority: 5,
                elementFilter: (rendered) => rendered.toUpperCase(),
            });

            const result = exportHookRegistry.runElementFilters('<p>Text</p>', {
                element: { type: 'paragraph' } as any,
                backend: 'html',
                options: {},
            });

            expect(result).toBe('<P>MODIFIED</P>');
        });
    });
});

describe('createWrapperHook', () => {
    beforeEach(() => {
        exportHookRegistry.clear();
    });

    afterEach(() => {
        exportHookRegistry.clear();
    });

    it('should create a hook that wraps output', () => {
        const hook = createWrapperHook('test-wrapper', {
            before: '<!-- START -->',
            after: '<!-- END -->',
        });

        registerExportHook(hook);

        const result = exportHookRegistry.runPostExportHooks('<p>Content</p>', {
            backend: 'html',
            options: {},
        });

        expect(result).toBe('<!-- START --><p>Content</p><!-- END -->');
    });

    it('should filter by backend', () => {
        const hook = createWrapperHook('html-only', {
            backend: 'html',
            before: '<!-- HTML -->',
        });

        registerExportHook(hook);

        const htmlResult = exportHookRegistry.runPostExportHooks('Content', {
            backend: 'html',
            options: {},
        });
        expect(htmlResult).toBe('<!-- HTML -->Content');

        const latexResult = exportHookRegistry.runPostExportHooks('Content', {
            backend: 'latex',
            options: {},
        });
        expect(latexResult).toBe('Content');
    });

    it('should filter by multiple backends', () => {
        const hook = createWrapperHook('html-latex', {
            backend: ['html', 'latex'],
            before: '/* MODIFIED */',
        });

        registerExportHook(hook);

        const htmlResult = exportHookRegistry.runPostExportHooks('Content', {
            backend: 'html',
            options: {},
        });
        expect(htmlResult).toBe('/* MODIFIED */Content');

        const latexResult = exportHookRegistry.runPostExportHooks('Content', {
            backend: 'latex',
            options: {},
        });
        expect(latexResult).toBe('/* MODIFIED */Content');

        const textResult = exportHookRegistry.runPostExportHooks('Content', {
            backend: 'text',
            options: {},
        });
        expect(textResult).toBe('Content');
    });
});

describe('createElementReplacerHook', () => {
    beforeEach(() => {
        exportHookRegistry.clear();
    });

    afterEach(() => {
        exportHookRegistry.clear();
    });

    it('should create a hook that replaces specific elements', () => {
        const hook = createElementReplacerHook('para-replacer', {
            elementType: 'paragraph',
            replace: (rendered) => `<custom>${rendered}</custom>`,
        });

        registerExportHook(hook);

        const paraResult = exportHookRegistry.runElementFilters('<p>Text</p>', {
            element: { type: 'paragraph' } as any,
            backend: 'html',
            options: {},
        });
        expect(paraResult).toBe('<custom><p>Text</p></custom>');

        const headlineResult = exportHookRegistry.runElementFilters('<h1>Title</h1>', {
            element: { type: 'headline' } as any,
            backend: 'html',
            options: {},
        });
        expect(headlineResult).toBe('<h1>Title</h1>');
    });

    it('should filter by multiple element types', () => {
        const hook = createElementReplacerHook('multi-type', {
            elementType: ['paragraph', 'headline'],
            replace: (rendered) => `[${rendered}]`,
        });

        registerExportHook(hook);

        const paraResult = exportHookRegistry.runElementFilters('<p>Text</p>', {
            element: { type: 'paragraph' } as any,
            backend: 'html',
            options: {},
        });
        expect(paraResult).toBe('[<p>Text</p>]');

        const headlineResult = exportHookRegistry.runElementFilters('<h1>Title</h1>', {
            element: { type: 'headline' } as any,
            backend: 'html',
            options: {},
        });
        expect(headlineResult).toBe('[<h1>Title</h1>]');
    });

    it('should filter by backend', () => {
        const hook = createElementReplacerHook('html-para', {
            elementType: 'paragraph',
            backend: 'html',
            replace: (rendered) => `<div>${rendered}</div>`,
        });

        registerExportHook(hook);

        const htmlResult = exportHookRegistry.runElementFilters('<p>Text</p>', {
            element: { type: 'paragraph' } as any,
            backend: 'html',
            options: {},
        });
        expect(htmlResult).toBe('<div><p>Text</p></div>');

        const latexResult = exportHookRegistry.runElementFilters('\\paragraph{Text}', {
            element: { type: 'paragraph' } as any,
            backend: 'latex',
            options: {},
        });
        expect(latexResult).toBe('\\paragraph{Text}');
    });

    it('should provide element to replace function', () => {
        const hook = createElementReplacerHook('element-access', {
            elementType: 'headline',
            replace: (rendered, element) => {
                const headline = element as any;
                return `<!-- Level: ${headline.properties?.level || 'unknown'} -->${rendered}`;
            },
        });

        registerExportHook(hook);

        const result = exportHookRegistry.runElementFilters('<h2>Title</h2>', {
            element: { type: 'headline', properties: { level: 2 } } as any,
            backend: 'html',
            options: {},
        });
        expect(result).toBe('<!-- Level: 2 --><h2>Title</h2>');
    });
});
