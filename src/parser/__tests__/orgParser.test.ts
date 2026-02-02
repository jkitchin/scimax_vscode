/**
 * Comprehensive tests for the org-mode parser
 */

import { describe, it, expect } from 'vitest';
import { parseColonAttributes, parseCaption, parseAffiliatedKeywords, serializeAffiliatedKeywords } from '../orgAffiliatedKeywords';
import { parseObjects } from '../orgObjects';
import { ORG_ENTITIES, getEntity, isValidEntity } from '../orgEntities';
import type {
    BoldObject,
    ItalicObject,
    CodeObject,
    VerbatimObject,
    LinkObject,
    TimestampObject,
    EntityObject,
    LatexFragmentObject,
    SubscriptObject,
    SuperscriptObject,
    StatisticsCookieObject,
    FootnoteReferenceObject,
    PlainTextObject,
    InlineSrcBlockObject,
    MacroObject,
} from '../orgElementTypes';

// =============================================================================
// Affiliated Keywords Tests
// =============================================================================

describe('Affiliated Keywords Parser', () => {
    describe('parseColonAttributes', () => {
        it('should parse simple key-value pairs', () => {
            const result = parseColonAttributes(':width 0.8 :float t');
            expect(result).toEqual({
                width: '0.8',
                float: 't',
            });
        });

        it('should parse values with special characters', () => {
            const result = parseColonAttributes(':width 0.8\\textwidth :placement [H]');
            expect(result).toEqual({
                width: '0.8\\textwidth',
                placement: '[H]',
            });
        });

        it('should handle empty string', () => {
            const result = parseColonAttributes('');
            expect(result).toEqual({});
        });

        it('should handle whitespace only', () => {
            const result = parseColonAttributes('   ');
            expect(result).toEqual({});
        });

        it('should parse multiple attributes', () => {
            const result = parseColonAttributes(':environment longtable :align |l|c|r| :booktabs yes');
            expect(result).toEqual({
                environment: 'longtable',
                align: '|l|c|r|',
                booktabs: 'yes',
            });
        });
    });

    describe('parseCaption', () => {
        it('should parse simple caption', () => {
            const result = parseCaption('This is a caption');
            expect(result.caption).toBe('This is a caption');
            expect(result.inlineLabel).toBeUndefined();
        });

        it('should parse caption with short form', () => {
            const result = parseCaption('[Short]Long caption text');
            expect(result.caption).toEqual(['Short', 'Long caption text']);
            expect(result.inlineLabel).toBeUndefined();
        });

        it('should handle empty short caption', () => {
            const result = parseCaption('[]Long caption');
            expect(result.caption).toEqual(['', 'Long caption']);
            expect(result.inlineLabel).toBeUndefined();
        });

        it('should extract inline label from end of caption', () => {
            const result = parseCaption('This is a caption label:fig-example');
            expect(result.caption).toBe('This is a caption');
            expect(result.inlineLabel).toBe('fig-example');
        });

        it('should extract inline label with short form caption', () => {
            const result = parseCaption('[Short]Long caption text label:my-label');
            expect(result.caption).toEqual(['Short', 'Long caption text']);
            expect(result.inlineLabel).toBe('my-label');
        });

        it('should handle label with hyphens and underscores', () => {
            const result = parseCaption('Caption text label:fig-my_complex-label-2');
            expect(result.caption).toBe('Caption text');
            expect(result.inlineLabel).toBe('fig-my_complex-label-2');
        });
    });

    describe('parseAffiliatedKeywords', () => {
        it('should parse single NAME keyword', () => {
            const lines = [
                '#+NAME: my-figure',
                '[[file:image.png]]',
            ];
            const result = parseAffiliatedKeywords(lines, 1);

            expect(result.affiliated?.name).toBe('my-figure');
            expect(result.consumedLines).toBe(1);
        });

        it('should parse CAPTION and NAME', () => {
            const lines = [
                '#+CAPTION: My figure caption',
                '#+NAME: fig:my-figure',
                '[[file:image.png]]',
            ];
            const result = parseAffiliatedKeywords(lines, 2);

            expect(result.affiliated?.caption).toBe('My figure caption');
            expect(result.affiliated?.name).toBe('fig:my-figure');
            expect(result.consumedLines).toBe(2);
        });

        it('should parse ATTR_LATEX', () => {
            const lines = [
                '#+ATTR_LATEX: :width 0.8\\textwidth :float t',
                '[[file:image.png]]',
            ];
            const result = parseAffiliatedKeywords(lines, 1);

            expect(result.affiliated?.attr.latex).toEqual({
                width: '0.8\\textwidth',
                float: 't',
            });
        });

        it('should parse multiple ATTR keywords for different backends', () => {
            const lines = [
                '#+ATTR_LATEX: :width 0.8\\textwidth',
                '#+ATTR_HTML: :width 80%',
                '[[file:image.png]]',
            ];
            const result = parseAffiliatedKeywords(lines, 2);

            expect(result.affiliated?.attr.latex).toEqual({ width: '0.8\\textwidth' });
            expect(result.affiliated?.attr.html).toEqual({ width: '80%' });
        });

        it('should parse HEADER keywords', () => {
            const lines = [
                '#+HEADER: :var x=5',
                '#+HEADER: :results output',
                '#+BEGIN_SRC python',
            ];
            const result = parseAffiliatedKeywords(lines, 2);

            expect(result.affiliated?.header).toEqual([':var x=5', ':results output']);
        });

        it('should stop at empty line', () => {
            const lines = [
                'Some text',
                '',
                '#+NAME: orphan',
                '#+CAPTION: Not affiliated',
                '',
                '#+NAME: my-table',
                '| a | b |',
            ];
            const result = parseAffiliatedKeywords(lines, 6);

            expect(result.affiliated?.name).toBe('my-table');
            expect(result.consumedLines).toBe(1);
        });

        it('should return undefined when no affiliated keywords', () => {
            const lines = [
                'Regular text',
                '| a | b |',
            ];
            const result = parseAffiliatedKeywords(lines, 1);

            expect(result.affiliated).toBeUndefined();
            expect(result.consumedLines).toBe(0);
        });
    });

    describe('serializeAffiliatedKeywords', () => {
        it('should serialize NAME', () => {
            const result = serializeAffiliatedKeywords({
                name: 'my-table',
                attr: {},
            });
            expect(result).toContain('#+NAME: my-table');
        });

        it('should serialize CAPTION with short form', () => {
            const result = serializeAffiliatedKeywords({
                caption: ['Short', 'Long caption'],
                attr: {},
            });
            expect(result).toContain('#+CAPTION: [Short]Long caption');
        });

        it('should serialize ATTR_LATEX', () => {
            const result = serializeAffiliatedKeywords({
                attr: {
                    latex: { width: '0.8\\textwidth', float: 't' },
                },
            });
            expect(result.some(l => l.startsWith('#+ATTR_LATEX:'))).toBe(true);
        });
    });
});

