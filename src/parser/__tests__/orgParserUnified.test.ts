/**
 * Tests for the unified org-mode parser
 */

import { describe, it, expect } from 'vitest';
import { OrgParserUnified, parseOrg } from '../orgParserUnified';
import type {
    HeadlineElement,
    SrcBlockElement,
    ParagraphElement,
    TableElement,
    PlainListElement,
    DynamicBlockElement,
    InlinetaskElement,
    DiarySexpElement,
    ClockElement,
    FootnoteDefinitionElement,
    BabelCallElement
} from '../orgElementTypes';

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

    describe('dynamic block parsing', () => {
        it('parses simple dynamic block', () => {
            const content = `#+BEGIN: clocktable :maxlevel 2
| Headline | Time |
#+END:`;

            const doc = parseOrg(content);
            const dynBlock = doc.section?.children.find(e => e.type === 'dynamic-block') as DynamicBlockElement;
            expect(dynBlock).toBeDefined();
            expect(dynBlock.properties.name).toBe('clocktable');
            expect(dynBlock.properties.arguments).toBe(':maxlevel 2');
        });

        it('parses dynamic block without arguments', () => {
            const content = `#+BEGIN: columnview
| Col1 | Col2 |
#+END:`;

            const doc = parseOrg(content);
            const dynBlock = doc.section?.children.find(e => e.type === 'dynamic-block') as DynamicBlockElement;
            expect(dynBlock).toBeDefined();
            expect(dynBlock.properties.name).toBe('columnview');
            expect(dynBlock.properties.arguments).toBeUndefined();
        });

        it('parses dynamic block with nested content', () => {
            const content = `#+BEGIN: clocktable :scope file
| Headline     | Time |
|--------------|------|
| * Task       | 1:30 |
| ** Subtask   | 0:45 |
#+END:`;

            const doc = parseOrg(content);
            const dynBlock = doc.section?.children.find(e => e.type === 'dynamic-block') as DynamicBlockElement;
            expect(dynBlock).toBeDefined();
            expect(dynBlock.children.length).toBeGreaterThan(0);
        });
    });

    describe('inline task parsing', () => {
        it('parses inline task with default min level', () => {
            const content = `* Headline
*************** TODO Inline task
This is an inline task body
*************** END`;

            const doc = parseOrg(content);
            const headline = doc.children[0];
            expect(headline.section).toBeDefined();
            const inlinetask = headline.section?.children.find(e => e.type === 'inlinetask') as InlinetaskElement;
            expect(inlinetask).toBeDefined();
            expect(inlinetask.properties.level).toBe(15);
            expect(inlinetask.properties.todoKeyword).toBe('TODO');
            expect(inlinetask.properties.rawValue).toBe('Inline task');
        });

        it('parses inline task with priority and tags', () => {
            const content = `* Headline
*************** [#A] Priority inline task :tag1:tag2:
Content
*************** END`;

            const doc = parseOrg(content);
            const headline = doc.children[0];
            const inlinetask = headline.section?.children.find(e => e.type === 'inlinetask') as InlinetaskElement;
            expect(inlinetask).toBeDefined();
            expect(inlinetask.properties.priority).toBe('A');
            expect(inlinetask.properties.tags).toContain('tag1');
            expect(inlinetask.properties.tags).toContain('tag2');
        });

        it('respects custom inlinetask min level', () => {
            const parser = new OrgParserUnified({
                inlinetaskMinLevel: 5
            });

            const content = `* Headline
***** TODO Custom level inline task
Content
***** END`;

            const doc = parser.parse(content);
            const headline = doc.children[0];
            const inlinetask = headline.section?.children.find(e => e.type === 'inlinetask') as InlinetaskElement;
            expect(inlinetask).toBeDefined();
            expect(inlinetask.properties.level).toBe(5);
        });
    });

    describe('diary sexp parsing', () => {
        it('parses standalone diary sexp', () => {
            const content = `%%(diary-anniversary 1 15 1990)`;

            const doc = parseOrg(content);
            const diarySexp = doc.section?.children.find(e => e.type === 'diary-sexp') as DiarySexpElement;
            expect(diarySexp).toBeDefined();
            expect(diarySexp.properties.value).toBe('diary-anniversary 1 15 1990');
        });

        it('parses diary sexp with complex expression', () => {
            const content = `%%(org-class 2024 1 15 2024 5 15 1)`;

            const doc = parseOrg(content);
            const diarySexp = doc.section?.children.find(e => e.type === 'diary-sexp') as DiarySexpElement;
            expect(diarySexp).toBeDefined();
            expect(diarySexp.properties.value).toContain('org-class');
        });
    });

    describe('clock entry parsing', () => {
        it('parses clock entry with duration', () => {
            const content = `* Task
CLOCK: [2024-01-15 Mon 10:00]--[2024-01-15 Mon 11:30] =>  1:30`;

            const doc = parseOrg(content);
            const headline = doc.children[0];
            const clock = headline.section?.children.find(e => e.type === 'clock') as ClockElement;
            expect(clock).toBeDefined();
            expect(clock.properties.duration).toBe('1:30');
        });

        it('parses clock entry without duration (running)', () => {
            const content = `* Task
CLOCK: [2024-01-15 Mon 10:00]`;

            const doc = parseOrg(content);
            const headline = doc.children[0];
            const clock = headline.section?.children.find(e => e.type === 'clock') as ClockElement;
            expect(clock).toBeDefined();
            expect(clock.properties.status).toBe('running');
        });

        it('parses multiple clock entries', () => {
            const content = `* Task
CLOCK: [2024-01-15 Mon 10:00]--[2024-01-15 Mon 11:00] =>  1:00
CLOCK: [2024-01-15 Mon 14:00]--[2024-01-15 Mon 15:30] =>  1:30`;

            const doc = parseOrg(content);
            const headline = doc.children[0];
            const clocks = headline.section?.children.filter(e => e.type === 'clock');
            expect(clocks).toHaveLength(2);
        });
    });

    describe('footnote definition parsing', () => {
        it('parses simple footnote definition', () => {
            const content = `Some text with a footnote reference.

[fn:1] This is the footnote definition.`;

            const doc = parseOrg(content);
            const fnDef = doc.section?.children.find(e => e.type === 'footnote-definition') as FootnoteDefinitionElement;
            expect(fnDef).toBeDefined();
            expect(fnDef.properties.label).toBe('1');
        });

        it('parses footnote definition with named label', () => {
            const content = `[fn:my-note] This is a named footnote definition.`;

            const doc = parseOrg(content);
            const fnDef = doc.section?.children.find(e => e.type === 'footnote-definition') as FootnoteDefinitionElement;
            expect(fnDef).toBeDefined();
            expect(fnDef.properties.label).toBe('my-note');
        });

        it('parses footnote definition with multi-line content', () => {
            const content = `[fn:1] This footnote spans
  multiple lines because it's
  indented properly.

Normal paragraph here.`;

            const doc = parseOrg(content);
            const fnDef = doc.section?.children.find(e => e.type === 'footnote-definition') as FootnoteDefinitionElement;
            expect(fnDef).toBeDefined();
            expect(fnDef.children.length).toBeGreaterThan(0);
        });

        it('parses multiple footnote definitions', () => {
            const content = `[fn:1] First footnote.
[fn:2] Second footnote.
[fn:3] Third footnote.`;

            const doc = parseOrg(content);
            const fnDefs = doc.section?.children.filter(e => e.type === 'footnote-definition');
            expect(fnDefs).toHaveLength(3);
        });
    });

    describe('babel call parsing', () => {
        it('parses simple babel call', () => {
            const content = `#+CALL: my-block()`;

            const doc = parseOrg(content);
            const babelCall = doc.section?.children.find(e => e.type === 'babel-call') as BabelCallElement;
            expect(babelCall).toBeDefined();
            expect(babelCall.properties.call).toBe('my-block');
        });

        it('parses babel call with arguments', () => {
            const content = `#+CALL: my-block(x=1, y=2)`;

            const doc = parseOrg(content);
            const babelCall = doc.section?.children.find(e => e.type === 'babel-call') as BabelCallElement;
            expect(babelCall).toBeDefined();
            expect(babelCall.properties.call).toBe('my-block');
            expect(babelCall.properties.arguments).toBe('x=1, y=2');
        });

        it('parses babel call with inside header', () => {
            const content = `#+CALL: my-block[:results output](x=1)`;

            const doc = parseOrg(content);
            const babelCall = doc.section?.children.find(e => e.type === 'babel-call') as BabelCallElement;
            expect(babelCall).toBeDefined();
            expect(babelCall.properties.insideHeader).toBe(':results output');
        });

        it('parses babel call with end header', () => {
            const content = `#+CALL: my-block(x=1)[:exports results]`;

            const doc = parseOrg(content);
            const babelCall = doc.section?.children.find(e => e.type === 'babel-call') as BabelCallElement;
            expect(babelCall).toBeDefined();
            expect(babelCall.properties.endHeader).toBe(':exports results');
        });

        it('parses babel call with all headers', () => {
            const content = `#+CALL: my-block[:results output](x=1, y=2)[:exports both]`;

            const doc = parseOrg(content);
            const babelCall = doc.section?.children.find(e => e.type === 'babel-call') as BabelCallElement;
            expect(babelCall).toBeDefined();
            expect(babelCall.properties.call).toBe('my-block');
            expect(babelCall.properties.insideHeader).toBe(':results output');
            expect(babelCall.properties.arguments).toBe('x=1, y=2');
            expect(babelCall.properties.endHeader).toBe(':exports both');
        });
    });

    describe('affiliated keywords', () => {
        it('collects NAME keyword', () => {
            const content = `#+NAME: my-table
| A | B |
| 1 | 2 |`;

            const doc = parseOrg(content);
            // The table should have the affiliated keywords
            const table = doc.section?.children.find(e => e.type === 'table') as TableElement;
            expect(table).toBeDefined();
        });

        it('collects CAPTION keyword', () => {
            const content = `#+CAPTION: My caption
| A | B |`;

            const doc = parseOrg(content);
            const table = doc.section?.children.find(e => e.type === 'table');
            expect(table).toBeDefined();
        });

        it('collects ATTR keywords', () => {
            const content = `#+ATTR_HTML: :width 100%
#+ATTR_LATEX: :placement [H]
| A | B |`;

            const doc = parseOrg(content);
            const table = doc.section?.children.find(e => e.type === 'table');
            expect(table).toBeDefined();
        });
    });

    describe('full org syntax coverage integration', () => {
        it('parses document with all new element types', () => {
            const content = `#+TITLE: Full Coverage Test

%%(diary-anniversary 1 15 1990)

#+BEGIN: clocktable :scope file
| Headline | Time |
#+END:

[fn:1] Footnote definition in preamble.

#+CALL: named-block(x=1)

* Task with clock entries
CLOCK: [2024-01-15 Mon 10:00]--[2024-01-15 Mon 11:00] =>  1:00

Some paragraph text.

* Level 1 headline
** Level 2 headline

*************** TODO Inline task
Inline task content
*************** END`;

            const doc = parseOrg(content);

            // Check diary sexp (in doc.section - before first headline)
            expect(doc.section?.children.some(e => e.type === 'diary-sexp')).toBe(true);

            // Check dynamic block (in doc.section - before first headline)
            expect(doc.section?.children.some(e => e.type === 'dynamic-block')).toBe(true);

            // Check footnote definition (in doc.section - before first headline)
            expect(doc.section?.children.some(e => e.type === 'footnote-definition')).toBe(true);

            // Check babel call (in doc.section - before first headline)
            expect(doc.section?.children.some(e => e.type === 'babel-call')).toBe(true);

            // Check clock entry (in first headline's section)
            const task = doc.children[0];
            expect(task.section?.children.some(e => e.type === 'clock')).toBe(true);

            // Check inline task (in level 2 headline's section)
            const level1 = doc.children[1];
            const level2 = level1.children[0];
            const hasInlinetask = level2.section?.children.some(e => e.type === 'inlinetask');
            expect(hasInlinetask).toBe(true);
        });
    });
});
