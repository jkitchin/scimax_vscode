/**
 * Tests for the fast export parser (orgExportParser.ts)
 * Tests parsing of org documents for export purposes
 */

import { describe, it, expect } from 'vitest';
import { parseOrgFast, parseObjectsFast } from '../orgExportParser';

// Helper to safely access properties on parsed elements
const getProps = (obj: any) => obj?.properties || {};

describe('Fast Export Parser', () => {
    describe('Basic Document Parsing', () => {
        it('parses empty document', () => {
            const doc = parseOrgFast('');
            expect(doc.type).toBe('org-data');
            expect(doc.children).toHaveLength(0);
        });

        it('parses document with single headline', () => {
            const doc = parseOrgFast('* Hello World');
            expect(doc.children).toHaveLength(1);
            expect(doc.children[0].properties.rawValue).toBe('Hello World');
            expect(doc.children[0].properties.level).toBe(1);
        });

        it('parses document with multiple headlines', () => {
            const content = `* First
* Second
* Third`;
            const doc = parseOrgFast(content);
            expect(doc.children).toHaveLength(3);
            expect(doc.children[0].properties.rawValue).toBe('First');
            expect(doc.children[1].properties.rawValue).toBe('Second');
            expect(doc.children[2].properties.rawValue).toBe('Third');
        });

        it('parses nested headlines', () => {
            const content = `* Level 1
** Level 2
*** Level 3
** Another Level 2
* Another Level 1`;
            const doc = parseOrgFast(content);
            expect(doc.children).toHaveLength(2);
            expect(doc.children[0].children).toHaveLength(2);
            expect(doc.children[0].children[0].children).toHaveLength(1);
        });

        it('parses TODO keywords', () => {
            const content = `* TODO Task one
* DONE Task two
* NEXT Task three`;
            const doc = parseOrgFast(content);
            expect(doc.children[0].properties.todoKeyword).toBe('TODO');
            expect(doc.children[1].properties.todoKeyword).toBe('DONE');
            expect(doc.children[2].properties.todoKeyword).toBe('NEXT');
        });

        it('parses tags', () => {
            const doc = parseOrgFast('* Headline :tag1:tag2:');
            expect(doc.children[0].properties.tags).toEqual(['tag1', 'tag2']);
        });

        it('parses priority', () => {
            const doc = parseOrgFast('* [#A] High priority task');
            expect(doc.children[0].properties.priority).toBe('A');
        });
    });

    describe('Keywords', () => {
        it('parses TITLE keyword', () => {
            const doc = parseOrgFast('#+TITLE: My Document\n* Headline');
            expect(doc.keywords.TITLE).toBe('My Document');
        });

        it('parses multiple keywords', () => {
            const content = `#+TITLE: Test
#+AUTHOR: John Doe
#+DATE: 2024-01-01
* Content`;
            const doc = parseOrgFast(content);
            expect(doc.keywords.TITLE).toBe('Test');
            expect(doc.keywords.AUTHOR).toBe('John Doe');
            expect(doc.keywords.DATE).toBe('2024-01-01');
        });
    });

    describe('Drawers', () => {
        it('parses property drawer', () => {
            const content = `* Headline
:PROPERTIES:
:CUSTOM_ID: my-id
:END:`;
            const doc = parseOrgFast(content);
            expect(doc.children).toHaveLength(1);
        });

        it('parses regular drawer', () => {
            const content = `* Headline
:LOGBOOK:
Some log content
:END:`;
            const doc = parseOrgFast(content);
            expect(doc.children).toHaveLength(1);
        });

        it('does NOT treat orphan :END: as drawer start', () => {
            // This is the critical bug fix test
            const content = `* First headline
#+BEGIN_SRC python :results drawer
print("hello")
#+END_SRC

#+RESULTS:
:RESULTS:
hello
:END:

* Second headline
This content should be in second headline`;
            const doc = parseOrgFast(content);
            expect(doc.children).toHaveLength(2);
            expect(doc.children[0].properties.rawValue).toBe('First headline');
            expect(doc.children[1].properties.rawValue).toBe('Second headline');
        });

        it('handles bare :END: without consuming following headlines', () => {
            // Another variation of the :END: bug
            const content = `* Headline 1
Some content
:END:
* Headline 2
* Headline 3`;
            const doc = parseOrgFast(content);
            expect(doc.children).toHaveLength(3);
        });
    });

    describe('Source Blocks', () => {
        it('parses source block', () => {
            const content = `* Code
#+BEGIN_SRC python
print("hello")
#+END_SRC`;
            const doc = parseOrgFast(content);
            const section = doc.children[0].section;
            expect(section).toBeDefined();
            const srcBlock = section?.children.find(c => c.type === 'src-block') as any;
            expect(srcBlock).toBeDefined();
            expect(srcBlock?.properties?.language).toBe('python');
        });

        it('parses source block with parameters', () => {
            const content = `#+BEGIN_SRC python :results output :session main
x = 1
#+END_SRC`;
            const doc = parseOrgFast(content);
            const srcBlock = doc.section?.children.find(c => c.type === 'src-block') as any;
            expect(srcBlock?.properties?.parameters).toContain(':results output');
        });

        it('parses multiple source blocks', () => {
            const content = `* Code examples
#+BEGIN_SRC python
print("python")
#+END_SRC

#+BEGIN_SRC javascript
console.log("js");
#+END_SRC`;
            const doc = parseOrgFast(content);
            const srcBlocks = doc.children[0].section?.children.filter(c => c.type === 'src-block');
            expect(srcBlocks).toHaveLength(2);
        });
    });

    describe('Lists', () => {
        it('parses unordered list', () => {
            const content = `* Items
- Item 1
- Item 2
- Item 3`;
            const doc = parseOrgFast(content);
            const list = doc.children[0].section?.children.find(c => c.type === 'plain-list');
            expect(list).toBeDefined();
            expect(list?.children).toHaveLength(3);
        });

        it('parses ordered list', () => {
            const content = `* Steps
1. First
2. Second
3. Third`;
            const doc = parseOrgFast(content);
            const list = doc.children[0].section?.children.find(c => c.type === 'plain-list') as any;
            expect(list).toBeDefined();
            expect(list?.properties?.listType).toBe('ordered');
        });

        it('parses checkbox list', () => {
            const content = `* Tasks
- [ ] Unchecked
- [X] Checked
- [-] Partial`;
            const doc = parseOrgFast(content);
            const list = doc.children[0].section?.children.find(c => c.type === 'plain-list');
            expect(list).toBeDefined();
        });
    });

    describe('Tables', () => {
        it('parses simple table', () => {
            const content = `| A | B |
| 1 | 2 |`;
            const doc = parseOrgFast(content);
            const table = doc.section?.children.find(c => c.type === 'table');
            expect(table).toBeDefined();
        });

        it('parses table with header separator', () => {
            const content = `| Header 1 | Header 2 |
|----------+----------|
| Data 1   | Data 2   |`;
            const doc = parseOrgFast(content);
            const table = doc.section?.children.find(c => c.type === 'table');
            expect(table).toBeDefined();
        });
    });

    describe('Blocks', () => {
        it('parses example block', () => {
            const content = `#+BEGIN_EXAMPLE
Some example text
#+END_EXAMPLE`;
            const doc = parseOrgFast(content);
            const block = doc.section?.children.find(c => c.type === 'example-block');
            expect(block).toBeDefined();
        });

        it('parses quote block', () => {
            const content = `#+BEGIN_QUOTE
A famous quote
#+END_QUOTE`;
            const doc = parseOrgFast(content);
            const block = doc.section?.children.find(c => c.type === 'quote-block');
            expect(block).toBeDefined();
        });

        it('parses verse block', () => {
            const content = `#+BEGIN_VERSE
Poetry here
#+END_VERSE`;
            const doc = parseOrgFast(content);
            const block = doc.section?.children.find(c => c.type === 'verse-block');
            expect(block).toBeDefined();
        });

        it('parses center block', () => {
            const content = `#+BEGIN_CENTER
Centered text
#+END_CENTER`;
            const doc = parseOrgFast(content);
            const block = doc.section?.children.find(c => c.type === 'center-block');
            expect(block).toBeDefined();
        });
    });

    describe('Links', () => {
        it('parses URL link', () => {
            const content = '[[https://example.com][Example]]';
            const objects = parseObjectsFast(content);
            const link = objects.find(o => o.type === 'link') as any;
            expect(link).toBeDefined();
            expect(link?.properties?.path).toBe('https://example.com');
        });

        it('parses file link', () => {
            const content = '[[file:./image.png]]';
            const objects = parseObjectsFast(content);
            const link = objects.find(o => o.type === 'link') as any;
            expect(link).toBeDefined();
            expect(link?.properties?.linkType).toBe('file');
        });

        it('parses citation link', () => {
            const content = 'cite:smith-2020-paper';
            const objects = parseObjectsFast(content);
            const link = objects.find(o => o.type === 'link') as any;
            expect(link).toBeDefined();
            expect(link?.properties?.linkType).toBe('cite');
            expect(link?.properties?.path).toBe('smith-2020-paper');
        });

        it('parses multiple citation keys', () => {
            const content = 'cite:key1,key2,key3';
            const objects = parseObjectsFast(content);
            const link = objects.find(o => o.type === 'link') as any;
            expect(link?.properties?.path).toBe('key1,key2,key3');
        });

        it('parses citep link', () => {
            const content = 'citep:author-2021';
            const objects = parseObjectsFast(content);
            const link = objects.find(o => o.type === 'link') as any;
            expect(link?.properties?.linkType).toBe('citep');
        });

        it('parses citet link', () => {
            const content = 'citet:author-2021';
            const objects = parseObjectsFast(content);
            const link = objects.find(o => o.type === 'link') as any;
            expect(link?.properties?.linkType).toBe('citet');
        });

        it('parses ref link', () => {
            const content = 'ref:fig-results';
            const objects = parseObjectsFast(content);
            const link = objects.find(o => o.type === 'link') as any;
            expect(link?.properties?.linkType).toBe('ref');
            expect(link?.properties?.path).toBe('fig-results');
        });

        it('parses eqref link', () => {
            const content = 'eqref:eq-energy';
            const objects = parseObjectsFast(content);
            const link = objects.find(o => o.type === 'link') as any;
            expect(link?.properties?.linkType).toBe('eqref');
        });

        it('parses bibliography link', () => {
            const content = 'bibliography:refs.bib';
            const objects = parseObjectsFast(content);
            const link = objects.find(o => o.type === 'link') as any;
            expect(link?.properties?.linkType).toBe('bibliography');
            expect(link?.properties?.path).toBe('refs.bib');
        });

        it('parses bibliography link with multiple files', () => {
            const content = 'bibliography:refs1.bib,refs2.bib';
            const objects = parseObjectsFast(content);
            const link = objects.find(o => o.type === 'link') as any;
            expect(link?.properties?.path).toBe('refs1.bib,refs2.bib');
        });
    });

    describe('Text Markup', () => {
        it('parses bold text', () => {
            const objects = parseObjectsFast('This is *bold* text');
            const bold = objects.find(o => o.type === 'bold');
            expect(bold).toBeDefined();
        });

        it('parses italic text', () => {
            const objects = parseObjectsFast('This is /italic/ text');
            const italic = objects.find(o => o.type === 'italic');
            expect(italic).toBeDefined();
        });

        it('parses underline text', () => {
            const objects = parseObjectsFast('This is _underlined_ text');
            const underline = objects.find(o => o.type === 'underline');
            expect(underline).toBeDefined();
        });

        it('parses strikethrough text', () => {
            const objects = parseObjectsFast('This is +deleted+ text');
            const strike = objects.find(o => o.type === 'strike-through');
            expect(strike).toBeDefined();
        });

        it('parses inline code', () => {
            const objects = parseObjectsFast('This is ~code~ text');
            const code = objects.find(o => o.type === 'code');
            expect(code).toBeDefined();
        });

        it('parses verbatim text', () => {
            const objects = parseObjectsFast('This is =verbatim= text');
            const verbatim = objects.find(o => o.type === 'verbatim');
            expect(verbatim).toBeDefined();
        });
    });

    describe('Complex Documents', () => {
        it('parses document with mixed content', () => {
            const content = `#+TITLE: Complex Document
#+AUTHOR: Test

* Introduction
Some introductory text with *bold* and /italic/.

** Background
- Point 1
- Point 2

* Methods
#+BEGIN_SRC python
def method():
    pass
#+END_SRC

| Parameter | Value |
|-----------+-------|
| alpha     | 0.1   |

* Results
See ref:fig-1 for details.

cite:smith-2020,jones-2021

* Conclusion
Final thoughts.

bibliography:refs.bib`;
            const doc = parseOrgFast(content);
            expect(doc.keywords.TITLE).toBe('Complex Document');
            expect(doc.children).toHaveLength(4);
            expect(doc.children[0].children).toHaveLength(1); // Background subsection
        });

        it('handles real-world document structure', () => {
            // Simulates tasks.org structure that exposed the :END: bug
            const content = `* TODO First task

* TODO Second task with code
- [ ] checkbox item

#+BEGIN_SRC python :results drawer
print("test")
#+END_SRC

#+RESULTS:
:RESULTS:
test
:END:

* DONE Third task
** Subtask A
** Subtask B

* TODO Fourth task

bibliography:refs.bib`;
            const doc = parseOrgFast(content);
            expect(doc.children).toHaveLength(4);
            expect(doc.children[0].properties.rawValue).toBe('First task');
            expect(doc.children[1].properties.rawValue).toBe('Second task with code');
            expect(doc.children[2].properties.rawValue).toBe('Third task');
            expect(doc.children[2].children).toHaveLength(2);
            expect(doc.children[3].properties.rawValue).toBe('Fourth task');
        });
    });

    describe('Edge Cases', () => {
        it('handles headline with asterisks in title', () => {
            const doc = parseOrgFast('* Title with * asterisk');
            expect(doc.children[0].properties.rawValue).toBe('Title with * asterisk');
        });

        it('handles empty headlines', () => {
            // Headlines need at least one char after the asterisks
            const content = `*
* Valid headline`;
            const doc = parseOrgFast(content);
            // Empty headline might not parse, but shouldn't crash
            expect(doc.children.length).toBeGreaterThanOrEqual(1);
        });

        it('handles very deep nesting', () => {
            const content = `* Level 1
** Level 2
*** Level 3
**** Level 4
***** Level 5
****** Level 6`;
            const doc = parseOrgFast(content);
            expect(doc.children).toHaveLength(1);
            let current = doc.children[0];
            for (let i = 2; i <= 6; i++) {
                expect(current.children).toHaveLength(1);
                current = current.children[0];
            }
        });

        it('handles content before first headline', () => {
            const content = `#+TITLE: Test
Some preamble text.

* First headline`;
            const doc = parseOrgFast(content);
            expect(doc.section).toBeDefined();
            expect(doc.children).toHaveLength(1);
        });
    });
});
