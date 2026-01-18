/**
 * Comprehensive tests for org-mode Babel code execution
 * Tests parsing, formatting, and execution context handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    parseHeaderArguments,
    parseResultsFormat,
    serializeHeaderArguments,
    formatResult,
    computeCodeHash,
    tangleSourceBlocks,
    executorRegistry,
    ExecutionResult,
    ResultFormat,
    HeaderArguments,
} from '../orgBabel';
import type { SrcBlockElement } from '../orgElementTypes';

// =============================================================================
// Header Argument Parser Tests
// =============================================================================

describe('parseHeaderArguments', () => {
    describe('basic parsing', () => {
        it('should return empty object for empty string', () => {
            expect(parseHeaderArguments('')).toEqual({});
        });

        it('should return empty object for whitespace only', () => {
            expect(parseHeaderArguments('   ')).toEqual({});
        });

        it('should parse single key-value pair', () => {
            const result = parseHeaderArguments(':dir /tmp');
            expect(result.dir).toBe('/tmp');
        });

        it('should parse multiple key-value pairs', () => {
            const result = parseHeaderArguments(':dir /tmp :session main');
            expect(result.dir).toBe('/tmp');
            expect(result.session).toBe('main');
        });
    });

    describe(':session handling', () => {
        it('should parse :session with value', () => {
            const result = parseHeaderArguments(':session mysession');
            expect(result.session).toBe('mysession');
        });

        it('should parse :session alone as default', () => {
            const result = parseHeaderArguments(':session');
            expect(result.session).toBe('default');
        });

        it('should parse :session followed by another argument', () => {
            const result = parseHeaderArguments(':session :dir /tmp');
            expect(result.session).toBe('default');
            expect(result.dir).toBe('/tmp');
        });

        it('should parse :session none as undefined', () => {
            const result = parseHeaderArguments(':session none');
            expect(result.session).toBeUndefined();
        });
    });

    describe(':var handling', () => {
        it('should parse single variable', () => {
            const result = parseHeaderArguments(':var x=5');
            expect(result.var).toEqual({ x: '5' });
        });

        it('should parse multiple variables', () => {
            const result = parseHeaderArguments(':var x=5 y=10');
            expect(result.var).toEqual({ x: '5', y: '10' });
        });

        it('should parse quoted variable values', () => {
            const result = parseHeaderArguments(':var msg="hello world"');
            expect(result.var).toEqual({ msg: 'hello world' });
        });

        it('should parse single-quoted variable values', () => {
            const result = parseHeaderArguments(":var msg='hello world'");
            expect(result.var).toEqual({ msg: 'hello world' });
        });

        it('should handle table reference syntax', () => {
            const result = parseHeaderArguments(':var data=mytable');
            expect(result.var).toEqual({ data: 'mytable' });
        });
    });

    describe(':results handling', () => {
        it('should parse simple results value', () => {
            const result = parseHeaderArguments(':results output');
            expect(result.results).toBe('output');
        });

        it('should concatenate multiple :results', () => {
            const result = parseHeaderArguments(':results value :results table');
            expect(result.results).toBe('value table');
        });

        it('should parse compound results', () => {
            const result = parseHeaderArguments(':results output verbatim');
            expect(result.results).toBe('output verbatim');
        });
    });

    describe(':exports handling', () => {
        it('should parse :exports code', () => {
            const result = parseHeaderArguments(':exports code');
            expect(result.exports).toBe('code');
        });

        it('should parse :exports results', () => {
            const result = parseHeaderArguments(':exports results');
            expect(result.exports).toBe('results');
        });

        it('should parse :exports both', () => {
            const result = parseHeaderArguments(':exports both');
            expect(result.exports).toBe('both');
        });

        it('should parse :exports none', () => {
            const result = parseHeaderArguments(':exports none');
            expect(result.exports).toBe('none');
        });

        it('should ignore invalid :exports value', () => {
            const result = parseHeaderArguments(':exports invalid');
            expect(result.exports).toBeUndefined();
        });
    });

    describe(':eval handling', () => {
        it('should parse :eval yes', () => {
            const result = parseHeaderArguments(':eval yes');
            expect(result.eval).toBe('yes');
        });

        it('should parse :eval no', () => {
            const result = parseHeaderArguments(':eval no');
            expect(result.eval).toBe('no');
        });

        it('should parse :eval query', () => {
            const result = parseHeaderArguments(':eval query');
            expect(result.eval).toBe('query');
        });

        it('should parse :eval never-export', () => {
            const result = parseHeaderArguments(':eval never-export');
            expect(result.eval).toBe('never-export');
        });

        it('should parse :eval no-export', () => {
            const result = parseHeaderArguments(':eval no-export');
            expect(result.eval).toBe('no-export');
        });

        it('should parse :eval query-export', () => {
            const result = parseHeaderArguments(':eval query-export');
            expect(result.eval).toBe('query-export');
        });
    });

    describe(':noweb handling', () => {
        it('should parse :noweb yes', () => {
            const result = parseHeaderArguments(':noweb yes');
            expect(result.noweb).toBe('yes');
        });

        it('should parse :noweb no', () => {
            const result = parseHeaderArguments(':noweb no');
            expect(result.noweb).toBe('no');
        });

        it('should parse :noweb tangle', () => {
            const result = parseHeaderArguments(':noweb tangle');
            expect(result.noweb).toBe('tangle');
        });

        it('should parse :noweb strip-export', () => {
            const result = parseHeaderArguments(':noweb strip-export');
            expect(result.noweb).toBe('strip-export');
        });
    });

    describe(':cache handling', () => {
        it('should parse :cache yes', () => {
            const result = parseHeaderArguments(':cache yes');
            expect(result.cache).toBe('yes');
        });

        it('should parse :cache no', () => {
            const result = parseHeaderArguments(':cache no');
            expect(result.cache).toBe('no');
        });

        it('should treat other values as no', () => {
            const result = parseHeaderArguments(':cache maybe');
            expect(result.cache).toBe('no');
        });
    });

    describe(':async handling', () => {
        it('should parse :async yes', () => {
            const result = parseHeaderArguments(':async yes');
            expect(result.async).toBe(true);
        });

        it('should parse :async t', () => {
            const result = parseHeaderArguments(':async t');
            expect(result.async).toBe(true);
        });

        it('should parse :async no as false', () => {
            const result = parseHeaderArguments(':async no');
            expect(result.async).toBe(false);
        });
    });

    describe(':tangle handling', () => {
        it('should parse :tangle yes', () => {
            const result = parseHeaderArguments(':tangle yes');
            expect(result.tangle).toBe('yes');
        });

        it('should parse :tangle no', () => {
            const result = parseHeaderArguments(':tangle no');
            expect(result.tangle).toBe('no');
        });

        it('should parse :tangle with filename', () => {
            const result = parseHeaderArguments(':tangle output.py');
            expect(result.tangle).toBe('output.py');
        });
    });

    describe(':file handling', () => {
        it('should parse :file with path', () => {
            const result = parseHeaderArguments(':file output.png');
            expect(result.file).toBe('output.png');
        });

        it('should parse :file-ext', () => {
            const result = parseHeaderArguments(':file-ext png');
            expect(result.fileExt).toBe('png');
        });

        it('should parse :file-desc', () => {
            const result = parseHeaderArguments(':file-desc "A plot"');
            expect(result.fileDesc).toBe('A plot');
        });
    });

    describe(':wrap handling', () => {
        it('should parse :wrap with block type', () => {
            const result = parseHeaderArguments(':wrap QUOTE');
            expect(result.wrap).toBe('QUOTE');
        });

        it('should parse :wrap example', () => {
            const result = parseHeaderArguments(':wrap example');
            expect(result.wrap).toBe('example');
        });
    });

    describe(':prologue and :epilogue', () => {
        it('should parse :prologue', () => {
            const result = parseHeaderArguments(':prologue "import os"');
            expect(result.prologue).toBe('import os');
        });

        it('should parse :epilogue', () => {
            const result = parseHeaderArguments(':epilogue "print(done)"');
            expect(result.epilogue).toBe('print(done)');
        });
    });

    describe(':colnames and :rownames', () => {
        it('should parse :colnames yes', () => {
            const result = parseHeaderArguments(':colnames yes');
            expect(result.colnames).toBe('yes');
        });

        it('should parse :colnames no', () => {
            const result = parseHeaderArguments(':colnames no');
            expect(result.colnames).toBe('no');
        });

        it('should parse :rownames yes', () => {
            const result = parseHeaderArguments(':rownames yes');
            expect(result.rownames).toBe('yes');
        });
    });

    describe(':hlines and :sep', () => {
        it('should parse :hlines yes', () => {
            const result = parseHeaderArguments(':hlines yes');
            expect(result.hlines).toBe('yes');
        });

        it('should parse :hlines no', () => {
            const result = parseHeaderArguments(':hlines no');
            expect(result.hlines).toBe('no');
        });

        it('should parse :sep', () => {
            const result = parseHeaderArguments(':sep ,');
            expect(result.sep).toBe(',');
        });
    });

    describe(':cmdline handling', () => {
        it('should parse :cmdline', () => {
            const result = parseHeaderArguments(':cmdline --verbose');
            expect(result.cmdline).toBe('--verbose');
        });
    });

    describe(':post handling', () => {
        it('should parse :post', () => {
            const result = parseHeaderArguments(':post format-table(results=*this*)');
            expect(result.post).toBe('format-table(results=*this*)');
        });
    });

    describe('complex combinations', () => {
        it('should parse typical Python header', () => {
            const result = parseHeaderArguments(':session :results output :exports both');
            expect(result.session).toBe('default');
            expect(result.results).toBe('output');
            expect(result.exports).toBe('both');
        });

        it('should parse typical R header with variables', () => {
            const result = parseHeaderArguments(':var x=5 y=10 :results value :session R');
            expect(result.var).toEqual({ x: '5', y: '10' });
            expect(result.results).toBe('value');
            expect(result.session).toBe('R');
        });

        it('should parse file output header', () => {
            const result = parseHeaderArguments(':file plot.png :results file :exports results');
            expect(result.file).toBe('plot.png');
            expect(result.results).toBe('file');
            expect(result.exports).toBe('results');
        });

        it('should store unknown arguments', () => {
            const result = parseHeaderArguments(':custom value :another test');
            expect(result.custom).toBe('value');
            expect(result.another).toBe('test');
        });
    });

    describe('edge cases', () => {
        it('should handle keys with uppercase', () => {
            const result = parseHeaderArguments(':DIR /tmp :SESSION main');
            expect(result.dir).toBe('/tmp');
            expect(result.session).toBe('main');
        });

        it('should handle values with paths', () => {
            const result = parseHeaderArguments(':dir /home/user/project/src');
            expect(result.dir).toBe('/home/user/project/src');
        });

        it('should handle values with special characters', () => {
            const result = parseHeaderArguments(':var formula="E=mc^2"');
            expect(result.var).toEqual({ formula: 'E=mc^2' });
        });
    });
});

// =============================================================================
// Results Format Parser Tests
// =============================================================================

describe('parseResultsFormat', () => {
    describe('collection type', () => {
        it('should parse value collection', () => {
            const result = parseResultsFormat('value');
            expect(result.collection).toBe('value');
        });

        it('should parse output collection', () => {
            const result = parseResultsFormat('output');
            expect(result.collection).toBe('output');
        });
    });

    describe('result type', () => {
        it('should parse table type', () => {
            const result = parseResultsFormat('table');
            expect(result.type).toBe('table');
        });

        it('should parse list type', () => {
            const result = parseResultsFormat('list');
            expect(result.type).toBe('list');
        });

        it('should parse verbatim type', () => {
            const result = parseResultsFormat('verbatim');
            expect(result.type).toBe('verbatim');
        });

        it('should parse scalar type', () => {
            const result = parseResultsFormat('scalar');
            expect(result.type).toBe('scalar');
        });

        it('should parse file type', () => {
            const result = parseResultsFormat('file');
            expect(result.type).toBe('file');
        });

        it('should parse html type', () => {
            const result = parseResultsFormat('html');
            expect(result.type).toBe('html');
        });

        it('should parse latex type', () => {
            const result = parseResultsFormat('latex');
            expect(result.type).toBe('latex');
        });

        it('should parse org type', () => {
            const result = parseResultsFormat('org');
            expect(result.type).toBe('org');
        });

        it('should parse pp type', () => {
            const result = parseResultsFormat('pp');
            expect(result.type).toBe('pp');
        });

        it('should parse drawer type', () => {
            const result = parseResultsFormat('drawer');
            expect(result.type).toBe('drawer');
        });
    });

    describe('format', () => {
        it('should parse raw format', () => {
            const result = parseResultsFormat('raw');
            expect(result.format).toBe('raw');
        });

        it('should parse code format', () => {
            const result = parseResultsFormat('code');
            expect(result.format).toBe('code');
        });
    });

    describe('handling', () => {
        it('should parse replace handling', () => {
            const result = parseResultsFormat('replace');
            expect(result.handling).toBe('replace');
        });

        it('should parse append handling', () => {
            const result = parseResultsFormat('append');
            expect(result.handling).toBe('append');
        });

        it('should parse prepend handling', () => {
            const result = parseResultsFormat('prepend');
            expect(result.handling).toBe('prepend');
        });

        it('should parse silent handling', () => {
            const result = parseResultsFormat('silent');
            expect(result.handling).toBe('silent');
        });
    });

    describe('combinations', () => {
        it('should parse value table', () => {
            const result = parseResultsFormat('value table');
            expect(result.collection).toBe('value');
            expect(result.type).toBe('table');
        });

        it('should parse output verbatim replace', () => {
            const result = parseResultsFormat('output verbatim replace');
            expect(result.collection).toBe('output');
            expect(result.type).toBe('verbatim');
            expect(result.handling).toBe('replace');
        });

        it('should parse value raw silent', () => {
            const result = parseResultsFormat('value raw silent');
            expect(result.collection).toBe('value');
            expect(result.format).toBe('raw');
            expect(result.handling).toBe('silent');
        });

        it('should handle extra whitespace', () => {
            const result = parseResultsFormat('  value   table  ');
            expect(result.collection).toBe('value');
            expect(result.type).toBe('table');
        });
    });

    describe('edge cases', () => {
        it('should return empty object for empty string', () => {
            const result = parseResultsFormat('');
            expect(result).toEqual({});
        });

        it('should ignore unknown parts', () => {
            const result = parseResultsFormat('value unknown table');
            expect(result.collection).toBe('value');
            expect(result.type).toBe('table');
        });
    });
});

// =============================================================================
// Header Argument Serialization Tests
// =============================================================================

describe('serializeHeaderArguments', () => {
    it('should serialize empty args', () => {
        const result = serializeHeaderArguments({});
        expect(result).toBe('');
    });

    it('should serialize :dir', () => {
        const result = serializeHeaderArguments({ dir: '/tmp' });
        expect(result).toContain(':dir /tmp');
    });

    it('should serialize :session', () => {
        const result = serializeHeaderArguments({ session: 'main' });
        expect(result).toContain(':session main');
    });

    it('should serialize :var', () => {
        const result = serializeHeaderArguments({ var: { x: '5', y: '10' } });
        expect(result).toContain(':var x=5');
        expect(result).toContain(':var y=10');
    });

    it('should serialize boolean values', () => {
        const result = serializeHeaderArguments({ async: true });
        expect(result).toContain(':async yes');
    });

    it('should serialize boolean false', () => {
        const result = serializeHeaderArguments({ async: false });
        expect(result).toContain(':async no');
    });

    it('should skip undefined values', () => {
        const result = serializeHeaderArguments({ dir: '/tmp', session: undefined });
        expect(result).toBe(':dir /tmp');
    });

    it('should skip null values', () => {
        const result = serializeHeaderArguments({ dir: '/tmp', session: null as unknown as string });
        expect(result).toBe(':dir /tmp');
    });

    it('should serialize multiple arguments', () => {
        const result = serializeHeaderArguments({
            dir: '/tmp',
            session: 'main',
            results: 'output',
        });
        expect(result).toContain(':dir /tmp');
        expect(result).toContain(':session main');
        expect(result).toContain(':results output');
    });
});

// =============================================================================
// Result Formatting Tests
// =============================================================================

describe('formatResult', () => {
    describe('basic formatting', () => {
        it('should format successful result with output', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: 'Hello World',
            };
            const formatted = formatResult(result);
            expect(formatted).toContain('#+RESULTS:');
            expect(formatted).toContain(': Hello World');
        });

        it('should format empty result', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: '',
            };
            const formatted = formatResult(result);
            expect(formatted).toBe('#+RESULTS:');
        });

        it('should format multiline output', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: 'line1\nline2\nline3',
            };
            const formatted = formatResult(result);
            expect(formatted).toContain(': line1');
            expect(formatted).toContain(': line2');
            expect(formatted).toContain(': line3');
        });
    });

    describe('with name', () => {
        it('should include name in results header', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: 'output',
            };
            const formatted = formatResult(result, {}, 'my-result');
            expect(formatted).toContain('#+RESULTS: my-result');
        });
    });

    describe('with cache hash', () => {
        it('should include hash in results header', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: 'output',
            };
            const formatted = formatResult(result, {}, undefined, 'abc123');
            expect(formatted).toContain('#+RESULTS[abc123]:');
        });

        it('should include both hash and name', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: 'output',
            };
            const formatted = formatResult(result, {}, 'my-result', 'abc123');
            expect(formatted).toContain('#+RESULTS[abc123]: my-result');
        });
    });

    describe('error handling', () => {
        it('should format error result', () => {
            const result: ExecutionResult = {
                success: false,
                error: new Error('Something went wrong'),
            };
            const formatted = formatResult(result);
            expect(formatted).toContain('#+RESULTS:');
            expect(formatted).toContain(': Error: Something went wrong');
        });

        it('should format stderr output on failure', () => {
            const result: ExecutionResult = {
                success: false,
                stderr: 'Traceback:\n  File "test.py"',
            };
            const formatted = formatResult(result);
            expect(formatted).toContain('#+RESULTS:');
            expect(formatted).toContain(': Traceback:');
            expect(formatted).toContain(':   File "test.py"');
        });
    });

    describe('table formatting', () => {
        it('should format comma-separated as table', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: 'a,b,c\n1,2,3',
            };
            const formatted = formatResult(result, { type: 'table' });
            expect(formatted).toContain('| a | b | c |');
            expect(formatted).toContain('| 1 | 2 | 3 |');
        });

        it('should format tab-separated as table', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: 'a\tb\tc\n1\t2\t3',
            };
            const formatted = formatResult(result, { type: 'table' });
            expect(formatted).toContain('| a | b | c |');
            expect(formatted).toContain('| 1 | 2 | 3 |');
        });
    });

    describe('list formatting', () => {
        it('should format as list', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: 'item1\nitem2\nitem3',
            };
            const formatted = formatResult(result, { type: 'list' });
            expect(formatted).toContain('- item1');
            expect(formatted).toContain('- item2');
            expect(formatted).toContain('- item3');
        });
    });

    describe('html export formatting', () => {
        it('should wrap in html export block', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: '<p>Hello</p>',
            };
            const formatted = formatResult(result, { type: 'html' });
            expect(formatted).toContain('#+BEGIN_EXPORT html');
            expect(formatted).toContain('<p>Hello</p>');
            expect(formatted).toContain('#+END_EXPORT');
        });
    });

    describe('latex export formatting', () => {
        it('should wrap in latex export block', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: '\\textbf{bold}',
            };
            const formatted = formatResult(result, { type: 'latex' });
            expect(formatted).toContain('#+BEGIN_EXPORT latex');
            expect(formatted).toContain('\\textbf{bold}');
            expect(formatted).toContain('#+END_EXPORT');
        });
    });

    describe('drawer formatting', () => {
        it('should wrap in drawer', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: 'drawer content',
            };
            const formatted = formatResult(result, { type: 'drawer' });
            expect(formatted).toContain(':RESULTS:');
            expect(formatted).toContain('drawer content');
            expect(formatted).toContain(':END:');
        });
    });

    describe('file formatting', () => {
        it('should format as file link', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: 'output.png',
                resultType: 'file',
            };
            const formatted = formatResult(result, { type: 'file' });
            expect(formatted).toContain('[[file:output.png]]');
        });

        it('should append file links from files array', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: '',
                files: ['image1.png', 'image2.png'],
            };
            const formatted = formatResult(result);
            expect(formatted).toContain('[[file:image1.png]]');
            expect(formatted).toContain('[[file:image2.png]]');
        });

        it('should format stdout as verbatim when files exist', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: 'Some output',
                files: ['image.png'],
                resultType: 'file',
            };
            const formatted = formatResult(result);
            expect(formatted).toContain(': Some output');
            expect(formatted).toContain('[[file:image.png]]');
        });
    });

    describe('org formatting', () => {
        it('should output raw org content', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: '* Heading\nSome text',
            };
            const formatted = formatResult(result, { type: 'org' });
            expect(formatted).toContain('#+RESULTS:');
            expect(formatted).toContain('* Heading');
            expect(formatted).toContain('Some text');
            expect(formatted).not.toContain(': '); // No verbatim prefix
        });
    });

    describe(':wrap formatting', () => {
        it('should wrap in specified block type', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: 'quoted text',
            };
            const formatted = formatResult(result, { wrap: 'quote' });
            expect(formatted).toContain('#+BEGIN_QUOTE');
            expect(formatted).toContain('quoted text');
            expect(formatted).toContain('#+END_QUOTE');
        });

        it('should uppercase the wrapper name', () => {
            const result: ExecutionResult = {
                success: true,
                stdout: 'example',
            };
            const formatted = formatResult(result, { wrap: 'example' });
            expect(formatted).toContain('#+BEGIN_EXAMPLE');
            expect(formatted).toContain('#+END_EXAMPLE');
        });
    });
});

// =============================================================================
// Code Hash Tests
// =============================================================================

describe('computeCodeHash', () => {
    it('should compute hash for code', () => {
        const hash = computeCodeHash('print("hello")');
        expect(hash).toMatch(/^[a-f0-9]{40}$/); // SHA1 is 40 hex chars
    });

    it('should return same hash for same code', () => {
        const hash1 = computeCodeHash('x = 1');
        const hash2 = computeCodeHash('x = 1');
        expect(hash1).toBe(hash2);
    });

    it('should return different hash for different code', () => {
        const hash1 = computeCodeHash('x = 1');
        const hash2 = computeCodeHash('x = 2');
        expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
        const hash = computeCodeHash('');
        expect(hash).toMatch(/^[a-f0-9]{40}$/);
    });

    it('should handle multiline code', () => {
        const hash = computeCodeHash('line1\nline2\nline3');
        expect(hash).toMatch(/^[a-f0-9]{40}$/);
    });
});

// =============================================================================
// Tangle Tests
// =============================================================================

describe('tangleSourceBlocks', () => {
    const createBlock = (language: string, code: string, params: string = ''): SrcBlockElement => ({
        type: 'src-block',
        properties: {
            language,
            value: code,
            parameters: params,
        },
        range: { start: 0, end: 100, startLine: 0, endLine: 5, startColumn: 0, endColumn: 0 },
    });

    it('should return empty map for blocks without :tangle', () => {
        const blocks = [
            createBlock('python', 'print(1)'),
            createBlock('python', 'print(2)'),
        ];
        const result = tangleSourceBlocks(blocks);
        expect(result.size).toBe(0);
    });

    it('should skip blocks with :tangle no', () => {
        const blocks = [
            createBlock('python', 'print(1)', ':tangle no'),
        ];
        const result = tangleSourceBlocks(blocks);
        expect(result.size).toBe(0);
    });

    it('should tangle to specified file', () => {
        const blocks = [
            createBlock('python', 'print(1)', ':tangle output.py'),
        ];
        const result = tangleSourceBlocks(blocks);
        expect(result.get('output.py')).toBe('print(1)');
    });

    it('should tangle :tangle yes to target file', () => {
        const blocks = [
            createBlock('python', 'print(1)', ':tangle yes'),
        ];
        const result = tangleSourceBlocks(blocks, 'default.py');
        expect(result.get('default.py')).toBe('print(1)');
    });

    it('should tangle :tangle yes to "output" when no target', () => {
        const blocks = [
            createBlock('python', 'print(1)', ':tangle yes'),
        ];
        const result = tangleSourceBlocks(blocks);
        expect(result.get('output')).toBe('print(1)');
    });

    it('should concatenate multiple blocks to same file', () => {
        const blocks = [
            createBlock('python', 'import os', ':tangle output.py'),
            createBlock('python', 'print(os.getcwd())', ':tangle output.py'),
        ];
        const result = tangleSourceBlocks(blocks);
        expect(result.get('output.py')).toBe('import os\n\nprint(os.getcwd())');
    });

    it('should tangle to multiple files', () => {
        const blocks = [
            createBlock('python', 'print(1)', ':tangle file1.py'),
            createBlock('python', 'print(2)', ':tangle file2.py'),
        ];
        const result = tangleSourceBlocks(blocks);
        expect(result.get('file1.py')).toBe('print(1)');
        expect(result.get('file2.py')).toBe('print(2)');
    });

    it('should handle mixed tangle and non-tangle blocks', () => {
        const blocks = [
            createBlock('python', 'print(1)', ':tangle output.py'),
            createBlock('python', 'print(2)'), // no tangle
            createBlock('python', 'print(3)', ':tangle output.py'),
        ];
        const result = tangleSourceBlocks(blocks);
        expect(result.get('output.py')).toBe('print(1)\n\nprint(3)');
        expect(result.size).toBe(1);
    });
});

// =============================================================================
// Executor Registry Tests
// =============================================================================

describe('ExecutorRegistry', () => {
    describe('language support', () => {
        it('should have shell executor registered', () => {
            expect(executorRegistry.isSupported('sh')).toBe(true);
            expect(executorRegistry.isSupported('bash')).toBe(true);
            expect(executorRegistry.isSupported('shell')).toBe(true);
        });

        it('should have python executor registered', () => {
            expect(executorRegistry.isSupported('python')).toBe(true);
            expect(executorRegistry.isSupported('python3')).toBe(true);
            expect(executorRegistry.isSupported('py')).toBe(true);
        });

        it('should have javascript executor registered', () => {
            expect(executorRegistry.isSupported('js')).toBe(true);
            expect(executorRegistry.isSupported('javascript')).toBe(true);
            expect(executorRegistry.isSupported('node')).toBe(true);
        });

        it('should have typescript executor registered', () => {
            expect(executorRegistry.isSupported('ts')).toBe(true);
            expect(executorRegistry.isSupported('typescript')).toBe(true);
        });

        it('should have julia executor registered', () => {
            expect(executorRegistry.isSupported('julia')).toBe(true);
            expect(executorRegistry.isSupported('jl')).toBe(true);
        });

        it('should have R executor registered', () => {
            expect(executorRegistry.isSupported('r')).toBe(true);
            expect(executorRegistry.isSupported('R')).toBe(true);
        });

        it('should return false for unsupported language', () => {
            expect(executorRegistry.isSupported('unknown')).toBe(false);
            expect(executorRegistry.isSupported('cobol')).toBe(false);
        });

        it('should be case-insensitive', () => {
            expect(executorRegistry.isSupported('PYTHON')).toBe(true);
            expect(executorRegistry.isSupported('Python')).toBe(true);
            expect(executorRegistry.isSupported('BASH')).toBe(true);
        });
    });

    describe('getExecutor', () => {
        it('should return executor for supported language', () => {
            const executor = executorRegistry.getExecutor('python');
            expect(executor).toBeDefined();
            expect(executor?.languages).toContain('python');
        });

        it('should return undefined for unsupported language', () => {
            const executor = executorRegistry.getExecutor('unknown');
            expect(executor).toBeUndefined();
        });
    });

    describe('getLanguages', () => {
        it('should return list of supported languages', () => {
            const languages = executorRegistry.getLanguages();
            expect(languages).toContain('python');
            expect(languages).toContain('bash');
            expect(languages).toContain('javascript');
        });

        it('should not have duplicates', () => {
            const languages = executorRegistry.getLanguages();
            const uniqueLanguages = [...new Set(languages)];
            expect(languages.length).toBe(uniqueLanguages.length);
        });
    });
});

// =============================================================================
// Edge Cases and Error Handling Tests
// =============================================================================

describe('Edge Cases', () => {
    describe('parseHeaderArguments edge cases', () => {
        it('should handle malformed input gracefully', () => {
            // Missing value
            expect(() => parseHeaderArguments(':')).not.toThrow();

            // Just colons
            expect(() => parseHeaderArguments('::: ')).not.toThrow();

            // Weird spacing
            expect(() => parseHeaderArguments(':key    value')).not.toThrow();
        });

        it('should handle very long header strings', () => {
            const longHeader = ':var ' + 'x'.repeat(10000) + '=1';
            expect(() => parseHeaderArguments(longHeader)).not.toThrow();
        });

        it('should handle unicode in values', () => {
            const result = parseHeaderArguments(':var msg="你好世界"');
            expect(result.var).toEqual({ msg: '你好世界' });
        });
    });

    describe('formatResult edge cases', () => {
        it('should handle result with only files', () => {
            const result: ExecutionResult = {
                success: true,
                files: ['image.png'],
            };
            const formatted = formatResult(result);
            expect(formatted).toContain('#+RESULTS:');
            expect(formatted).toContain('[[file:image.png]]');
        });

        it('should handle very long output', () => {
            const longOutput = 'x'.repeat(100000);
            const result: ExecutionResult = {
                success: true,
                stdout: longOutput,
            };
            expect(() => formatResult(result)).not.toThrow();
        });
    });
});
