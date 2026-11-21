import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => ({}));
import { drawingFileName, drawingLink, headingTitleAbove, slugify } from '../newDrawing';

describe('new drawing helpers', () => {
    it('gives the drawing an Excalidraw extension', () => {
        expect(drawingFileName('diagrams/train')).toBe('diagrams/train.excalidraw.svg');
        expect(drawingFileName('train.svg')).toBe('train.excalidraw.svg');
        expect(drawingFileName(' a.excalidraw ')).toBe('a.excalidraw');
        expect(drawingFileName('a.excalidraw.json')).toBe('a.excalidraw.json');
        expect(drawingFileName('a.excalidraw.svg')).toBe('a.excalidraw.svg');
    });

    it('slugs heading titles', () => {
        expect(slugify('REE separation train')).toBe('ree-separation-train');
        expect(slugify('See [[https://x.org][the paper]]!')).toBe('see-the-paper');
        expect(slugify('***')).toBe('drawing');
    });

    it('links for org and Markdown', () => {
        expect(drawingLink('diagrams/a.excalidraw.svg', 'org')).toBe('[[file:diagrams/a.excalidraw.svg]]');
        expect(drawingLink('my diagrams/a.excalidraw.svg', 'markdown')).toBe('![](my%20diagrams/a.excalidraw.svg)');
    });

    it('finds the heading above the cursor without its keyword or priority', () => {
        const text = '#+TITLE: x\n* REE separation train\ntext\n** TODO [#A] Feed conditioning :tag:\nbody\n';
        expect(headingTitleAbove(text, 0)).toBeUndefined();
        expect(headingTitleAbove(text, 2)).toBe('REE separation train');
        expect(headingTitleAbove(text, 4)).toBe('Feed conditioning');
    });
});
