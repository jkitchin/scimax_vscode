/**
 * Tests for Jupyter Notebook (ipynb) export backend
 */

import { describe, it, expect, vi } from 'vitest';
import {
    IpynbExportBackend,
    exportToIpynb,
    exportToIpynbParticipant,
    type JupyterNotebook,
    type JupyterCell,
} from '../orgExportIpynb';
import { parseOrg } from '../orgParserUnified';
import type {
    OrgDocumentNode,
    HeadlineElement,
    SectionElement,
    ParagraphElement,
    SrcBlockElement,
    PlainTextObject,
} from '../orgElementTypes';

// Mock crypto.randomUUID for consistent test output
vi.mock('crypto', async () => {
    const actual = await vi.importActual<typeof import('crypto')>('crypto');
    let counter = 0;
    return {
        ...actual,
        randomUUID: () => `test-uuid-${counter++}`,
    };
});

// Mock fs for image embedding tests
vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        readFileSync: vi.fn((path: string) => {
            if (path.includes('.png')) {
                return Buffer.from('fake-png-data');
            }
            throw new Error('File not found');
        }),
    };
});

// =============================================================================
// Test Helpers
// =============================================================================

function createRange(start: number, end: number) {
    return { start, end };
}

function createPlainText(value: string, start = 0): PlainTextObject {
    return {
        type: 'plain-text',
        range: createRange(start, start + value.length),
        postBlank: 0,
        properties: { value },
    };
}

function createSimpleDocument(content: string): OrgDocumentNode {
    return {
        type: 'org-data',
        properties: {},
        keywords: { TITLE: 'Test Document' },
        keywordLists: {},
        children: [],
        section: {
            type: 'section',
            range: createRange(0, content.length),
            postBlank: 0,
            children: [
                {
                    type: 'paragraph',
                    range: createRange(0, content.length),
                    postBlank: 0,
                    children: [createPlainText(content)],
                } as ParagraphElement,
            ],
        },
    };
}

function parseNotebook(json: string): JupyterNotebook {
    return JSON.parse(json) as JupyterNotebook;
}

// =============================================================================
// Basic Export Tests
// =============================================================================

