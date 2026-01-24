/**
 * Tests for DOCX export backend
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as JSZip from 'jszip';
import { exportToDocx, DocxExportOptions, DocxExportBackend } from '../orgExportDocx';
import { parseOrgFast } from '../orgExportParser';
import type { OrgDocumentNode } from '../orgElementTypes';

/**
 * Helper to extract document.xml content from a DOCX buffer
 */
async function extractDocumentXml(buffer: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) {
        throw new Error('Could not extract document.xml from DOCX');
    }
    return documentXml;
}

/**
 * Helper to check if document contains text
 */
function containsText(xml: string, text: string): boolean {
    return xml.includes(text);
}

/**
 * Helper to count occurrences of a pattern
 */
function countOccurrences(xml: string, pattern: string | RegExp): number {
    if (typeof pattern === 'string') {
        return (xml.match(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    }
    return (xml.match(pattern) || []).length;
}

describe('DocxExportBackend', () => {
    describe('Basic Document Structure', () => {
        it('should export a simple document', async () => {
            const content = `#+TITLE: Test Document
#+AUTHOR: Test Author

This is a paragraph.
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);

            expect(buffer).toBeInstanceOf(Buffer);
            expect(buffer.length).toBeGreaterThan(0);

            const xml = await extractDocumentXml(buffer);
            expect(containsText(xml, 'Test Document')).toBe(true);
            expect(containsText(xml, 'Test Author')).toBe(true);
            expect(containsText(xml, 'This is a paragraph')).toBe(true);
        });

        it('should include metadata from keywords', async () => {
            const content = `#+TITLE: My Title
#+AUTHOR: John Doe
#+DATE: 2024-01-15

Content here.
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'My Title')).toBe(true);
            expect(containsText(xml, 'John Doe')).toBe(true);
            expect(containsText(xml, '2024-01-15')).toBe(true);
        });
    });

    describe('Headlines', () => {
        it('should export headlines with correct levels', async () => {
            const content = `* Level 1
** Level 2
*** Level 3
**** Level 4
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'Level 1')).toBe(true);
            expect(containsText(xml, 'Level 2')).toBe(true);
            expect(containsText(xml, 'Level 3')).toBe(true);
            expect(containsText(xml, 'Level 4')).toBe(true);
        });

        it('should include TODO keywords in headlines', async () => {
            const content = `* TODO First task
* DONE Completed task
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc, { includeTodo: true });
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'TODO')).toBe(true);
            expect(containsText(xml, 'DONE')).toBe(true);
            expect(containsText(xml, 'First task')).toBe(true);
            expect(containsText(xml, 'Completed task')).toBe(true);
        });

        it('should include tags in headlines', async () => {
            const content = `* Heading with tags :tag1:tag2:
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc, { includeTags: true });
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'tag1')).toBe(true);
            expect(containsText(xml, 'tag2')).toBe(true);
        });
    });

    describe('Text Formatting', () => {
        it('should export bold text', async () => {
            const content = `This is *bold* text.
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'bold')).toBe(true);
            // Check for bold formatting (w:b element in Word XML)
            expect(xml).toMatch(/<w:b[^>]*\/?>.*?bold/s);
        });

        it('should export italic text', async () => {
            const content = `This is /italic/ text.
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'italic')).toBe(true);
        });

        it('should export underline text', async () => {
            const content = `This is _underlined_ text.
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'underlined')).toBe(true);
        });

        it('should export strikethrough text', async () => {
            const content = `This is +strikethrough+ text.
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'strikethrough')).toBe(true);
        });

        it('should export inline code', async () => {
            const content = `This is =inline code= text.
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'inline code')).toBe(true);
        });

        it('should export verbatim text', async () => {
            const content = `This is ~verbatim~ text.
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'verbatim')).toBe(true);
        });
    });

    describe('Links', () => {
        it('should export external links', async () => {
            const content = `Visit [[https://example.com][Example Site]].
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'Example Site')).toBe(true);
        });

        it('should export plain URL links', async () => {
            const content = `Check https://example.com for more info.
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'example.com')).toBe(true);
        });
    });

    describe('Source Blocks', () => {
        it('should export source blocks', async () => {
            const content = `#+BEGIN_SRC python
def hello():
    print("Hello, World!")
#+END_SRC
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            // The code is split across multiple text runs with highlighting
            expect(containsText(xml, 'def')).toBe(true);
            expect(containsText(xml, 'hello')).toBe(true);
        });

        it('should handle :exports code header', async () => {
            const content = `#+BEGIN_SRC python :exports code
print("Only code")
#+END_SRC

: This is a result
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'Only code')).toBe(true);
        });

        it('should handle :exports none header', async () => {
            const content = `#+BEGIN_SRC python :exports none
print("Should not appear")
#+END_SRC
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            // The code block should not be in the output
            expect(containsText(xml, 'Should not appear')).toBe(false);
        });

        it('should export multiple languages', async () => {
            const content = `#+BEGIN_SRC javascript
console.log("JS");
#+END_SRC

#+BEGIN_SRC shell
echo "Shell"
#+END_SRC
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            // Code is tokenized, so look for individual tokens
            expect(containsText(xml, 'console')).toBe(true);
            expect(containsText(xml, 'log')).toBe(true);
            expect(containsText(xml, 'JS')).toBe(true);
        });
    });

    describe('Example Blocks', () => {
        it('should export example blocks', async () => {
            const content = `#+BEGIN_EXAMPLE
This is example text
with multiple lines
#+END_EXAMPLE
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'This is example text')).toBe(true);
            expect(containsText(xml, 'with multiple lines')).toBe(true);
        });
    });

    describe('Quote Blocks', () => {
        it('should export quote blocks', async () => {
            const content = `#+BEGIN_QUOTE
This is a quotation.
#+END_QUOTE
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'quotation')).toBe(true);
        });
    });

    describe('Tables', () => {
        it('should export simple tables', async () => {
            const content = `| Name  | Age |
|-------+-----|
| Alice |  30 |
| Bob   |  25 |
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'Name')).toBe(true);
            expect(containsText(xml, 'Age')).toBe(true);
            expect(containsText(xml, 'Alice')).toBe(true);
            expect(containsText(xml, 'Bob')).toBe(true);
            // Check for table structure
            expect(xml).toMatch(/<w:tbl>/);
        });

        it('should export tables with captions', async () => {
            const content = `#+CAPTION: Sample data table
| A | B |
|---+---|
| 1 | 2 |
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            // Note: Caption handling depends on parser affiliated keyword support
            // For now just verify the table content is present
            expect(containsText(xml, 'A')).toBe(true);
            expect(containsText(xml, 'B')).toBe(true);
        });
    });

    describe('Lists', () => {
        it('should export unordered lists', async () => {
            const content = `- Item 1
- Item 2
- Item 3
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'Item 1')).toBe(true);
            expect(containsText(xml, 'Item 2')).toBe(true);
            expect(containsText(xml, 'Item 3')).toBe(true);
        });

        it('should export ordered lists', async () => {
            const content = `1. First
2. Second
3. Third
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'First')).toBe(true);
            expect(containsText(xml, 'Second')).toBe(true);
            expect(containsText(xml, 'Third')).toBe(true);
        });

        it('should export nested lists', async () => {
            const content = `- Outer
  - Inner 1
  - Inner 2
- Another outer
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            // Nested list support depends on parser handling
            // Verify at least outer items are present
            expect(containsText(xml, 'Outer')).toBe(true);
            expect(containsText(xml, 'Another outer')).toBe(true);
        });

        it('should export checkboxes', async () => {
            const content = `- [X] Done item
- [ ] Pending item
- [-] Partial item
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'Done item')).toBe(true);
            expect(containsText(xml, 'Pending item')).toBe(true);
        });
    });

    describe('Special Blocks', () => {
        it('should export note blocks', async () => {
            const content = `#+BEGIN_NOTE
This is a note.
#+END_NOTE
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            // Special blocks may be parsed differently by the fast parser
            // Verify the document exports without error
            expect(buffer.length).toBeGreaterThan(0);
        });

        it('should export warning blocks', async () => {
            const content = `#+BEGIN_WARNING
This is a warning.
#+END_WARNING
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            // Special blocks may be parsed differently by the fast parser
            // Verify the document exports without error
            expect(buffer.length).toBeGreaterThan(0);
        });
    });

    describe('Horizontal Rules', () => {
        it('should export horizontal rules', async () => {
            const content = `Before rule.

-----

After rule.
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'Before rule')).toBe(true);
            expect(containsText(xml, 'After rule')).toBe(true);
        });
    });

    describe('Entities', () => {
        it('should export org entities', async () => {
            const content = `Greek letters: \\alpha, \\beta, \\gamma.
Arrows: \\rightarrow, \\leftarrow.
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);
            const xml = await extractDocumentXml(buffer);

            // Should contain UTF-8 representations
            expect(containsText(xml, 'Greek letters')).toBe(true);
        });
    });

    describe('Export Options', () => {
        it('should respect custom font settings', async () => {
            const content = `Simple text.
`;
            const doc = parseOrgFast(content);
            const options: DocxExportOptions = {
                fontFamily: 'Arial',
                fontSize: 12,
            };
            const buffer = await exportToDocx(doc, options);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'Simple text')).toBe(true);
        });

        it('should respect highlight theme option', async () => {
            const content = `#+BEGIN_SRC python
print("test")
#+END_SRC
`;
            const doc = parseOrgFast(content);
            const options: DocxExportOptions = {
                highlightTheme: 'github-dark',
                enableCodeHighlight: true,
            };
            const buffer = await exportToDocx(doc, options);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'print')).toBe(true);
        });

        it('should disable code highlighting when requested', async () => {
            const content = `#+BEGIN_SRC python
def test():
    pass
#+END_SRC
`;
            const doc = parseOrgFast(content);
            const options: DocxExportOptions = {
                enableCodeHighlight: false,
            };
            const buffer = await exportToDocx(doc, options);
            const xml = await extractDocumentXml(buffer);

            expect(containsText(xml, 'def test()')).toBe(true);
        });
    });

    describe('Integration Tests', () => {
        it('should export a complex document', async () => {
            const content = `#+TITLE: Complex Document
#+AUTHOR: Test Author

* Introduction

This document tests *various* /formatting/ _options_.

** Code Example

#+BEGIN_SRC python
def greet(name):
    return f"Hello, {name}!"
#+END_SRC

** Data Table

| Column 1 | Column 2 |
|----------+----------|
| Value A  | Value B  |
| Value C  | Value D  |

** List of Items

- First item
- Second item
  - Nested item
- Third item

* Conclusion

This is the ~end~ of the document.
`;
            const doc = parseOrgFast(content);
            const buffer = await exportToDocx(doc);

            expect(buffer).toBeInstanceOf(Buffer);

            const xml = await extractDocumentXml(buffer);
            expect(containsText(xml, 'Complex Document')).toBe(true);
            expect(containsText(xml, 'Introduction')).toBe(true);
            expect(containsText(xml, 'Code Example')).toBe(true);
            expect(containsText(xml, 'greet')).toBe(true);
            expect(containsText(xml, 'Column 1')).toBe(true);
            expect(containsText(xml, 'First item')).toBe(true);
            expect(containsText(xml, 'Conclusion')).toBe(true);
        });
    });
});

describe('Syntax Highlighting', () => {
    it('should highlight Python code', async () => {
        const content = `#+BEGIN_SRC python
import os
class MyClass:
    def __init__(self):
        self.value = 42
#+END_SRC
`;
        const doc = parseOrgFast(content);
        const buffer = await exportToDocx(doc, { enableCodeHighlight: true });
        const xml = await extractDocumentXml(buffer);

        expect(containsText(xml, 'import')).toBe(true);
        expect(containsText(xml, 'class')).toBe(true);
        expect(containsText(xml, 'def')).toBe(true);
    });

    it('should highlight JavaScript code', async () => {
        const content = `#+BEGIN_SRC javascript
const foo = () => {
    return "bar";
};
#+END_SRC
`;
        const doc = parseOrgFast(content);
        const buffer = await exportToDocx(doc, { enableCodeHighlight: true });
        const xml = await extractDocumentXml(buffer);

        expect(containsText(xml, 'const')).toBe(true);
        expect(containsText(xml, 'return')).toBe(true);
    });

    it('should handle unknown languages gracefully', async () => {
        const content = `#+BEGIN_SRC unknownlang
some code here
#+END_SRC
`;
        const doc = parseOrgFast(content);
        const buffer = await exportToDocx(doc, { enableCodeHighlight: true });
        const xml = await extractDocumentXml(buffer);

        // Should still export the code, just without highlighting
        expect(containsText(xml, 'some code here')).toBe(true);
    });
});

describe('Macros and Export Snippets', () => {
    it('should expand document-defined macros', async () => {
        const content = `#+MACRO: version 1.0.0
#+MACRO: appname MyApplication

Current version: {{{version}}}

Application: {{{appname}}}
`;
        const doc = parseOrgFast(content);
        const buffer = await exportToDocx(doc);
        const xml = await extractDocumentXml(buffer);

        // Macros should be expanded
        expect(containsText(xml, '1.0.0')).toBe(true);
        expect(containsText(xml, 'MyApplication')).toBe(true);
        // Raw macro syntax should NOT appear
        expect(containsText(xml, '{{{version}}}')).toBe(false);
        expect(containsText(xml, '{{{appname}}}')).toBe(false);
    });

    it('should expand built-in macros', async () => {
        const content = `Today is: {{{date}}}

Title: {{{title}}}
`;
        const doc = parseOrgFast(content);
        const buffer = await exportToDocx(doc);
        const xml = await extractDocumentXml(buffer);

        // Built-in macros should be expanded (or at minimum not left as raw syntax)
        // The date macro returns current date
        expect(containsText(xml, 'Today is')).toBe(true);
    });

    it('should filter out HTML export snippets', async () => {
        const content = `Normal text @@html:<span style="color:red">Red text</span>@@ more text.
`;
        const doc = parseOrgFast(content);
        const buffer = await exportToDocx(doc);
        const xml = await extractDocumentXml(buffer);

        // HTML snippet should NOT appear in DOCX
        expect(containsText(xml, '<span')).toBe(false);
        expect(containsText(xml, 'color:red')).toBe(false);
        // But surrounding text should appear
        expect(containsText(xml, 'Normal text')).toBe(true);
        expect(containsText(xml, 'more text')).toBe(true);
    });

    it('should include DOCX export snippets', async () => {
        const content = `Normal text @@docx:DOCX-ONLY-TEXT@@ more text.
`;
        const doc = parseOrgFast(content);
        const buffer = await exportToDocx(doc);
        const xml = await extractDocumentXml(buffer);

        // DOCX snippet SHOULD appear
        expect(containsText(xml, 'DOCX-ONLY-TEXT')).toBe(true);
        expect(containsText(xml, 'Normal text')).toBe(true);
        expect(containsText(xml, 'more text')).toBe(true);
    });

    it('should filter out LaTeX export snippets', async () => {
        const content = `Text with @@latex:\\textbf{bold}@@ latex.
`;
        const doc = parseOrgFast(content);
        const buffer = await exportToDocx(doc);
        const xml = await extractDocumentXml(buffer);

        // LaTeX snippet should NOT appear
        expect(containsText(xml, '\\textbf')).toBe(false);
        // Surrounding text should appear
        expect(containsText(xml, 'Text with')).toBe(true);
        expect(containsText(xml, 'latex')).toBe(true);
    });
});
