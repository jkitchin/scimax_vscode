/**
 * Tests for the org-mode modification API
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    org,
    parse,
    parseFile,
    writeFile,
    serialize,
    mapHeadlines,
    filterHeadlines,
    findHeadline,
    getAllHeadlines,
    mapElements,
    filterElements,
    getSrcBlocks,
    getTables,
    query,
    tableToJSON,
    jsonToTable,
    setTodo,
    addTag,
    removeTag,
    setProperty,
    removeProperty,
    setPriority,
    sortHeadlines,
    promoteHeadline,
    demoteHeadline,
} from '../orgModify';
import type { HeadlineElement, SrcBlockElement, TableElement } from '../orgElementTypes';

describe('orgModify', () => {
    describe('parse and serialize', () => {
        it('parses org content from string', () => {
            const doc = parse('* TODO My heading\nSome content');
            expect(doc.children).toHaveLength(1);
            expect(doc.children[0].properties.todoKeyword).toBe('TODO');
            expect(doc.children[0].properties.rawValue).toBe('My heading');
        });

        it('round-trips simple document', () => {
            const original = `#+TITLE: Test Document

* Heading 1
Some content here.

** Subheading
More content.

* Heading 2
Final content.
`;
            const doc = parse(original);
            const serialized = serialize(doc);

            // Parse again and verify structure
            const reparsed = parse(serialized);
            expect(reparsed.keywords['TITLE']).toBe('Test Document');
            expect(reparsed.children).toHaveLength(2);
            expect(reparsed.children[0].properties.rawValue).toBe('Heading 1');
            expect(reparsed.children[0].children).toHaveLength(1);
        });

        it('preserves TODO keywords in round-trip', () => {
            const original = `* TODO Task one
* DONE Task two
* Task three
`;
            const doc = parse(original);
            const serialized = serialize(doc);
            const reparsed = parse(serialized);

            expect(reparsed.children[0].properties.todoKeyword).toBe('TODO');
            expect(reparsed.children[1].properties.todoKeyword).toBe('DONE');
            expect(reparsed.children[2].properties.todoKeyword).toBeUndefined();
        });

        it('preserves tags in round-trip', () => {
            const original = `* Heading :tag1:tag2:
`;
            const doc = parse(original);
            const serialized = serialize(doc);
            const reparsed = parse(serialized);

            expect(reparsed.children[0].properties.tags).toEqual(['tag1', 'tag2']);
        });

        it('preserves priority in round-trip', () => {
            const original = `* [#A] High priority
* [#C] Low priority
`;
            const doc = parse(original);
            const serialized = serialize(doc);
            const reparsed = parse(serialized);

            expect(reparsed.children[0].properties.priority).toBe('A');
            expect(reparsed.children[1].properties.priority).toBe('C');
        });

        it('preserves source blocks in round-trip', () => {
            const original = `* Code example
#+BEGIN_SRC python :results output
print("Hello, world!")
#+END_SRC
`;
            const doc = parse(original);
            const serialized = serialize(doc);
            const reparsed = parse(serialized);

            const blocks = getSrcBlocks(reparsed);
            expect(blocks).toHaveLength(1);
            expect(blocks[0].properties.language).toBe('python');
            expect(blocks[0].properties.value).toContain('print("Hello, world!")');
        });

        it('preserves properties drawer in round-trip', () => {
            const original = `* Heading
:PROPERTIES:
:CUSTOM_ID: my-id
:CATEGORY: test
:END:
`;
            const doc = parse(original);
            const serialized = serialize(doc);
            const reparsed = parse(serialized);

            expect(reparsed.children[0].propertiesDrawer).toBeDefined();
            expect(reparsed.children[0].propertiesDrawer!['CUSTOM_ID']).toBe('my-id');
            expect(reparsed.children[0].propertiesDrawer!['CATEGORY']).toBe('test');
        });
    });

    describe('file I/O', () => {
        let tempDir: string;
        let tempFile: string;

        beforeEach(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orgModify-test-'));
            tempFile = path.join(tempDir, 'test.org');
        });

        afterEach(() => {
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
            if (fs.existsSync(tempDir)) {
                fs.rmdirSync(tempDir);
            }
        });

        it('reads and writes org files', () => {
            const original = `* TODO Task
Some content
`;
            fs.writeFileSync(tempFile, original);

            const doc = parseFile(tempFile);
            expect(doc.children[0].properties.todoKeyword).toBe('TODO');

            // Modify and write back
            doc.children[0].properties.todoKeyword = 'DONE';
            doc.children[0].properties.todoType = 'done';
            writeFile(tempFile, doc);

            // Read again and verify
            const modified = parseFile(tempFile);
            expect(modified.children[0].properties.todoKeyword).toBe('DONE');
        });
    });

    describe('mapHeadlines', () => {
        it('visits all headlines in order', () => {
            const doc = parse(`* H1
** H1.1
** H1.2
*** H1.2.1
* H2
`);
            const titles: string[] = [];
            mapHeadlines(doc, h => titles.push(h.properties.rawValue));

            expect(titles).toEqual(['H1', 'H1.1', 'H1.2', 'H1.2.1', 'H2']);
        });

        it('can modify headlines in place', () => {
            const doc = parse(`* TODO Task 1
* TODO Task 2
* DONE Task 3
`);
            mapHeadlines(doc, h => {
                if (h.properties.todoKeyword === 'TODO') {
                    h.properties.todoKeyword = 'DONE';
                    h.properties.todoType = 'done';
                }
            });

            expect(doc.children[0].properties.todoKeyword).toBe('DONE');
            expect(doc.children[1].properties.todoKeyword).toBe('DONE');
            expect(doc.children[2].properties.todoKeyword).toBe('DONE');
        });

        it('provides parent and index to callback', () => {
            const doc = parse(`* Parent
** Child 1
** Child 2
`);
            const calls: Array<{ title: string; parentTitle?: string; index: number }> = [];

            mapHeadlines(doc, (h, parent, index) => {
                calls.push({
                    title: h.properties.rawValue,
                    parentTitle: 'properties' in parent ? (parent as HeadlineElement).properties.rawValue : undefined,
                    index,
                });
            });

            expect(calls).toEqual([
                { title: 'Parent', parentTitle: undefined, index: 0 },
                { title: 'Child 1', parentTitle: 'Parent', index: 0 },
                { title: 'Child 2', parentTitle: 'Parent', index: 1 },
            ]);
        });
    });

    describe('filterHeadlines', () => {
        it('filters headlines by predicate', () => {
            const doc = parse(`* TODO Task 1
* DONE Task 2
* TODO Task 3
* Task 4
`);
            const todos = filterHeadlines(doc, h => h.properties.todoKeyword === 'TODO');

            expect(todos).toHaveLength(2);
            expect(todos[0].properties.rawValue).toBe('Task 1');
            expect(todos[1].properties.rawValue).toBe('Task 3');
        });
    });

    describe('findHeadline', () => {
        it('finds first matching headline', () => {
            const doc = parse(`* First
* Second
* Third
`);
            const found = findHeadline(doc, h => h.properties.rawValue === 'Second');

            expect(found).toBeDefined();
            expect(found!.properties.rawValue).toBe('Second');
        });

        it('returns undefined when no match', () => {
            const doc = parse(`* First
* Second
`);
            const found = findHeadline(doc, h => h.properties.rawValue === 'Missing');

            expect(found).toBeUndefined();
        });
    });

    describe('getAllHeadlines', () => {
        it('returns flat list of all headlines', () => {
            const doc = parse(`* H1
** H1.1
* H2
** H2.1
*** H2.1.1
`);
            const all = getAllHeadlines(doc);

            expect(all).toHaveLength(5);
            expect(all.map(h => h.properties.rawValue)).toEqual([
                'H1', 'H1.1', 'H2', 'H2.1', 'H2.1.1'
            ]);
        });
    });

    describe('mapElements', () => {
        it('finds all source blocks', () => {
            const doc = parse(`* Code
#+BEGIN_SRC python
print("one")
#+END_SRC

Some text.

#+BEGIN_SRC javascript
console.log("two");
#+END_SRC
`);
            const blocks: SrcBlockElement[] = [];
            mapElements(doc, 'src-block', el => blocks.push(el as SrcBlockElement));

            expect(blocks).toHaveLength(2);
            expect(blocks[0].properties.language).toBe('python');
            expect(blocks[1].properties.language).toBe('javascript');
        });
    });

    describe('getSrcBlocks', () => {
        it('returns all source blocks', () => {
            const doc = parse(`#+BEGIN_SRC shell
echo "preamble"
#+END_SRC

* Heading
#+BEGIN_SRC python
print("in heading")
#+END_SRC
`);
            const blocks = getSrcBlocks(doc);

            expect(blocks).toHaveLength(2);
            expect(blocks[0].properties.language).toBe('shell');
            expect(blocks[1].properties.language).toBe('python');
        });
    });

    describe('getTables', () => {
        it('returns all tables', () => {
            const doc = parse(`* Data
| a | b |
| 1 | 2 |

* More data
| x | y | z |
| 3 | 4 | 5 |
`);
            const tables = getTables(doc);

            expect(tables).toHaveLength(2);
        });
    });

    describe('query', () => {
        it('finds headlines with specific TODO keyword', () => {
            const doc = parse(`* TODO Task 1
* DONE Task 2
* TODO Task 3
`);
            const results = query(doc, { type: 'headline', todoKeyword: 'TODO' });

            expect(results).toHaveLength(2);
        });

        it('finds headlines with any TODO', () => {
            const doc = parse(`* TODO Task 1
* DONE Task 2
* No state
`);
            const results = query(doc, { type: 'headline', hasTodo: true });

            expect(results).toHaveLength(2);
        });

        it('finds headlines by todoType', () => {
            const doc = parse(`* TODO Task 1
* DONE Task 2
* TODO Task 3
`);
            const done = query(doc, { type: 'headline', todoType: 'done' });

            expect(done).toHaveLength(1);
            expect((done[0] as HeadlineElement).properties.rawValue).toBe('Task 2');
        });

        it('finds headlines with specific tags', () => {
            const doc = parse(`* Project 1 :project:
* Task :work:urgent:
* Project 2 :project:important:
`);
            const projects = query(doc, { type: 'headline', tags: ['project'] });

            expect(projects).toHaveLength(2);
        });

        it('finds headlines with any matching tag', () => {
            const doc = parse(`* A :tag1:
* B :tag2:
* C :tag3:
`);
            const results = query(doc, { type: 'headline', anyTag: ['tag1', 'tag3'] });

            expect(results).toHaveLength(2);
        });

        it('finds headlines by level', () => {
            const doc = parse(`* Level 1
** Level 2
*** Level 3
** Another 2
`);
            const level2 = query(doc, { type: 'headline', level: 2 });

            expect(level2).toHaveLength(2);
        });

        it('finds headlines by level range', () => {
            const doc = parse(`* L1
** L2
*** L3
**** L4
`);
            const results = query(doc, { type: 'headline', minLevel: 2, maxLevel: 3 });

            expect(results).toHaveLength(2);
        });

        it('finds headlines containing text', () => {
            const doc = parse(`* Important meeting
* Casual chat
* Important deadline
`);
            const important = query(doc, { type: 'headline', titleContains: 'important' });

            expect(important).toHaveLength(2);
        });

        it('finds headlines with property', () => {
            const doc = parse(`* With ID
:PROPERTIES:
:ID: 123
:END:

* Without ID
`);
            const withId = query(doc, { type: 'headline', hasProperty: 'ID' });

            expect(withId).toHaveLength(1);
        });

        it('finds src-blocks by language', () => {
            const doc = parse(`#+BEGIN_SRC python
print("py")
#+END_SRC

#+BEGIN_SRC javascript
console.log("js");
#+END_SRC

#+BEGIN_SRC python
print("py2")
#+END_SRC
`);
            const pythonBlocks = query(doc, { type: 'src-block', language: 'python' });

            expect(pythonBlocks).toHaveLength(2);
        });

        it('supports custom predicate', () => {
            const doc = parse(`* Short
* A much longer title here
* Medium
`);
            const long = query(doc, {
                type: 'headline',
                predicate: h => (h as HeadlineElement).properties.rawValue.length > 10
            });

            expect(long).toHaveLength(1);
        });
    });

    describe('tableToJSON', () => {
        it('converts table to array of objects', () => {
            const doc = parse(`| name  | age |
|-------+-----|
| Alice | 30  |
| Bob   | 25  |
`);
            const tables = getTables(doc);
            const data = tableToJSON(tables[0]) as Record<string, string>[];

            expect(data).toHaveLength(2);
            expect(data[0]).toEqual({ name: 'Alice', age: '30' });
            expect(data[1]).toEqual({ name: 'Bob', age: '25' });
        });

        it('returns array of arrays when useHeader is false', () => {
            const doc = parse(`| a | b |
| 1 | 2 |
| 3 | 4 |
`);
            const tables = getTables(doc);
            const data = tableToJSON(tables[0], { useHeader: false }) as string[][];

            expect(data).toHaveLength(3);
            expect(data[0]).toEqual(['a', 'b']);
            expect(data[1]).toEqual(['1', '2']);
        });

        it('trims whitespace by default', () => {
            const doc = parse(`| name   | value  |
| test   | 123    |
`);
            const tables = getTables(doc);
            const data = tableToJSON(tables[0]) as Record<string, string>[];

            expect(data[0].name).toBe('test');
            expect(data[0].value).toBe('123');
        });
    });

    describe('jsonToTable', () => {
        it('converts objects to table', () => {
            const data = [
                { name: 'Alice', age: 30 },
                { name: 'Bob', age: 25 },
            ];
            const table = jsonToTable(data);

            expect(table).toContain('| name');
            expect(table).toContain('| Alice');
            expect(table).toContain('| Bob');
        });

        it('converts array of arrays to table', () => {
            const data = [
                ['a', 'b'],
                ['1', '2'],
            ];
            const table = jsonToTable(data, { includeHeader: false });

            expect(table).toContain('| a');
            expect(table).toContain('| 1');
        });
    });

    describe('modification helpers', () => {
        describe('setTodo', () => {
            it('sets TODO keyword and type', () => {
                const doc = parse('* Task');
                setTodo(doc.children[0], 'TODO');

                expect(doc.children[0].properties.todoKeyword).toBe('TODO');
                expect(doc.children[0].properties.todoType).toBe('todo');
            });

            it('sets DONE keyword and type', () => {
                const doc = parse('* TODO Task');
                setTodo(doc.children[0], 'DONE');

                expect(doc.children[0].properties.todoKeyword).toBe('DONE');
                expect(doc.children[0].properties.todoType).toBe('done');
            });

            it('removes TODO when undefined', () => {
                const doc = parse('* TODO Task');
                setTodo(doc.children[0], undefined);

                expect(doc.children[0].properties.todoKeyword).toBeUndefined();
                expect(doc.children[0].properties.todoType).toBeUndefined();
            });
        });

        describe('addTag and removeTag', () => {
            it('adds tag to headline', () => {
                const doc = parse('* Heading');
                addTag(doc.children[0], 'newtag');

                expect(doc.children[0].properties.tags).toContain('newtag');
            });

            it('does not add duplicate tags', () => {
                const doc = parse('* Heading :existing:');
                addTag(doc.children[0], 'existing');

                expect(doc.children[0].properties.tags).toEqual(['existing']);
            });

            it('removes tag from headline', () => {
                const doc = parse('* Heading :tag1:tag2:');
                removeTag(doc.children[0], 'tag1');

                expect(doc.children[0].properties.tags).toEqual(['tag2']);
            });
        });

        describe('setProperty and removeProperty', () => {
            it('sets property on headline', () => {
                const doc = parse('* Heading');
                setProperty(doc.children[0], 'CUSTOM_ID', 'my-id');

                expect(doc.children[0].propertiesDrawer).toBeDefined();
                expect(doc.children[0].propertiesDrawer!['CUSTOM_ID']).toBe('my-id');
            });

            it('removes property from headline', () => {
                const doc = parse(`* Heading
:PROPERTIES:
:ID: 123
:OTHER: value
:END:
`);
                removeProperty(doc.children[0], 'ID');

                expect(doc.children[0].propertiesDrawer!['ID']).toBeUndefined();
                expect(doc.children[0].propertiesDrawer!['OTHER']).toBe('value');
            });
        });

        describe('setPriority', () => {
            it('sets priority on headline', () => {
                const doc = parse('* Heading');
                setPriority(doc.children[0], 'A');

                expect(doc.children[0].properties.priority).toBe('A');
            });

            it('removes priority when undefined', () => {
                const doc = parse('* [#A] Heading');
                setPriority(doc.children[0], undefined);

                expect(doc.children[0].properties.priority).toBeUndefined();
            });
        });
    });

    describe('structure utilities', () => {
        describe('sortHeadlines', () => {
            it('sorts headlines by title', () => {
                const doc = parse(`* Zebra
* Apple
* Mango
`);
                sortHeadlines(doc.children, (a, b) =>
                    a.properties.rawValue.localeCompare(b.properties.rawValue)
                );

                expect(doc.children[0].properties.rawValue).toBe('Apple');
                expect(doc.children[1].properties.rawValue).toBe('Mango');
                expect(doc.children[2].properties.rawValue).toBe('Zebra');
            });

            it('sorts headlines by priority', () => {
                const doc = parse(`* [#C] Low
* [#A] High
* [#B] Medium
`);
                const priorityOrder: Record<string, number> = { A: 0, B: 1, C: 2 };
                sortHeadlines(doc.children, (a, b) => {
                    const aPriority = a.properties.priority ? priorityOrder[a.properties.priority] ?? 99 : 99;
                    const bPriority = b.properties.priority ? priorityOrder[b.properties.priority] ?? 99 : 99;
                    return aPriority - bPriority;
                });

                expect(doc.children[0].properties.priority).toBe('A');
                expect(doc.children[1].properties.priority).toBe('B');
                expect(doc.children[2].properties.priority).toBe('C');
            });
        });

        describe('promoteHeadline', () => {
            it('promotes headline and children', () => {
                const doc = parse(`* Parent
** Child
*** Grandchild
`);
                const parent = doc.children[0];
                parent.properties.level = 2; // Make it level 2 first
                parent.children[0].properties.level = 3;
                parent.children[0].children[0].properties.level = 4;

                promoteHeadline(parent);

                expect(parent.properties.level).toBe(1);
                expect(parent.children[0].properties.level).toBe(2);
                expect(parent.children[0].children[0].properties.level).toBe(3);
            });

            it('does not promote past level 1', () => {
                const doc = parse('* Heading');
                promoteHeadline(doc.children[0]);

                expect(doc.children[0].properties.level).toBe(1);
            });
        });

        describe('demoteHeadline', () => {
            it('demotes headline and children', () => {
                const doc = parse(`* Parent
** Child
`);
                demoteHeadline(doc.children[0]);

                expect(doc.children[0].properties.level).toBe(2);
                expect(doc.children[0].children[0].properties.level).toBe(3);
            });
        });
    });

    describe('org namespace', () => {
        it('provides all functions in org namespace', () => {
            expect(org.parseFile).toBe(parseFile);
            expect(org.parse).toBe(parse);
            expect(org.writeFile).toBe(writeFile);
            expect(org.serialize).toBe(serialize);
            expect(org.mapHeadlines).toBe(mapHeadlines);
            expect(org.filterHeadlines).toBe(filterHeadlines);
            expect(org.query).toBe(query);
            expect(org.tableToJSON).toBe(tableToJSON);
            expect(org.setTodo).toBe(setTodo);
        });

        it('works in the documented example pattern', () => {
            const doc = org.parse(`* TODO Task 1
* TODO Task 2
* DONE Task 3
`);
            org.mapHeadlines(doc, h => {
                if (h.properties.todoKeyword === 'TODO') {
                    org.setTodo(h, 'DONE');
                }
            });

            const todos = org.query(doc, { hasTodo: true, todoType: 'todo' });
            expect(todos).toHaveLength(0);

            const done = org.query(doc, { hasTodo: true, todoType: 'done' });
            expect(done).toHaveLength(3);
        });
    });
});
