/**
 * The unified parser classifies TODO keywords as active or done using the
 * file's own #+TODO line, falling back to the defaults.
 */
import { describe, it, expect } from 'vitest';
import { OrgParserUnified, parseOrg } from '../orgParserUnified';
import type { HeadlineElement } from '../orgElementTypes';

function headlines(content: string, parser?: OrgParserUnified): HeadlineElement['properties'][] {
    const doc = parser ? parser.parse(content) : parseOrg(content);
    return (doc.children as HeadlineElement[]).map(h => h.properties);
}

describe('in-buffer #+TODO keywords', () => {
    it('treats keywords after | as done', () => {
        const [a, b, c] = headlines([
            '#+todo: TODO NEXT WAITING | DONE CANCELED ABANDONED',
            '* NEXT Draft',
            '* CANCELED Kareem first paper',
            '* ABANDONED Old idea',
        ].join('\n'));
        expect(a).toMatchObject({ todoKeyword: 'NEXT', todoType: 'todo' });
        expect(b).toMatchObject({ todoKeyword: 'CANCELED', todoType: 'done' });
        expect(c).toMatchObject({ todoKeyword: 'ABANDONED', todoType: 'done' });
    });

    it('lets the file reclassify a default keyword', () => {
        const [a] = headlines('#+TODO: TODO CANCELLED | DONE\n* CANCELLED Revisit later');
        expect(a).toMatchObject({ todoKeyword: 'CANCELLED', todoType: 'todo' });
    });

    it('uses the defaults when the file declares nothing', () => {
        const [a, b, c] = headlines('* CANCELED One\n* CANCELLED Two\n* WAITING Three');
        expect(a.todoType).toBe('done');
        expect(b.todoType).toBe('done');
        expect(c.todoType).toBe('todo');
    });

    it('does not leak keywords between files parsed by one parser', () => {
        const parser = new OrgParserUnified();
        headlines('#+TODO: TODO | ABANDONED\n* ABANDONED x', parser);
        const [a] = headlines('* ABANDONED x', parser);
        expect(a.todoKeyword).toBeUndefined();
    });

    it('lets explicit config override the file', () => {
        const parser = new OrgParserUnified({ todoKeywords: ['TODO'], doneKeywords: ['DONE'] });
        const [a] = headlines('#+TODO: TODO | ABANDONED\n* ABANDONED x', parser);
        expect(a.todoKeyword).toBeUndefined();
    });
});