describe('IpynbExportBackend', () => {
    describe('Basic notebook structure', () => {
        it('creates valid nbformat 4 notebook', () => {
            const doc = createSimpleDocument('Hello world');
            const backend = new IpynbExportBackend();
            const result = backend.exportDocument(doc);
            const notebook = parseNotebook(result);

            expect(notebook.nbformat).toBe(4);
            expect(notebook.nbformat_minor).toBe(5);
            expect(notebook.metadata).toBeDefined();
            expect(notebook.cells).toBeDefined();
            expect(Array.isArray(notebook.cells)).toBe(true);
        });

        it('includes kernelspec in metadata', () => {
            const doc = createSimpleDocument('Test');
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            expect(notebook.metadata.kernelspec).toBeDefined();
            expect(notebook.metadata.kernelspec.name).toBe('python3');
            expect(notebook.metadata.kernelspec.language).toBe('python');
            expect(notebook.metadata.kernelspec.display_name).toBe('Python 3');
        });

        it('includes title in metadata', () => {
            const doc = createSimpleDocument('Test');
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            expect(notebook.metadata.title).toBe('Test Document');
        });

        it('generates unique cell IDs', () => {
            const doc = parseOrg(`* Heading 1
Paragraph 1

* Heading 2
Paragraph 2`);
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            const ids = notebook.cells.map(c => c.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(ids.length);
        });
    });

    describe('Kernel detection', () => {
        it('uses OX_IPYNB_KERNEL_NAME keyword', () => {
            const doc = parseOrg(`#+OX_IPYNB_KERNEL_NAME: julia-1.9
#+TITLE: Test

Some content`);
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            expect(notebook.metadata.kernelspec.name).toBe('julia-1.9');
        });

        it('detects kernel from most common language', () => {
            const doc = parseOrg(`#+TITLE: Test

#+BEGIN_SRC julia
x = 1
#+END_SRC

#+BEGIN_SRC julia
y = 2
#+END_SRC

#+BEGIN_SRC python
z = 3
#+END_SRC`);
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            expect(notebook.metadata.kernelspec.language).toBe('julia');
        });

        it('uses kernel from options', () => {
            const doc = createSimpleDocument('Test');
            const result = exportToIpynb(doc, { kernel: 'ir' });
            const notebook = parseNotebook(result);

            expect(notebook.metadata.kernelspec.name).toBe('ir');
            expect(notebook.metadata.kernelspec.language).toBe('R');
        });
    });
});

// =============================================================================
// Element Conversion Tests
// =============================================================================

describe('Element to Cell Conversion', () => {
    describe('Headlines', () => {
        it('converts headlines to markdown with proper level', () => {
            const doc = parseOrg(`* Level 1
** Level 2
*** Level 3`);
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            const markdownCell = notebook.cells.find(c => c.cell_type === 'markdown');
            expect(markdownCell).toBeDefined();

            const source = markdownCell!.source.join('');
            expect(source).toContain('# Level 1');
            expect(source).toContain('## Level 2');
            expect(source).toContain('### Level 3');
        });
    });

    describe('Paragraphs', () => {
        it('converts paragraphs to markdown cells', () => {
            const doc = parseOrg(`This is a paragraph.

And another one.`);
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            const markdownCells = notebook.cells.filter(c => c.cell_type === 'markdown');
            expect(markdownCells.length).toBeGreaterThan(0);

            const source = markdownCells[0].source.join('');
            expect(source).toContain('This is a paragraph');
        });

        it('converts inline markup to markdown', () => {
            const doc = parseOrg(`This has *bold* and /italic/ and =code= text.`);
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            const source = notebook.cells[0].source.join('');
            expect(source).toContain('**bold**');
            expect(source).toContain('*italic*');
            expect(source).toContain('`code`');
        });
    });

    describe('Source blocks', () => {
        it('converts matching language to code cells', () => {
            const doc = parseOrg(`#+BEGIN_SRC python
print("Hello")
#+END_SRC`);
            const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
            const notebook = parseNotebook(result);

            const codeCells = notebook.cells.filter(c => c.cell_type === 'code');
            expect(codeCells.length).toBe(1);
            expect(codeCells[0].source.join('')).toContain('print("Hello")');
            expect(codeCells[0].execution_count).toBeNull();
            expect(codeCells[0].outputs).toEqual([]);
        });

        it('converts jupyter-* language to code cells', () => {
            const doc = parseOrg(`#+BEGIN_SRC jupyter-python
print("Hello")
#+END_SRC`);
            const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
            const notebook = parseNotebook(result);

            const codeCells = notebook.cells.filter(c => c.cell_type === 'code');
            expect(codeCells.length).toBe(1);
        });

        it('converts non-matching language to markdown code fence', () => {
            const doc = parseOrg(`#+BEGIN_SRC bash
echo "Hello"
#+END_SRC`);
            const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
            const notebook = parseNotebook(result);

            const codeCells = notebook.cells.filter(c => c.cell_type === 'code');
            expect(codeCells.length).toBe(0);

            const markdownCells = notebook.cells.filter(c => c.cell_type === 'markdown');
            const source = markdownCells[0].source.join('');
            expect(source).toContain('```bash');
        });

        it('skips blocks with :eval no', () => {
            const doc = parseOrg(`#+BEGIN_SRC python :eval no
# This should not become a code cell
x = 1
#+END_SRC`);
            const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
            const notebook = parseNotebook(result);

            const codeCells = notebook.cells.filter(c => c.cell_type === 'code');
            expect(codeCells.length).toBe(0);
        });
    });

    describe('Lists', () => {
        it('converts unordered lists to markdown', () => {
            const doc = parseOrg(`- Item 1
- Item 2
- Item 3`);
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            const source = notebook.cells[0].source.join('');
            expect(source).toContain('- Item 1');
            expect(source).toContain('- Item 2');
        });

        it('converts ordered lists to markdown', () => {
            const doc = parseOrg(`1. First
2. Second
3. Third`);
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            const source = notebook.cells[0].source.join('');
            expect(source).toMatch(/\d+\.\s+First/);
        });

        it('converts checkbox lists to markdown', () => {
            const doc = parseOrg(`- [X] Done
- [ ] Todo
- [-] In progress`);
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            const source = notebook.cells[0].source.join('');
            expect(source).toContain('[x]');
            expect(source).toContain('[ ]');
            expect(source).toContain('[-]');
        });
    });

    describe('Tables', () => {
        it('converts tables to markdown pipe format', () => {
            const doc = parseOrg(`| Name | Age |
|------+-----|
| Alice | 30 |
| Bob   | 25 |`);
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            const source = notebook.cells[0].source.join('');
            expect(source).toContain('|');
            expect(source).toContain('Name');
            expect(source).toContain('Age');
            expect(source).toContain('---');
        });
    });

    describe('LaTeX', () => {
        it('converts LaTeX environments to display math', () => {
            const doc = parseOrg(`\\begin{equation}
E = mc^2
\\end{equation}`);
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            const source = notebook.cells[0].source.join('');
            expect(source).toContain('$$');
        });

        it('preserves inline LaTeX', () => {
            const doc = parseOrg(`The equation $E = mc^2$ is famous.`);
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            const source = notebook.cells[0].source.join('');
            expect(source).toContain('$');
        });
    });

    describe('Links', () => {
        it('converts links to markdown format', () => {
            const doc = parseOrg(`Check out [[https://example.com][Example Site]]`);
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            const source = notebook.cells[0].source.join('');
            // Link should contain the description and URL
            expect(source).toContain('Example Site');
            expect(source).toContain('example.com');
        });

        it('converts image links to markdown images', () => {
            const doc = parseOrg(`[[file:image.png]]`);
            const result = exportToIpynb(doc);
            const notebook = parseNotebook(result);

            const source = notebook.cells[0].source.join('');
            // Image should be rendered with markdown syntax
            expect(source).toContain('image.png');
        });
    });
});

// =============================================================================
// Results Block Handling
// =============================================================================

describe('Results Block Handling', () => {
    it('creates code cells with empty outputs array by default', () => {
        const doc = parseOrg(`#+BEGIN_SRC python
print("Hello")
#+END_SRC`);
        const result = exportToIpynb(doc, {
            kernel: 'python3',
            kernelLanguage: 'python',
        });
        const notebook = parseNotebook(result);

        const codeCells = notebook.cells.filter(c => c.cell_type === 'code');
        expect(codeCells.length).toBe(1);
        expect(codeCells[0].outputs).toBeDefined();
        expect(codeCells[0].outputs).toEqual([]);
    });

    it('creates code cells with proper structure for multiple blocks', () => {
        const doc = parseOrg(`#+BEGIN_SRC python
x = 1
#+END_SRC

#+BEGIN_SRC python
y = 2
#+END_SRC`);
        const result = exportToIpynb(doc, {
            kernel: 'python3',
            kernelLanguage: 'python',
        });
        const notebook = parseNotebook(result);

        const codeCells = notebook.cells.filter(c => c.cell_type === 'code');
        expect(codeCells.length).toBe(2);
    });
});

// =============================================================================
// Cell Metadata Tests
// =============================================================================

describe('Cell Metadata', () => {
    it('creates code cells with proper structure', () => {
        const doc = parseOrg(`#+BEGIN_SRC python
x = 1
#+END_SRC`);
        const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
        const notebook = parseNotebook(result);

        const codeCells = notebook.cells.filter(c => c.cell_type === 'code');
        expect(codeCells.length).toBe(1);
        expect(codeCells[0].metadata).toBeDefined();
        expect(codeCells[0].execution_count).toBeNull();
        expect(codeCells[0].outputs).toEqual([]);
    });

    it('creates markdown cells with proper structure', () => {
        const doc = parseOrg(`* Heading
Some text`);
        const result = exportToIpynb(doc);
        const notebook = parseNotebook(result);

        const markdownCells = notebook.cells.filter(c => c.cell_type === 'markdown');
        expect(markdownCells.length).toBeGreaterThan(0);
        expect(markdownCells[0].metadata).toBeDefined();
    });
});

// =============================================================================
// Participant Mode Tests
// =============================================================================

describe('Participant Mode', () => {
    it('strips content between BEGIN/END SOLUTION markers', () => {
        const doc = parseOrg(`#+BEGIN_SRC python
# Setup code
x = 1

### BEGIN SOLUTION
# This is the solution
y = x + 1
### END SOLUTION

# More code
#+END_SRC`);
        const result = exportToIpynbParticipant(doc, {
            kernel: 'python3',
            kernelLanguage: 'python',
        });
        const notebook = parseNotebook(result);

        const codeCells = notebook.cells.filter(c => c.cell_type === 'code');
        expect(codeCells.length).toBeGreaterThan(0);
        const source = codeCells[0].source.join('');
        expect(source).not.toContain('This is the solution');
        expect(source).toContain('Setup code');
        expect(source).toContain('More code');
    });

    it('strips content between BEGIN/END HIDDEN markers', () => {
        const doc = parseOrg(`#+BEGIN_SRC python
# Visible code

### BEGIN HIDDEN
# Hidden code
### END HIDDEN

# More visible code
#+END_SRC`);
        const result = exportToIpynbParticipant(doc, {
            kernel: 'python3',
            kernelLanguage: 'python',
        });
        const notebook = parseNotebook(result);

        const codeCells = notebook.cells.filter(c => c.cell_type === 'code');
        expect(codeCells.length).toBeGreaterThan(0);
        const source = codeCells[0].source.join('');
        expect(source).not.toContain('Hidden code');
        expect(source).toContain('Visible code');
    });

    it('removes headlines with :remove: tag', () => {
        const doc = parseOrg(`* Normal Heading
Content

* Solution Heading :remove:
This should be removed`);
        const result = exportToIpynbParticipant(doc);
        const notebook = parseNotebook(result);

        const source = notebook.cells.map(c => c.source.join('')).join('');
        expect(source).toContain('Normal Heading');
        expect(source).not.toContain('Solution Heading');
        expect(source).not.toContain('This should be removed');
    });
});

// =============================================================================
// Code-Only Mode Tests
// =============================================================================

describe('Code-Only Mode', () => {
    it('excludes markdown cells in code-only mode', () => {
        const doc = parseOrg(`* Heading
Some text

#+BEGIN_SRC python
x = 1
#+END_SRC

More text`);
        const result = exportToIpynb(doc, {
            kernel: 'python3',
            kernelLanguage: 'python',
            mode: 'code-only',
        });
        const notebook = parseNotebook(result);

        const markdownCells = notebook.cells.filter(c => c.cell_type === 'markdown');
        const codeCells = notebook.cells.filter(c => c.cell_type === 'code');

        expect(markdownCells.length).toBe(0);
        expect(codeCells.length).toBe(1);
    });
});

// =============================================================================
// Custom Notebook Metadata Tests
// =============================================================================

describe('Custom Notebook Metadata', () => {
    it('includes OX_IPYNB_NOTEBOOK_METADATA', () => {
        const doc = parseOrg(`#+OX_IPYNB_NOTEBOOK_METADATA: {"custom_key": "custom_value"}
#+TITLE: Test

Content`);
        const result = exportToIpynb(doc);
        const notebook = parseNotebook(result);

        expect(notebook.metadata.custom_key).toBe('custom_value');
    });

    it('merges custom metadata with notebookMetadata option', () => {
        const doc = createSimpleDocument('Test');
        const result = exportToIpynb(doc, {
            notebookMetadata: {
                custom_setting: true,
            },
        });
        const notebook = parseNotebook(result);

        expect(notebook.metadata.custom_setting).toBe(true);
    });

    it('includes author in metadata', () => {
        const doc = parseOrg(`#+AUTHOR: John Doe
#+TITLE: Test

Content`);
        const result = exportToIpynb(doc);
        const notebook = parseNotebook(result);

        expect(notebook.metadata.authors).toBeDefined();
        expect(notebook.metadata.authors![0].name).toBe('John Doe');
    });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
    it('handles empty document', () => {
        const doc: OrgDocumentNode = {
            type: 'org-data',
            properties: {},
            keywords: {},
            keywordLists: {},
            children: [],
        };
        const result = exportToIpynb(doc);
        const notebook = parseNotebook(result);

        expect(notebook.cells).toEqual([]);
    });

    it('handles document with only keywords', () => {
        const doc = parseOrg(`#+TITLE: Test
#+AUTHOR: Author`);
        const result = exportToIpynb(doc);
        const notebook = parseNotebook(result);

        expect(notebook.metadata.title).toBe('Test');
    });

    it('handles special characters in code', () => {
        const doc = parseOrg(`#+BEGIN_SRC python
print("Hello \\n World")
#+END_SRC`);
        const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
        const notebook = parseNotebook(result);

        const codeCells = notebook.cells.filter(c => c.cell_type === 'code');
        expect(codeCells.length).toBe(1);
    });

    it('handles nested headlines', () => {
        const doc = parseOrg(`* Level 1
** Level 2
*** Level 3
**** Level 4
*** Another Level 3`);
        const result = exportToIpynb(doc);
        const notebook = parseNotebook(result);

        const source = notebook.cells.map(c => c.source.join('')).join('');
        expect(source).toContain('# Level 1');
        expect(source).toContain('#### Level 4');
    });

    it('respects noexport tag', () => {
        const doc = parseOrg(`* Normal
Content

* Secret :noexport:
Hidden content`);
        const result = exportToIpynb(doc);
        const notebook = parseNotebook(result);

        const source = notebook.cells.map(c => c.source.join('')).join('');
        expect(source).toContain('Normal');
        expect(source).not.toContain('Secret');
        expect(source).not.toContain('Hidden content');
    });
});

// =============================================================================
// Source line splitting
// =============================================================================

describe('Source Line Formatting', () => {
    it('splits source into lines with newlines', () => {
        const doc = parseOrg(`#+BEGIN_SRC python
line1
line2
line3
#+END_SRC`);
        const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
        const notebook = parseNotebook(result);

        const codeCell = notebook.cells.find(c => c.cell_type === 'code');
        expect(codeCell).toBeDefined();

        // Each line except the last should end with \n
        const source = codeCell!.source;
        expect(source.length).toBeGreaterThan(1);
        expect(source.slice(0, -1).every(s => s.endsWith('\n'))).toBe(true);
    });
});

describe('Citation export', () => {
    it('exports cite: links in Pandoc format (bare link)', () => {
        const doc = parseOrg(`* Heading

This is text with a citation cite:smith2021.`);
        const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
        const notebook = parseNotebook(result);

        const mdCell = notebook.cells.find(c =>
            c.cell_type === 'markdown' && c.source.join('').includes('citation')
        );
        expect(mdCell).toBeDefined();
        // cite: -> parenthetical format [@key]
        expect(mdCell!.source.join('')).toContain('[@smith2021]');
    });

    it('exports cite: links in Pandoc format (bracket link)', () => {
        const doc = parseOrg(`* Heading

This is text with a citation [[cite:smith2021]].`);
        const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
        const notebook = parseNotebook(result);

        const mdCell = notebook.cells.find(c =>
            c.cell_type === 'markdown' && c.source.join('').includes('citation')
        );
        expect(mdCell).toBeDefined();
        expect(mdCell!.source.join('')).toContain('[@smith2021]');
    });

    it('exports citep: links in parenthetical format', () => {
        const doc = parseOrg(`* Heading

This is text with citep:jones2020.`);
        const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
        const notebook = parseNotebook(result);

        const mdCell = notebook.cells.find(c =>
            c.cell_type === 'markdown' && c.source.join('').includes('text')
        );
        expect(mdCell).toBeDefined();
        expect(mdCell!.source.join('')).toContain('[@jones2020]');
    });

    it('exports citet: links in textual format', () => {
        const doc = parseOrg(`* Heading

As shown by citet:author2019.`);
        const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
        const notebook = parseNotebook(result);

        const mdCell = notebook.cells.find(c =>
            c.cell_type === 'markdown' && c.source.join('').includes('shown')
        );
        expect(mdCell).toBeDefined();
        // citet: -> textual format without brackets @key
        expect(mdCell!.source.join('')).toContain('@author2019');
        expect(mdCell!.source.join('')).not.toContain('[@author2019]');
    });

    it('exports multiple citation keys', () => {
        const doc = parseOrg(`* Heading

See cite:key1,key2,key3 for details.`);
        const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
        const notebook = parseNotebook(result);

        const mdCell = notebook.cells.find(c =>
            c.cell_type === 'markdown' && c.source.join('').includes('See')
        );
        expect(mdCell).toBeDefined();
        expect(mdCell!.source.join('')).toContain('@key1');
        expect(mdCell!.source.join('')).toContain('@key2');
        expect(mdCell!.source.join('')).toContain('@key3');
    });

    it('exports org-ref v3 citation format', () => {
        const doc = parseOrg(`* Heading

Text with cite:&first;&second.`);
        const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
        const notebook = parseNotebook(result);

        const mdCell = notebook.cells.find(c =>
            c.cell_type === 'markdown' && c.source.join('').includes('Text')
        );
        expect(mdCell).toBeDefined();
        expect(mdCell!.source.join('')).toContain('@first');
        expect(mdCell!.source.join('')).toContain('@second');
    });

    it('exports citeauthor: links with suppressed year', () => {
        const doc = parseOrg(`* Heading

According to citeauthor:smith2020.`);
        const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
        const notebook = parseNotebook(result);

        const mdCell = notebook.cells.find(c =>
            c.cell_type === 'markdown' && c.source.join('').includes('According')
        );
        expect(mdCell).toBeDefined();
        // citeauthor uses -@key syntax
        expect(mdCell!.source.join('')).toContain('-@smith2020');
    });

    it('exports citeyear: links as plain keys', () => {
        const doc = parseOrg(`* Heading

Published in citeyear:work2018.`);
        const result = exportToIpynb(doc, { kernel: 'python3', kernelLanguage: 'python' });
        const notebook = parseNotebook(result);

        const mdCell = notebook.cells.find(c =>
            c.cell_type === 'markdown' && c.source.join('').includes('Published')
        );
        expect(mdCell).toBeDefined();
        // citeyear shows key in brackets without @
        expect(mdCell!.source.join('')).toContain('[work2018]');
    });
});