// =============================================================================
// Inline Objects Tests
// =============================================================================

describe('Inline Objects Parser', () => {
    describe('Plain Text', () => {
        it('should parse plain text', () => {
            const result = parseObjects('Hello world');
            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('plain-text');
            expect((result[0] as PlainTextObject).properties.value).toBe('Hello world');
        });
    });

    describe('Emphasis', () => {
        it('should parse bold text', () => {
            const result = parseObjects('This is *bold* text');
            expect(result).toHaveLength(3);
            expect(result[1].type).toBe('bold');
            const bold = result[1] as BoldObject;
            expect(bold.children).toHaveLength(1);
            expect((bold.children[0] as PlainTextObject).properties.value).toBe('bold');
        });

        it('should parse italic text', () => {
            const result = parseObjects('This is /italic/ text');
            expect(result).toHaveLength(3);
            expect(result[1].type).toBe('italic');
        });

        it('should parse underline text', () => {
            const result = parseObjects('This is _underline_ text');
            expect(result).toHaveLength(3);
            expect(result[1].type).toBe('underline');
        });

        it('should parse strike-through text', () => {
            const result = parseObjects('This is +deleted+ text');
            expect(result).toHaveLength(3);
            expect(result[1].type).toBe('strike-through');
        });

        it('should parse code', () => {
            const result = parseObjects('Use =code= here');
            expect(result).toHaveLength(3);
            expect(result[1].type).toBe('code');
            expect((result[1] as CodeObject).properties.value).toBe('code');
        });

        it('should parse verbatim', () => {
            const result = parseObjects('Use ~verbatim~ here');
            expect(result).toHaveLength(3);
            expect(result[1].type).toBe('verbatim');
            expect((result[1] as VerbatimObject).properties.value).toBe('verbatim');
        });

        it('should parse nested emphasis', () => {
            const result = parseObjects('This is *bold and /italic/* text');
            expect(result).toHaveLength(3);
            const bold = result[1] as BoldObject;
            expect(bold.type).toBe('bold');
            // The nested content should include italic
            expect(bold.children.some(c => c.type === 'italic')).toBe(true);
        });

        it('should not parse emphasis without proper boundaries', () => {
            const result = parseObjects('word*not bold*word');
            // Should not be parsed as bold because no pre-boundary
            expect(result.every(r => r.type === 'plain-text')).toBe(true);
        });
    });

    describe('Links', () => {
        it('should parse simple bracket link', () => {
            const result = parseObjects('See [[https://example.com]]');
            expect(result).toHaveLength(2);
            expect(result[1].type).toBe('link');
            const link = result[1] as LinkObject;
            expect(link.properties.linkType).toBe('https');
            expect(link.properties.path).toBe('https://example.com');
        });

        it('should parse bracket link with description', () => {
            const result = parseObjects('See [[https://example.com][Example Site]]');
            expect(result).toHaveLength(2);
            const link = result[1] as LinkObject;
            expect(link.properties.linkType).toBe('https');
            expect(link.children).toBeDefined();
            expect(link.children!.length).toBeGreaterThan(0);
        });

        it('should parse file link', () => {
            const result = parseObjects('Open [[file:./document.pdf]]');
            const link = result[1] as LinkObject;
            expect(link.properties.linkType).toBe('file');
            expect(link.properties.path).toBe('./document.pdf');
        });

        it('should parse file link with search option', () => {
            const result = parseObjects('See [[file:notes.org::*Heading]]');
            const link = result[1] as LinkObject;
            expect(link.properties.linkType).toBe('file');
            expect(link.properties.path).toBe('notes.org');
            expect(link.properties.searchOption).toBe('*Heading');
        });

        it('should parse id link', () => {
            const result = parseObjects('Link to [[id:abc-123-def]]');
            const link = result[1] as LinkObject;
            expect(link.properties.linkType).toBe('id');
            expect(link.properties.path).toBe('abc-123-def');
        });

        it('should parse internal link', () => {
            const result = parseObjects('See [[Custom Target]]');
            const link = result[1] as LinkObject;
            expect(link.properties.linkType).toBe('internal');
        });

        it('should parse custom protocol link', () => {
            const result = parseObjects('See [[doi:10.1000/xyz]]');
            const link = result[1] as LinkObject;
            expect(link.properties.linkType).toBe('doi');
            expect(link.properties.path).toBe('10.1000/xyz');
        });
    });

    describe('Timestamps', () => {
        it('should parse active timestamp', () => {
            const result = parseObjects('Meeting <2024-01-15 Mon>');
            expect(result).toHaveLength(2);
            const ts = result[1] as TimestampObject;
            expect(ts.type).toBe('timestamp');
            expect(ts.properties.timestampType).toBe('active');
            expect(ts.properties.yearStart).toBe(2024);
            expect(ts.properties.monthStart).toBe(1);
            expect(ts.properties.dayStart).toBe(15);
        });

        it('should parse active timestamp with time', () => {
            const result = parseObjects('<2024-01-15 Mon 10:30>');
            const ts = result[0] as TimestampObject;
            expect(ts.properties.hourStart).toBe(10);
            expect(ts.properties.minuteStart).toBe(30);
        });

        it('should parse inactive timestamp', () => {
            const result = parseObjects('Created [2024-01-15 Mon]');
            const ts = result[1] as TimestampObject;
            expect(ts.properties.timestampType).toBe('inactive');
        });

        it('should parse timestamp with repeater', () => {
            const result = parseObjects('<2024-01-15 Mon +1w>');
            const ts = result[0] as TimestampObject;
            expect(ts.properties.repeaterType).toBe('+');
            expect(ts.properties.repeaterValue).toBe(1);
            expect(ts.properties.repeaterUnit).toBe('w');
        });

        it('should parse timestamp with catch-up repeater', () => {
            const result = parseObjects('<2024-01-15 Mon ++1d>');
            const ts = result[0] as TimestampObject;
            expect(ts.properties.repeaterType).toBe('++');
        });

        it('should parse timestamp with restart repeater', () => {
            const result = parseObjects('<2024-01-15 Mon .+1m>');
            const ts = result[0] as TimestampObject;
            expect(ts.properties.repeaterType).toBe('.+');
        });

        it('should parse timestamp range', () => {
            const result = parseObjects('<2024-01-15 Mon>--<2024-01-20 Sat>');
            const ts = result[0] as TimestampObject;
            expect(ts.properties.timestampType).toBe('active-range');
            expect(ts.properties.yearEnd).toBe(2024);
            expect(ts.properties.monthEnd).toBe(1);
            expect(ts.properties.dayEnd).toBe(20);
        });

        it('should parse time range within same day', () => {
            const result = parseObjects('<2024-01-15 Mon 10:00-12:00>');
            const ts = result[0] as TimestampObject;
            expect(ts.properties.hourStart).toBe(10);
            expect(ts.properties.minuteStart).toBe(0);
            expect(ts.properties.hourEnd).toBe(12);
            expect(ts.properties.minuteEnd).toBe(0);
        });
    });

    describe('Entities', () => {
        it('should parse simple entity', () => {
            const result = parseObjects('Greek letter \\alpha here');
            expect(result.some(r => r.type === 'entity')).toBe(true);
            const entity = result.find(r => r.type === 'entity') as EntityObject;
            expect(entity.properties.name).toBe('alpha');
            expect(entity.properties.latex).toBe('\\alpha');
            expect(entity.properties.utf8).toBe('α');
        });

        it('should parse entity with braces', () => {
            const result = parseObjects('Letter \\beta{} here');
            const entity = result.find(r => r.type === 'entity') as EntityObject;
            expect(entity.properties.name).toBe('beta');
            expect(entity.properties.usesBrackets).toBe(true);
        });

        it('should parse arrow entity', () => {
            const result = parseObjects('A \\rightarrow B');
            const entity = result.find(r => r.type === 'entity') as EntityObject;
            expect(entity.properties.name).toBe('rightarrow');
            expect(entity.properties.utf8).toBe('→');
        });

        it('should parse typography entities', () => {
            const result = parseObjects('Use \\mdash for em-dash');
            const entity = result.find(r => r.type === 'entity') as EntityObject;
            expect(entity.properties.name).toBe('mdash');
            expect(entity.properties.utf8).toBe('—');
        });
    });

    describe('LaTeX Fragments', () => {
        it('should parse inline math', () => {
            const result = parseObjects('The formula $E=mc^2$ is famous');
            const latex = result.find(r => r.type === 'latex-fragment') as LatexFragmentObject;
            expect(latex).toBeDefined();
            expect(latex.properties.fragmentType).toBe('inline-math');
            expect(latex.properties.value).toBe('$E=mc^2$');
        });

        it('should parse display math with double dollar', () => {
            const result = parseObjects('Formula: $$\\int_0^1 x dx$$');
            const latex = result.find(r => r.type === 'latex-fragment') as LatexFragmentObject;
            expect(latex.properties.fragmentType).toBe('display-math');
        });

        it('should parse \\(...\\) inline math', () => {
            const result = parseObjects('Inline \\(x + y\\) math');
            const latex = result.find(r => r.type === 'latex-fragment') as LatexFragmentObject;
            expect(latex.properties.fragmentType).toBe('inline-math');
        });

        it('should parse \\[...\\] display math', () => {
            const result = parseObjects('Display \\[x + y\\] math');
            const latex = result.find(r => r.type === 'latex-fragment') as LatexFragmentObject;
            expect(latex.properties.fragmentType).toBe('display-math');
        });
    });

    describe('Subscripts and Superscripts', () => {
        it('should parse simple subscript', () => {
            const result = parseObjects('H_2O is water');
            const sub = result.find(r => r.type === 'subscript') as SubscriptObject;
            expect(sub).toBeDefined();
            expect(sub.properties.usesBraces).toBe(false);
        });

        it('should parse subscript with braces', () => {
            const result = parseObjects('x_{max} is maximum');
            const sub = result.find(r => r.type === 'subscript') as SubscriptObject;
            expect(sub.properties.usesBraces).toBe(true);
        });

        it('should parse simple superscript', () => {
            const result = parseObjects('x^2 is squared');
            const sup = result.find(r => r.type === 'superscript') as SuperscriptObject;
            expect(sup).toBeDefined();
            expect(sup.properties.usesBraces).toBe(false);
        });

        it('should parse superscript with braces', () => {
            const result = parseObjects('e^{i\\pi} = -1');
            const sup = result.find(r => r.type === 'superscript') as SuperscriptObject;
            expect(sup.properties.usesBraces).toBe(true);
        });

        it('should not parse subscript without preceding word character', () => {
            const result = parseObjects('_notsubscript');
            expect(result.every(r => r.type !== 'subscript')).toBe(true);
        });
    });

    describe('Statistics Cookie', () => {
        it('should parse fraction cookie', () => {
            const result = parseObjects('Progress [2/5]');
            const cookie = result.find(r => r.type === 'statistics-cookie') as StatisticsCookieObject;
            expect(cookie).toBeDefined();
            expect(cookie.properties.value).toBe('[2/5]');
        });

        it('should parse percentage cookie', () => {
            const result = parseObjects('Done [40%]');
            const cookie = result.find(r => r.type === 'statistics-cookie') as StatisticsCookieObject;
            expect(cookie.properties.value).toBe('[40%]');
        });
    });

    describe('Footnote References', () => {
        it('should parse named footnote reference', () => {
            const result = parseObjects('See footnote[fn:1]');
            const fn = result.find(r => r.type === 'footnote-reference') as FootnoteReferenceObject;
            expect(fn).toBeDefined();
            expect(fn.properties.label).toBe('1');
            expect(fn.properties.referenceType).toBe('standard');
        });

        it('should parse inline footnote', () => {
            const result = parseObjects('See[fn::This is inline]');
            const fn = result.find(r => r.type === 'footnote-reference') as FootnoteReferenceObject;
            expect(fn.properties.referenceType).toBe('inline');
            expect(fn.children).toBeDefined();
        });

        it('should parse named inline footnote', () => {
            const result = parseObjects('See[fn:note:This is inline]');
            const fn = result.find(r => r.type === 'footnote-reference') as FootnoteReferenceObject;
            expect(fn.properties.label).toBe('note');
            expect(fn.properties.referenceType).toBe('inline');
        });
    });

    describe('Inline Source Blocks', () => {
        it('should parse inline src block', () => {
            const result = parseObjects('Result: src_python{1 + 1}');
            const src = result.find(r => r.type === 'inline-src-block') as InlineSrcBlockObject;
            expect(src).toBeDefined();
            expect(src.properties.language).toBe('python');
            expect(src.properties.value).toBe('1 + 1');
        });

        it('should parse inline src block with headers', () => {
            const result = parseObjects('src_python[:session s]{x + 1}');
            const src = result.find(r => r.type === 'inline-src-block') as InlineSrcBlockObject;
            expect(src.properties.parameters).toBe(':session s');
        });
    });

    describe('Macros', () => {
        it('should parse simple macro', () => {
            const result = parseObjects('Date: {{{date}}}');
            const macro = result.find(r => r.type === 'macro') as MacroObject;
            expect(macro).toBeDefined();
            expect(macro.properties.key).toBe('date');
            expect(macro.properties.args).toEqual([]);
        });

        it('should parse macro with arguments', () => {
            const result = parseObjects('{{{poem(title,author)}}}');
            const macro = result.find(r => r.type === 'macro') as MacroObject;
            expect(macro.properties.key).toBe('poem');
            expect(macro.properties.args).toEqual(['title', 'author']);
        });
    });

    describe('Position Tracking', () => {
        it('should track positions correctly', () => {
            const text = 'Hello *world*';
            const result = parseObjects(text);

            // "Hello " = 0-6
            expect(result[0].range.start).toBe(0);
            expect(result[0].range.end).toBe(6);

            // "*world*" = 6-13
            expect(result[1].range.start).toBe(6);
            expect(result[1].range.end).toBe(13);
        });

        it('should handle base offset', () => {
            const result = parseObjects('*bold*', { baseOffset: 100 });
            expect(result[0].range.start).toBe(100);
            expect(result[0].range.end).toBe(106);
        });
    });

    describe('Complex Combinations', () => {
        it('should parse multiple objects in sequence', () => {
            const result = parseObjects('See *bold* and /italic/ and =code=');
            const types = result.map(r => r.type);
            expect(types).toContain('bold');
            expect(types).toContain('italic');
            expect(types).toContain('code');
        });

        it('should parse link with formatted description', () => {
            const result = parseObjects('[[https://example.com][Visit *this* site]]');
            const link = result[0] as LinkObject;
            expect(link.type).toBe('link');
            // Description should contain bold
            expect(link.children?.some(c => c.type === 'bold')).toBe(true);
        });

        it('should parse text with entities and emphasis', () => {
            const result = parseObjects('The formula *\\alpha* is Greek');
            const bold = result.find(r => r.type === 'bold') as BoldObject;
            expect(bold.children.some(c => c.type === 'entity')).toBe(true);
        });
    });
});

