/**
 * Tests for Excalidraw integration
 * Tests hover previews and link handling for Excalidraw files
 */

import { describe, it, expect } from 'vitest';

// Helper function to check if a file path is an Excalidraw file
// This mirrors the logic in hoverProvider.ts and orgLinkProvider.ts
const EXCALIDRAW_EXTENSIONS = ['.excalidraw', '.excalidraw.json', '.excalidraw.svg', '.excalidraw.png'];

function isExcalidrawFile(filePath: string): boolean {
    const lowerPath = filePath.toLowerCase();
    return EXCALIDRAW_EXTENSIONS.some(ext => lowerPath.endsWith(ext));
}

describe('Excalidraw Integration', () => {
    describe('isExcalidrawFile', () => {
        it('should detect .excalidraw files', () => {
            expect(isExcalidrawFile('diagram.excalidraw')).toBe(true);
            expect(isExcalidrawFile('path/to/drawing.excalidraw')).toBe(true);
            expect(isExcalidrawFile('/absolute/path/file.excalidraw')).toBe(true);
        });

        it('should detect .excalidraw.json files', () => {
            expect(isExcalidrawFile('diagram.excalidraw.json')).toBe(true);
            expect(isExcalidrawFile('path/to/drawing.excalidraw.json')).toBe(true);
        });

        it('should detect .excalidraw.svg files', () => {
            expect(isExcalidrawFile('diagram.excalidraw.svg')).toBe(true);
            expect(isExcalidrawFile('path/to/drawing.excalidraw.svg')).toBe(true);
        });

        it('should detect .excalidraw.png files', () => {
            expect(isExcalidrawFile('diagram.excalidraw.png')).toBe(true);
            expect(isExcalidrawFile('path/to/drawing.excalidraw.png')).toBe(true);
        });

        it('should be case-insensitive', () => {
            expect(isExcalidrawFile('diagram.EXCALIDRAW')).toBe(true);
            expect(isExcalidrawFile('diagram.Excalidraw.JSON')).toBe(true);
            expect(isExcalidrawFile('diagram.excalidraw.SVG')).toBe(true);
            expect(isExcalidrawFile('diagram.EXCALIDRAW.PNG')).toBe(true);
        });

        it('should not detect non-Excalidraw files', () => {
            expect(isExcalidrawFile('diagram.svg')).toBe(false);
            expect(isExcalidrawFile('diagram.png')).toBe(false);
            expect(isExcalidrawFile('diagram.json')).toBe(false);
            expect(isExcalidrawFile('file.txt')).toBe(false);
            expect(isExcalidrawFile('excalidraw.md')).toBe(false);
        });

        it('should not match partial extensions', () => {
            expect(isExcalidrawFile('myexcalidraw')).toBe(false);
            expect(isExcalidrawFile('file.notexcalidraw')).toBe(false);
        });
    });

    describe('Excalidraw link matching', () => {
        // Test the link pattern matching used in hover and link providers
        const linkPattern = /\[\[(?:file:)?([^\]]+?)(?:\]\[([^\]]*))?\]\]/g;

        it('should match basic Excalidraw links', () => {
            const text = '[[diagram.excalidraw]]';
            const match = linkPattern.exec(text);
            expect(match).not.toBeNull();
            expect(match![1]).toBe('diagram.excalidraw');
        });

        it('should match Excalidraw links with file: prefix', () => {
            linkPattern.lastIndex = 0;
            const text = '[[file:diagram.excalidraw]]';
            const match = linkPattern.exec(text);
            expect(match).not.toBeNull();
            expect(match![1]).toBe('diagram.excalidraw');
        });

        it('should match Excalidraw links with description', () => {
            linkPattern.lastIndex = 0;
            const text = '[[diagram.excalidraw][My Drawing]]';
            const match = linkPattern.exec(text);
            expect(match).not.toBeNull();
            expect(match![1]).toBe('diagram.excalidraw');
            expect(match![2]).toBe('My Drawing');
        });

        it('should match Excalidraw links with path', () => {
            linkPattern.lastIndex = 0;
            const text = '[[./images/diagram.excalidraw.svg]]';
            const match = linkPattern.exec(text);
            expect(match).not.toBeNull();
            expect(match![1]).toBe('./images/diagram.excalidraw.svg');
        });

        it('should match Excalidraw links with file: prefix and description', () => {
            linkPattern.lastIndex = 0;
            const text = '[[file:assets/arch.excalidraw.png][Architecture Diagram]]';
            const match = linkPattern.exec(text);
            expect(match).not.toBeNull();
            expect(match![1]).toBe('assets/arch.excalidraw.png');
            expect(match![2]).toBe('Architecture Diagram');
        });
    });

    describe('Excalidraw JSON structure', () => {
        // Test the empty Excalidraw structure created for new files
        const createEmptyExcalidraw = () => ({
            type: 'excalidraw',
            version: 2,
            source: 'scimax-vscode',
            elements: [],
            appState: {
                viewBackgroundColor: '#ffffff'
            },
            files: {}
        });

        it('should create valid empty Excalidraw structure', () => {
            const empty = createEmptyExcalidraw();
            expect(empty.type).toBe('excalidraw');
            expect(empty.version).toBe(2);
            expect(empty.elements).toEqual([]);
            expect(empty.appState.viewBackgroundColor).toBe('#ffffff');
            expect(empty.files).toEqual({});
        });

        it('should be valid JSON', () => {
            const empty = createEmptyExcalidraw();
            const json = JSON.stringify(empty, null, 2);
            const parsed = JSON.parse(json);
            expect(parsed.type).toBe('excalidraw');
            expect(parsed.elements).toEqual([]);
        });
    });

    describe('Excalidraw export path resolution', () => {
        // Test the logic for finding companion export files
        const findExportPath = (basePath: string): string[] => {
            return [
                basePath + '.svg',
                basePath + '.png',
                basePath.replace(/\.excalidraw(\.json)?$/, '.excalidraw.svg'),
                basePath.replace(/\.excalidraw(\.json)?$/, '.excalidraw.png'),
            ];
        };

        it('should generate correct export paths for .excalidraw files', () => {
            const paths = findExportPath('/path/to/diagram.excalidraw');
            expect(paths).toContain('/path/to/diagram.excalidraw.svg');
            expect(paths).toContain('/path/to/diagram.excalidraw.png');
        });

        it('should generate correct export paths for .excalidraw.json files', () => {
            const paths = findExportPath('/path/to/diagram.excalidraw.json');
            expect(paths).toContain('/path/to/diagram.excalidraw.svg');
            expect(paths).toContain('/path/to/diagram.excalidraw.png');
        });
    });
});
