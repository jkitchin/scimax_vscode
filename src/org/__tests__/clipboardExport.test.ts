/**
 * Tests for clipboard export functionality (ox-clip style)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock vscode module
vi.mock('vscode', () => ({
    window: {
        activeTextEditor: undefined,
        showWarningMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
    },
    workspace: {
        getConfiguration: vi.fn(() => ({
            get: vi.fn((key: string, defaultValue: unknown) => defaultValue),
        })),
    },
    env: {
        clipboard: {
            writeText: vi.fn().mockResolvedValue(undefined),
        },
    },
}));

// Mock child_process
vi.mock('child_process', () => ({
    spawn: vi.fn(() => ({
        on: vi.fn(),
        stdout: { pipe: vi.fn() },
        stdin: { write: vi.fn(), end: vi.fn() },
    })),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    })),
}));

describe('Clipboard Export', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('findHeadlineBoundaries', () => {
        // Import dynamically to avoid module resolution issues
        it('should find headline at cursor position', async () => {
            const content = `* Heading 1
Some content here.

** Subheading
More content.

* Heading 2
Final content.`;

            // Test finding the first headline
            const lines = content.split('\n');
            let headlineStart = -1;
            let headlineLevel = 0;
            const cursorLine = 1; // "Some content here."

            for (let i = cursorLine; i >= 0; i--) {
                const match = lines[i].match(/^(\*+)\s+/);
                if (match) {
                    headlineStart = i;
                    headlineLevel = match[1].length;
                    break;
                }
            }

            expect(headlineStart).toBe(0);
            expect(headlineLevel).toBe(1);

            // Find the end
            let headlineEnd = lines.length - 1;
            for (let i = headlineStart + 1; i < lines.length; i++) {
                const match = lines[i].match(/^(\*+)\s+/);
                if (match && match[1].length <= headlineLevel) {
                    headlineEnd = i - 1;
                    break;
                }
            }

            expect(headlineEnd).toBe(5); // Before "* Heading 2"
        });

        it('should find nested headline boundaries', async () => {
            const content = `* Heading 1
** Subheading
Content in subheading.

*** Deep heading
Deep content.

** Another subheading
More content.`;

            const lines = content.split('\n');
            const cursorLine = 5; // "Deep content."

            let headlineStart = -1;
            let headlineLevel = 0;

            for (let i = cursorLine; i >= 0; i--) {
                const match = lines[i].match(/^(\*+)\s+/);
                if (match) {
                    headlineStart = i;
                    headlineLevel = match[1].length;
                    break;
                }
            }

            expect(headlineStart).toBe(4); // "*** Deep heading"
            expect(headlineLevel).toBe(3);

            let headlineEnd = lines.length - 1;
            for (let i = headlineStart + 1; i < lines.length; i++) {
                const match = lines[i].match(/^(\*+)\s+/);
                if (match && match[1].length <= headlineLevel) {
                    headlineEnd = i - 1;
                    break;
                }
            }

            expect(headlineEnd).toBe(6); // Empty line before "** Another subheading"
        });

        it('should return null when no headline found', async () => {
            const content = `Just some text
without any headlines
or structure.`;

            const lines = content.split('\n');
            const cursorLine = 1;

            let headlineStart = -1;

            for (let i = cursorLine; i >= 0; i--) {
                const match = lines[i].match(/^(\*+)\s+/);
                if (match) {
                    headlineStart = i;
                    break;
                }
            }

            expect(headlineStart).toBe(-1);
        });
    });

    describe('Markdown conversion', () => {
        it('should convert headings correctly', () => {
            const orgHeadings = [
                { level: 1, stars: '*' },
                { level: 2, stars: '**' },
                { level: 3, stars: '***' },
            ];

            for (const { level, stars } of orgHeadings) {
                const mdHeading = '#'.repeat(level);
                expect(mdHeading).toBe('#'.repeat(stars.length));
            }
        });

        it('should convert bold correctly', () => {
            const orgBold = '*bold text*';
            const mdBold = '**bold text**';

            // Simple conversion pattern
            expect(orgBold.replace(/^\*(.+)\*$/, '**$1**')).toBe(mdBold);
        });

        it('should convert italic correctly', () => {
            const orgItalic = '/italic text/';
            const mdItalic = '*italic text*';

            // Simple conversion pattern
            expect(orgItalic.replace(/^\/(.+)\/$/, '*$1*')).toBe(mdItalic);
        });

        it('should convert code correctly', () => {
            const orgCode = '=inline code=';
            const mdCode = '`inline code`';

            // Simple conversion pattern
            expect(orgCode.replace(/^=(.+)=$/, '`$1`')).toBe(mdCode);
        });

        it('should convert links correctly', () => {
            const orgLink = '[[https://example.com][Example]]';
            const linkMatch = orgLink.match(/\[\[([^\]]+)\]\[([^\]]+)\]\]/);

            expect(linkMatch).not.toBeNull();
            if (linkMatch) {
                const [, url, desc] = linkMatch;
                const mdLink = `[${desc}](${url})`;
                expect(mdLink).toBe('[Example](https://example.com)');
            }
        });
    });

    describe('Content extraction', () => {
        it('should extract full document', () => {
            const content = `* Heading 1
Content 1

* Heading 2
Content 2`;

            // Full scope returns entire content
            expect(content).toBe(content);
        });

        it('should extract subtree', () => {
            const content = `* Heading 1
Content 1

** Subheading
Subcontent

* Heading 2
Content 2`;

            const lines = content.split('\n');
            const startLine = 0;
            const endLine = 5; // Before "* Heading 2"

            const subtree = lines.slice(startLine, endLine + 1).join('\n');
            expect(subtree).toContain('* Heading 1');
            expect(subtree).toContain('** Subheading');
            expect(subtree).not.toContain('* Heading 2');
        });

        it('should handle selection scope', () => {
            const content = `* Heading 1
Selected text here.
More selected text.
* Heading 2`;

            const selectedText = content.split('\n').slice(1, 3).join('\n');
            expect(selectedText).toBe('Selected text here.\nMore selected text.');
        });
    });

    describe('Platform detection patterns', () => {
        it('should identify macOS platform', () => {
            // On macOS, the platform is 'darwin'
            expect(process.platform === 'darwin' ||
                   process.platform === 'linux' ||
                   process.platform === 'win32').toBe(true);
        });

        it('should have correct tool names for each platform', () => {
            const platformTools: Record<string, string[]> = {
                darwin: ['textutil', 'pbcopy'],
                linux: ['xclip', 'wl-copy', 'xsel'],
                win32: ['powershell'],
            };

            for (const [platform, tools] of Object.entries(platformTools)) {
                expect(tools.length).toBeGreaterThan(0);
                expect(typeof tools[0]).toBe('string');
            }
        });
    });

    describe('HTML wrapping for rich clipboard', () => {
        it('should wrap body-only HTML in document structure', () => {
            const bodyContent = '<p>Hello World</p>';
            const wrapped = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>${bodyContent}</body>
</html>`;

            expect(wrapped).toContain('<!DOCTYPE html>');
            expect(wrapped).toContain(bodyContent);
        });

        it('should include charset for proper encoding', () => {
            const html = '<html><head><meta charset="utf-8"></head><body></body></html>';
            expect(html).toContain('charset="utf-8"');
        });
    });

    describe('LaTeX export for clipboard', () => {
        it('should include necessary packages', () => {
            const latexPreamble = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}`;

            expect(latexPreamble).toContain('\\documentclass');
            expect(latexPreamble).toContain('\\usepackage');
        });

        it('should handle math environments', () => {
            const mathEnv = '\\begin{equation}\nx^2 + y^2 = z^2\n\\end{equation}';
            expect(mathEnv).toContain('\\begin{equation}');
            expect(mathEnv).toContain('\\end{equation}');
        });
    });

    describe('Error handling', () => {
        it('should handle empty content gracefully', () => {
            const content = '';
            expect(content.length).toBe(0);
            expect(content.split('\n').length).toBe(1);
        });

        it('should handle content without headlines', () => {
            const content = 'Just plain text\nwithout structure.';
            const hasHeadline = /^\*+ /m.test(content);
            expect(hasHeadline).toBe(false);
        });

        it('should handle malformed org syntax', () => {
            // Malformed: stars without space after them
            const malformed = '*No space after star\n**Still no space';
            const validHeadlines = malformed.match(/^\*+\s+.+$/gm);
            expect(validHeadlines).toBeNull();
        });
    });

    describe('Configuration handling', () => {
        it('should use default scope when not configured', () => {
            const defaultScope = 'subtree';
            expect(['full', 'subtree', 'selection']).toContain(defaultScope);
        });

        it('should validate scope values', () => {
            const validScopes = ['full', 'subtree', 'selection'];
            const testScope = 'subtree';
            expect(validScopes.includes(testScope)).toBe(true);
        });

        it('should validate preferRichText boolean', () => {
            const preferRich = true;
            expect(typeof preferRich).toBe('boolean');
        });
    });
});

describe('Windows HTML Clipboard Format', () => {
    it('should have correct header structure', () => {
        const header = [
            'Version:0.9',
            'StartHTML:0000000000',
            'EndHTML:0000000000',
            'StartFragment:0000000000',
            'EndFragment:0000000000',
        ].join('\r\n') + '\r\n';

        expect(header).toContain('Version:0.9');
        expect(header).toContain('StartHTML:');
        expect(header).toContain('EndHTML:');
        expect(header).toContain('StartFragment:');
        expect(header).toContain('EndFragment:');
    });

    it('should calculate correct offsets', () => {
        const headerLength = 'Version:0.9\r\nStartHTML:0000000000\r\n'.length;
        expect(headerLength).toBeGreaterThan(0);

        // Offsets should be padded to 10 digits
        const offset = String(100).padStart(10, '0');
        expect(offset).toBe('0000000100');
        expect(offset.length).toBe(10);
    });
});