// =============================================================================
// Entity Definitions Tests
// =============================================================================

describe('Entity Definitions', () => {
    it('should have Greek letters', () => {
        expect(getEntity('alpha')).toBeDefined();
        expect(getEntity('Alpha')).toBeDefined();
        expect(getEntity('omega')).toBeDefined();
        expect(getEntity('Omega')).toBeDefined();
    });

    it('should have arrow symbols', () => {
        expect(getEntity('rightarrow')).toBeDefined();
        expect(getEntity('Rightarrow')).toBeDefined();
        expect(getEntity('leftarrow')).toBeDefined();
        expect(getEntity('leftrightarrow')).toBeDefined();
    });

    it('should have math operators', () => {
        expect(getEntity('times')).toBeDefined();
        expect(getEntity('div')).toBeDefined();
        expect(getEntity('pm')).toBeDefined();
        expect(getEntity('infty')).toBeDefined();
    });

    it('should have typography symbols', () => {
        expect(getEntity('nbsp')).toBeDefined();
        expect(getEntity('mdash')).toBeDefined();
        expect(getEntity('ndash')).toBeDefined();
        expect(getEntity('hellip')).toBeDefined();
    });

    it('should have currency symbols', () => {
        expect(getEntity('euro')).toBeDefined();
        expect(getEntity('pound')).toBeDefined();
        expect(getEntity('yen')).toBeDefined();
    });

    it('should validate entity names', () => {
        expect(isValidEntity('alpha')).toBe(true);
        expect(isValidEntity('notanentity')).toBe(false);
    });

    it('should provide correct LaTeX representation', () => {
        const alpha = getEntity('alpha');
        expect(alpha?.latex).toBe('\\alpha');

        const rightarrow = getEntity('rightarrow');
        expect(rightarrow?.latex).toBe('\\rightarrow');
    });

    it('should provide correct HTML representation', () => {
        const alpha = getEntity('alpha');
        expect(alpha?.html).toBe('&alpha;');
    });

    it('should provide correct UTF-8 representation', () => {
        const alpha = getEntity('alpha');
        expect(alpha?.utf8).toBe('α');

        const rightarrow = getEntity('rightarrow');
        expect(rightarrow?.utf8).toBe('→');
    });
});

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Edge Cases', () => {
    it('should handle empty string', () => {
        const result = parseObjects('');
        expect(result).toHaveLength(0);
    });

    it('should handle unclosed emphasis', () => {
        const result = parseObjects('This is *not closed');
        // Should be treated as plain text
        expect(result.every(r => r.type === 'plain-text')).toBe(true);
    });

    it('should handle unclosed link', () => {
        const result = parseObjects('See [[broken link');
        expect(result.every(r => r.type === 'plain-text')).toBe(true);
    });

    it('should handle special characters in text', () => {
        const result = parseObjects('Text with <angle> brackets');
        // < without date should be plain text
        expect(result).toHaveLength(1);
    });

    it('should handle consecutive emphasis', () => {
        const result = parseObjects('*bold**more bold*');
        // Complex case - implementation specific
        expect(result.length).toBeGreaterThan(0);
    });

    it('should handle emphasis at string boundaries', () => {
        const result = parseObjects('*bold at start*');
        expect(result[0].type).toBe('bold');

        const result2 = parseObjects('*bold at end*');
        expect(result2[0].type).toBe('bold');
    });

    it('should handle very long text', () => {
        const longText = 'word '.repeat(10000);
        const result = parseObjects(longText);
        expect(result.length).toBeGreaterThan(0);
    });

    it('should handle unicode text', () => {
        const result = parseObjects('Unicode: 你好 *bold* мир');
        expect(result.length).toBe(3);
        expect(result[1].type).toBe('bold');
    });
});
