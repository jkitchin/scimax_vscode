/**
 * Tests for #+INCLUDE: directive processing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    parseIncludeDirective,
    processInclude,
    processIncludes,
    findIncludes,
    hasIncludes,
    type IncludeDirective,
    type IncludeOptions,
} from '../orgInclude';

// =============================================================================
// Test Utilities
// =============================================================================

let testDir: string;

beforeEach(() => {
    // Create a temporary directory for test files
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'org-include-test-'));
});

afterEach(() => {
    // Clean up test directory
    if (testDir && fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
    }
});

function createTestFile(name: string, content: string): string {
    const filePath = path.join(testDir, name);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
}

// =============================================================================
// Parsing Tests
// =============================================================================

describe('parseIncludeDirective', () => {
    it('should parse basic include', () => {
        const result = parseIncludeDirective('#+INCLUDE: "chapter1.org"', 1);
        expect(result).not.toBeNull();
        expect(result!.file).toBe('chapter1.org');
        expect(result!.blockType).toBeUndefined();
    });

    it('should parse include with src block wrapper', () => {
        const result = parseIncludeDirective('#+INCLUDE: "code.py" src python', 1);
        expect(result).not.toBeNull();
        expect(result!.file).toBe('code.py');
        expect(result!.blockType).toBe('src');
        expect(result!.language).toBe('python');
    });

    it('should parse include with example block', () => {
        const result = parseIncludeDirective('#+INCLUDE: "output.txt" example', 1);
        expect(result).not.toBeNull();
        expect(result!.blockType).toBe('example');
    });

    it('should parse include with quote block', () => {
        const result = parseIncludeDirective('#+INCLUDE: "quote.txt" quote', 1);
        expect(result).not.toBeNull();
        expect(result!.blockType).toBe('quote');
    });

    it('should parse include with export block', () => {
        const result = parseIncludeDirective('#+INCLUDE: "raw.html" export html', 1);
        expect(result).not.toBeNull();
        expect(result!.blockType).toBe('export');
        expect(result!.exportFormat).toBe('html');
    });

    it('should parse :lines option with range', () => {
        const result = parseIncludeDirective('#+INCLUDE: "file.org" :lines "10-20"', 1);
        expect(result).not.toBeNull();
        expect(result!.lines).toEqual({ start: 10, end: 20 });
    });

    it('should parse :lines option with start only', () => {
        const result = parseIncludeDirective('#+INCLUDE: "file.org" :lines "10-"', 1);
        expect(result).not.toBeNull();
        expect(result!.lines).toEqual({ start: 10 });
    });

    it('should parse :lines option with end only', () => {
        const result = parseIncludeDirective('#+INCLUDE: "file.org" :lines "-20"', 1);
        expect(result).not.toBeNull();
        expect(result!.lines).toEqual({ end: 20 });
    });

    it('should parse :minlevel option', () => {
        const result = parseIncludeDirective('#+INCLUDE: "chapter.org" :minlevel 2', 1);
        expect(result).not.toBeNull();
        expect(result!.minLevel).toBe(2);
    });

    it('should parse :only-contents option', () => {
        const result = parseIncludeDirective('#+INCLUDE: "section.org" :only-contents t', 1);
        expect(result).not.toBeNull();
        expect(result!.onlyContents).toBe(true);
    });

    it('should parse multiple options together', () => {
        const result = parseIncludeDirective(
            '#+INCLUDE: "code.py" src python :lines "5-15" :minlevel 2',
            1
        );
        expect(result).not.toBeNull();
        expect(result!.blockType).toBe('src');
        expect(result!.language).toBe('python');
        expect(result!.lines).toEqual({ start: 5, end: 15 });
        expect(result!.minLevel).toBe(2);
    });

    it('should be case-insensitive for keyword', () => {
        const result = parseIncludeDirective('#+include: "file.org"', 1);
        expect(result).not.toBeNull();
        expect(result!.file).toBe('file.org');
    });

    it('should return null for non-include lines', () => {
        expect(parseIncludeDirective('#+TITLE: My Document', 1)).toBeNull();
        expect(parseIncludeDirective('* Heading', 1)).toBeNull();
        expect(parseIncludeDirective('Regular text', 1)).toBeNull();
    });
});

// =============================================================================
// File Processing Tests
// =============================================================================

describe('processInclude', () => {
    it('should include entire file content', () => {
        const content = 'Line 1\nLine 2\nLine 3';
        createTestFile('test.txt', content);

        const directive: IncludeDirective = {
            raw: '#+INCLUDE: "test.txt"',
            file: 'test.txt',
            lineNumber: 1,
        };

        const result = processInclude(directive, { basePath: testDir });
        expect(result.success).toBe(true);
        expect(result.content).toBe(content);
    });

    it('should apply :lines filter', () => {
        createTestFile('test.txt', 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');

        const directive: IncludeDirective = {
            raw: '#+INCLUDE: "test.txt" :lines "2-4"',
            file: 'test.txt',
            lines: { start: 2, end: 4 },
            lineNumber: 1,
        };

        const result = processInclude(directive, { basePath: testDir });
        expect(result.success).toBe(true);
        expect(result.content).toBe('Line 2\nLine 3\nLine 4');
    });

    it('should wrap in src block', () => {
        createTestFile('code.py', 'print("hello")');

        const directive: IncludeDirective = {
            raw: '#+INCLUDE: "code.py" src python',
            file: 'code.py',
            blockType: 'src',
            language: 'python',
            lineNumber: 1,
        };

        const result = processInclude(directive, { basePath: testDir });
        expect(result.success).toBe(true);
        expect(result.content).toBe('#+BEGIN_SRC python\nprint("hello")\n#+END_SRC');
    });

    it('should wrap in example block', () => {
        createTestFile('output.txt', 'Some output');

        const directive: IncludeDirective = {
            raw: '#+INCLUDE: "output.txt" example',
            file: 'output.txt',
            blockType: 'example',
            lineNumber: 1,
        };

        const result = processInclude(directive, { basePath: testDir });
        expect(result.success).toBe(true);
        expect(result.content).toBe('#+BEGIN_EXAMPLE\nSome output\n#+END_EXAMPLE');
    });

    it('should apply minlevel transformation', () => {
        createTestFile('chapter.org', '* Heading 1\n** Heading 2\n*** Heading 3');

        const directive: IncludeDirective = {
            raw: '#+INCLUDE: "chapter.org" :minlevel 2',
            file: 'chapter.org',
            minLevel: 2,
            lineNumber: 1,
        };

        const result = processInclude(directive, { basePath: testDir });
        expect(result.success).toBe(true);
        expect(result.content).toBe('** Heading 1\n*** Heading 2\n**** Heading 3');
    });

    it('should apply only-contents transformation', () => {
        createTestFile(
            'section.org',
            '* Main Heading\nContent paragraph\n** Subheading\nMore content'
        );

        const directive: IncludeDirective = {
            raw: '#+INCLUDE: "section.org" :only-contents t',
            file: 'section.org',
            onlyContents: true,
            lineNumber: 1,
        };

        const result = processInclude(directive, { basePath: testDir });
        expect(result.success).toBe(true);
        expect(result.content).toBe('Content paragraph\n** Subheading\nMore content');
    });

    it('should handle file not found', () => {
        const directive: IncludeDirective = {
            raw: '#+INCLUDE: "nonexistent.org"',
            file: 'nonexistent.org',
            lineNumber: 1,
        };

        const result = processInclude(directive, { basePath: testDir });
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
    });

    it('should handle relative paths', () => {
        fs.mkdirSync(path.join(testDir, 'subdir'), { recursive: true });
        createTestFile('subdir/nested.txt', 'nested content');

        const directive: IncludeDirective = {
            raw: '#+INCLUDE: "subdir/nested.txt"',
            file: 'subdir/nested.txt',
            lineNumber: 1,
        };

        const result = processInclude(directive, { basePath: testDir });
        expect(result.success).toBe(true);
        expect(result.content).toBe('nested content');
    });
});

// =============================================================================
// Recursive Include Tests
// =============================================================================

describe('processIncludes', () => {
    it('should process multiple includes in content', () => {
        createTestFile('part1.txt', 'Part 1 content');
        createTestFile('part2.txt', 'Part 2 content');

        const content = `Before
#+INCLUDE: "part1.txt"
Middle
#+INCLUDE: "part2.txt"
After`;

        const result = processIncludes(content, { basePath: testDir });
        expect(result).toBe('Before\nPart 1 content\nMiddle\nPart 2 content\nAfter');
    });

    it('should handle recursive includes', () => {
        createTestFile('inner.txt', 'Inner content');
        createTestFile('outer.txt', '#+INCLUDE: "inner.txt"');

        const content = '#+INCLUDE: "outer.txt"';

        const result = processIncludes(content, { basePath: testDir, recursive: true });
        expect(result).toBe('Inner content');
    });

    it('should respect maxDepth limit', () => {
        // Create circular includes
        createTestFile('a.txt', '#+INCLUDE: "b.txt"');
        createTestFile('b.txt', '#+INCLUDE: "a.txt"');

        const content = '#+INCLUDE: "a.txt"';

        const result = processIncludes(content, { basePath: testDir, maxDepth: 3 });
        expect(result).toContain('Maximum include depth');
    });

    it('should preserve non-include lines', () => {
        createTestFile('included.txt', 'included');

        const content = `* Heading
Some text
#+INCLUDE: "included.txt"
More text
** Subheading`;

        const result = processIncludes(content, { basePath: testDir });
        expect(result).toBe(`* Heading
Some text
included
More text
** Subheading`);
    });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('findIncludes', () => {
    it('should find all include directives', () => {
        const content = `* Document
#+INCLUDE: "file1.org"
Some text
#+INCLUDE: "file2.org" src python
More text`;

        const includes = findIncludes(content);
        expect(includes).toHaveLength(2);
        expect(includes[0].file).toBe('file1.org');
        expect(includes[1].file).toBe('file2.org');
    });

    it('should return empty array for no includes', () => {
        const content = '* Just a heading\nSome text';
        const includes = findIncludes(content);
        expect(includes).toHaveLength(0);
    });
});

describe('hasIncludes', () => {
    it('should return true if content has includes', () => {
        expect(hasIncludes('#+INCLUDE: "file.org"')).toBe(true);
        expect(hasIncludes('Some text\n#+INCLUDE: "file.org"\nMore text')).toBe(true);
    });

    it('should return false if content has no includes', () => {
        expect(hasIncludes('* Heading')).toBe(false);
        expect(hasIncludes('#+TITLE: My Document')).toBe(false);
    });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Include Integration', () => {
    it('should handle complex document with multiple includes and options', () => {
        // Create test files
        createTestFile('header.org', '#+AUTHOR: Test Author');
        createTestFile(
            'chapter1.org',
            `* Chapter 1
This is chapter 1 content.
** Section 1.1
Details here.`
        );
        createTestFile('code/example.py', 'def hello():\n    print("Hello, World!")\n\nhello()');
        createTestFile('appendix.txt', 'Appendix content line 1\nAppendix content line 2\nAppendix content line 3');

        const mainDoc = `#+TITLE: My Document
#+INCLUDE: "header.org"

* Introduction
Welcome to the document.

#+INCLUDE: "chapter1.org" :minlevel 2

* Code Example
#+INCLUDE: "code/example.py" src python :lines "1-2"

* Appendix
#+INCLUDE: "appendix.txt" :lines "2-3"`;

        const result = processIncludes(mainDoc, { basePath: testDir });

        // Check that header was included
        expect(result).toContain('#+AUTHOR: Test Author');

        // Check that chapter was included with minlevel adjustment
        expect(result).toContain('** Chapter 1');
        expect(result).toContain('*** Section 1.1');

        // Check that code was wrapped in src block with line filter
        expect(result).toContain('#+BEGIN_SRC python');
        expect(result).toContain('def hello():');
        expect(result).not.toContain('hello()'); // Line 4 should be excluded

        // Check that appendix was line-filtered
        expect(result).toContain('Appendix content line 2');
        expect(result).toContain('Appendix content line 3');
        expect(result).not.toContain('Appendix content line 1');
    });
});
