/**
 * Tests for the unified org-mode parser
 */

import { describe, it, expect } from 'vitest';
import { OrgParserUnified, parseOrg } from '../orgParserUnified';
import type { HeadlineElement, SrcBlockElement, ParagraphElement, TableElement, PlainListElement } from '../orgElementTypes';

describe('OrgParserUnified', () => {
    describe('basic parsing', () => {
        it('parses empty document', () => {
            const doc = parseOrg('');
            expect(doc.type).toBe('org-data');
            expect(doc.children).toHaveLength(0);
        });

        it('parses document with only keywords', () => {
            const content = `#+TITLE: Test Document
#+AUTHOR: Test Author
#+DATE: 2024-01-15`;

            const doc = parseOrg(content);
            expect(doc.keywords['TITLE']).toBe('Test Document');
            expect(doc.keywords['AUTHOR']).toBe('Test Author');
            expect(doc.keywords['DATE']).toBe('2024-01-15');
        });

        it('parses document properties', () => {
            const content = `#+PROPERTY: header-args :results output
#+PROPERTY: ID my-doc-id`;

            const doc = parseOrg(content);
            expect(doc.properties['header-args']).toBe(':results output');
            expect(doc.properties['ID']).toBe('my-doc-id');
        });
    });

    describe('headline parsing', () => {
        it('parses simple headline', () => {
            const doc = parseOrg('* Headline 1');
            expect(doc.children).toHaveLength(1);
            expect(doc.children[0].properties.level).toBe(1);
            expect(doc.children[0].properties.rawValue).toBe('Headline 1');
        });

        it('parses headline with TODO keyword', () => {
            const doc = parseOrg('* TODO Task to do');
            const headline = doc.children[0];
            expect(headline.properties.todoKeyword).toBe('TODO');
            expect(headline.properties.todoType).toBe('todo');
            expect(headline.properties.rawValue).toBe('Task to do');
        });

        it('parses headline with DONE keyword', () => {
            const doc = parseOrg('* DONE Completed task');
            const headline = doc.children[0];
            expect(headline.properties.todoKeyword).toBe('DONE');
            expect(headline.properties.todoType).toBe('done');
        });

        it('parses headline with priority', () => {
            const doc = parseOrg('* [#A] High priority task');
            const headline = doc.children[0];
            expect(headline.properties.priority).toBe('A');
            expect(headline.properties.rawValue).toBe('High priority task');
        });

        it('parses headline with tags', () => {
            const doc = parseOrg('* Headline :tag1:tag2:tag3:');
            const headline = doc.children[0];
            expect(headline.properties.tags).toEqual(['tag1', 'tag2', 'tag3']);
            expect(headline.properties.rawValue).toBe('Headline');
        });

        it('parses headline with TODO, priority, and tags', () => {
            const doc = parseOrg('* TODO [#B] Complex headline :work:urgent:');
            const headline = doc.children[0];
            expect(headline.properties.todoKeyword).toBe('TODO');
            expect(headline.properties.priority).toBe('B');
            expect(headline.properties.tags).toEqual(['work', 'urgent']);
            expect(headline.properties.rawValue).toBe('Complex headline');
        });

        it('parses nested headlines', () => {
            const content = `* Level 1
** Level 2
*** Level 3
** Another Level 2
* Another Level 1`;

            const doc = parseOrg(content);
            expect(doc.children).toHaveLength(2);
            expect(doc.children[0].children).toHaveLength(2);
            expect(doc.children[0].children[0].children).toHaveLength(1);
            expect(doc.children[0].children[0].children[0].properties.level).toBe(3);
        });

        it('parses ARCHIVE tag', () => {
            const doc = parseOrg('* Archived :ARCHIVE:');
            expect(doc.children[0].properties.archivedp).toBe(true);
        });

        it('parses COMMENT prefix', () => {
            const doc = parseOrg('* COMMENT Commented headline');
            expect(doc.children[0].properties.commentedp).toBe(true);
            expect(doc.children[0].properties.rawValue).toBe('Commented headline');
        });
    });

    describe('planning and properties', () => {
        it('parses planning line with SCHEDULED', () => {
            const content = `* TODO Task
SCHEDULED: <2024-01-15 Mon 10:00>`;

            const doc = parseOrg(content);
            const headline = doc.children[0];
            expect(headline.planning).toBeDefined();
            expect(headline.planning?.properties.scheduled).toBeDefined();
            expect(headline.planning?.properties.scheduled?.properties.yearStart).toBe(2024);
            expect(headline.planning?.properties.scheduled?.properties.monthStart).toBe(1);
            expect(headline.planning?.properties.scheduled?.properties.dayStart).toBe(15);
        });

        it('parses planning line with DEADLINE', () => {
            const content = `* TODO Task
DEADLINE: <2024-01-20 Fri>`;

            const doc = parseOrg(content);
            const headline = doc.children[0];
            expect(headline.planning?.properties.deadline).toBeDefined();
        });

        it('parses properties drawer', () => {
            const content = `* Headline
:PROPERTIES:
:CUSTOM_ID: my-custom-id
:ID: unique-id
:CATEGORY: work
:END:`;

            const doc = parseOrg(content);
            const headline = doc.children[0];
            expect(headline.propertiesDrawer).toBeDefined();
            expect(headline.propertiesDrawer?.['CUSTOM_ID']).toBe('my-custom-id');
            expect(headline.properties.customId).toBe('my-custom-id');
            expect(headline.properties.id).toBe('unique-id');
        });
    });

    describe('source blocks', () => {
        it('parses simple source block', () => {
            const content = `#+BEGIN_SRC python
print("Hello, World!")
#+END_SRC`;

            const doc = parseOrg(content);
            expect(doc.section).toBeDefined();
            const srcBlock = doc.section?.children.find(e => e.type === 'src-block') as SrcBlockElement;
            expect(srcBlock).toBeDefined();
            expect(srcBlock.properties.language).toBe('python');
            expect(srcBlock.properties.value).toBe('print("Hello, World!")');
        });

        it('parses source block with header arguments', () => {
            const content = `#+BEGIN_SRC python :results output :session main
import sys
print(sys.version)
#+END_SRC`;

            const doc = parseOrg(content);
            const srcBlock = doc.section?.children.find(e => e.type === 'src-block') as SrcBlockElement;
            expect(srcBlock.properties.headers['results']).toBe('output');
            expect(srcBlock.properties.headers['session']).toBe('main');
        });

        it('parses source block in headline section', () => {
            const content = `* Code Example
#+BEGIN_SRC javascript
const x = 1;
#+END_SRC`;

            const doc = parseOrg(content);
            const srcBlock = doc.children[0].section?.children.find(e => e.type === 'src-block') as SrcBlockElement;
            expect(srcBlock).toBeDefined();
            expect(srcBlock.properties.language).toBe('javascript');
        });
    });

    describe('other block types', () => {
        it('parses example block', () => {
            const content = `#+BEGIN_EXAMPLE
This is an example
with multiple lines
#+END_EXAMPLE`;

            const doc = parseOrg(content);
            const exampleBlock = doc.section?.children.find(e => e.type === 'example-block');
            expect(exampleBlock).toBeDefined();
        });

        it('parses quote block', () => {
            const content = `#+BEGIN_QUOTE
This is a quote.
#+END_QUOTE`;

            const doc = parseOrg(content);
            const quoteBlock = doc.section?.children.find(e => e.type === 'quote-block');
            expect(quoteBlock).toBeDefined();
        });

        it('parses center block', () => {
            const content = `#+BEGIN_CENTER
Centered content
#+END_CENTER`;

            const doc = parseOrg(content);
            const centerBlock = doc.section?.children.find(e => e.type === 'center-block');
            expect(centerBlock).toBeDefined();
        });

        it('parses export block', () => {
            const content = `#+BEGIN_EXPORT html
<div>Raw HTML</div>
#+END_EXPORT`;

            const doc = parseOrg(content);
            const exportBlock = doc.section?.children.find(e => e.type === 'export-block');
            expect(exportBlock).toBeDefined();
        });

        it('parses LaTeX environment', () => {
            const content = `\\begin{equation}
E = mc^2
\\end{equation}`;

            const doc = parseOrg(content);
            const latexEnv = doc.section?.children.find(e => e.type === 'latex-environment');
            expect(latexEnv).toBeDefined();
        });
    });

    describe('paragraph parsing', () => {
        it('parses simple paragraph', () => {
            const content = 'This is a simple paragraph.';
            const doc = parseOrg(content);
            const para = doc.section?.children.find(e => e.type === 'paragraph') as ParagraphElement;
            expect(para).toBeDefined();
        });

        it('parses paragraph with inline markup', () => {
            const content = 'This has *bold* and /italic/ text.';
            const doc = parseOrg(content);
            const para = doc.section?.children.find(e => e.type === 'paragraph') as ParagraphElement;
            expect(para.children.length).toBeGreaterThan(1);
            expect(para.children.some(c => c.type === 'bold')).toBe(true);
            expect(para.children.some(c => c.type === 'italic')).toBe(true);
        });

        it('parses paragraph with links', () => {
            const content = 'Check [[https://example.com][Example]] for more.';
            const doc = parseOrg(content);
            const para = doc.section?.children.find(e => e.type === 'paragraph') as ParagraphElement;
            expect(para.children.some(c => c.type === 'link')).toBe(true);
        });
    });

    describe('table parsing', () => {
        it('parses simple table', () => {
            const content = `| Name  | Age |
|-------+-----|
| Alice | 30  |
| Bob   | 25  |`;

            const doc = parseOrg(content);
            const table = doc.section?.children.find(e => e.type === 'table') as TableElement;
            expect(table).toBeDefined();
            expect(table.children.length).toBeGreaterThan(0);
        });
    });

    describe('list parsing', () => {
        it('parses unordered list', () => {
            const content = `- Item 1
- Item 2
- Item 3`;

            const doc = parseOrg(content);
            const list = doc.section?.children.find(e => e.type === 'plain-list') as PlainListElement;
            expect(list).toBeDefined();
            expect(list.properties.listType).toBe('unordered');
        });

        it('parses ordered list', () => {
            const content = `1. First
2. Second
3. Third`;

            const doc = parseOrg(content);
            const list = doc.section?.children.find(e => e.type === 'plain-list') as PlainListElement;
            expect(list).toBeDefined();
            expect(list.properties.listType).toBe('ordered');
        });
    });

    describe('drawer parsing', () => {
        it('parses custom drawer', () => {
            const content = `* Headline
:LOGBOOK:
- Note taken on [2024-01-15 Mon 10:00]
:END:`;

            const doc = parseOrg(content);
            const drawer = doc.children[0].section?.children.find(e => e.type === 'drawer');
            expect(drawer).toBeDefined();
        });
    });

    describe('horizontal rule', () => {
        it('parses horizontal rule', () => {
            const content = `Some text

-----

More text`;

            const doc = parseOrg(content);
            const hr = doc.section?.children.find(e => e.type === 'horizontal-rule');
            expect(hr).toBeDefined();
        });
    });

    describe('fixed width', () => {
        it('parses fixed width lines', () => {
            const content = `: This is fixed width
: Another line`;

            const doc = parseOrg(content);
            const fixed = doc.section?.children.find(e => e.type === 'fixed-width');
            expect(fixed).toBeDefined();
        });
    });

    describe('position tracking', () => {
        it('adds positions to document', () => {
            const content = `* Headline
Some content.`;

            const doc = parseOrg(content, { addPositions: true });
            expect(doc.position).toBeDefined();
            expect(doc.children[0].position).toBeDefined();
            expect(doc.children[0].position?.start.line).toBe(0);
        });

        it('skips positions when disabled', () => {
            const content = '* Headline';
            const doc = parseOrg(content, { addPositions: false });
            // Position might still be undefined
        });
    });

    describe('custom TODO keywords', () => {
        it('uses custom TODO keywords', () => {
            const parser = new OrgParserUnified({
                todoKeywords: ['TASK', 'STARTED'],
                doneKeywords: ['FINISHED'],
            });

            const doc = parser.parse('* TASK Custom task');
            expect(doc.children[0].properties.todoKeyword).toBe('TASK');
            expect(doc.children[0].properties.todoType).toBe('todo');
        });

        it('recognizes custom DONE keywords', () => {
            const parser = new OrgParserUnified({
                todoKeywords: ['TASK'],
                doneKeywords: ['FINISHED', 'ARCHIVED'],
            });

            const doc = parser.parse('* FINISHED Completed task');
            expect(doc.children[0].properties.todoKeyword).toBe('FINISHED');
            expect(doc.children[0].properties.todoType).toBe('done');
        });
    });

    describe('complex documents', () => {
        it('parses complex document correctly', () => {
            const content = `#+TITLE: Project Notes
#+AUTHOR: Test User

* TODO [#A] Important Task :work:urgent:
SCHEDULED: <2024-01-15 Mon>
:PROPERTIES:
:ID: task-001
:EFFORT: 2h
:END:

This is the task description with *bold* and /italic/ text.

** DONE Subtask 1
CLOSED: [2024-01-14 Sun 15:00]

Completed this subtask.

#+BEGIN_SRC python :results output
print("Hello from subtask")
#+END_SRC

** TODO Subtask 2

| Item | Status |
|------+--------|
| A    | Done   |
| B    | WIP    |

* Notes :notes:

Some general notes.

- Point 1
- Point 2
  - Nested point
- Point 3`;

            const doc = parseOrg(content);

            // Check keywords
            expect(doc.keywords['TITLE']).toBe('Project Notes');
            expect(doc.keywords['AUTHOR']).toBe('Test User');

            // Check first headline
            const task = doc.children[0];
            expect(task.properties.todoKeyword).toBe('TODO');
            expect(task.properties.priority).toBe('A');
            expect(task.properties.tags).toContain('work');
            expect(task.properties.tags).toContain('urgent');
            expect(task.planning?.properties.scheduled).toBeDefined();
            expect(task.propertiesDrawer?.['ID']).toBe('task-001');

            // Check subtasks
            expect(task.children).toHaveLength(2);
            expect(task.children[0].properties.todoKeyword).toBe('DONE');
            expect(task.children[1].properties.todoKeyword).toBe('TODO');

            // Check second top-level headline
            expect(doc.children[1].properties.tags).toContain('notes');
        });
    });
});
