/**
 * Tests for BibTeX speed commands
 */

import { describe, it, expect, vi } from 'vitest';

// Mock vscode module before importing modules that depend on it
vi.mock('vscode', () => ({
    Position: class { constructor(public line: number, public character: number) {} },
    Selection: class { constructor(public anchor: any, public active: any) {} },
    Range: class { constructor(public start: any, public end: any) {} },
    TextEditorRevealType: { InCenter: 1 },
    window: {
        activeTextEditor: null,
        showQuickPick: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        setStatusBarMessage: vi.fn(),
        createOutputChannel: vi.fn(() => ({
            clear: vi.fn(),
            appendLine: vi.fn(),
            show: vi.fn()
        }))
    },
    commands: {
        executeCommand: vi.fn(),
        registerCommand: vi.fn()
    },
    workspace: {
        getConfiguration: vi.fn(() => ({
            get: vi.fn()
        })),
        openTextDocument: vi.fn()
    },
    env: {
        clipboard: {
            writeText: vi.fn()
        },
        openExternal: vi.fn()
    },
    Uri: {
        parse: vi.fn(),
        file: vi.fn()
    },
    QuickPickItemKind: {
        Separator: -1
    }
}));

import {
    isAtBibtexEntryStart,
    getEntryRange,
    getEntryAtPosition,
    BIBTEX_SPEED_COMMANDS
} from '../bibtexSpeedCommands';
import { parseBibTeX } from '../bibtexParser';

// Mock VS Code document for testing
function createMockDocument(content: string, languageId = 'bibtex') {
    const lines = content.split('\n');
    return {
        languageId,
        lineCount: lines.length,
        getText: (range?: any) => {
            if (!range) return content;
            const startLine = range.start.line;
            const endLine = range.end.line;
            const selectedLines = lines.slice(startLine, endLine + 1);
            if (selectedLines.length === 1) {
                return selectedLines[0].substring(range.start.character, range.end.character);
            }
            selectedLines[0] = selectedLines[0].substring(range.start.character);
            selectedLines[selectedLines.length - 1] = selectedLines[selectedLines.length - 1].substring(0, range.end.character);
            return selectedLines.join('\n');
        },
        lineAt: (line: number) => ({
            text: lines[line] || '',
            range: {
                start: { line, character: 0 },
                end: { line, character: (lines[line] || '').length }
            }
        })
    } as any;
}

function createMockPosition(line: number, character: number) {
    return { line, character } as any;
}

describe('BibTeX Speed Commands', () => {
    describe('isAtBibtexEntryStart', () => {
        const sampleBibtex = `@article{smith2020,
  author = {John Smith},
  title = {A Sample Article},
  year = {2020}
}

@book{jones2021,
  author = {Jane Jones},
  title = {A Sample Book},
  year = {2021}
}`;

        it('returns true when at column 0 of @article line', () => {
            const doc = createMockDocument(sampleBibtex);
            const pos = createMockPosition(0, 0);
            expect(isAtBibtexEntryStart(doc, pos)).toBe(true);
        });

        it('returns true when at column 0 of @book line', () => {
            const doc = createMockDocument(sampleBibtex);
            const pos = createMockPosition(6, 0);
            expect(isAtBibtexEntryStart(doc, pos)).toBe(true);
        });

        it('returns false when not at column 0', () => {
            const doc = createMockDocument(sampleBibtex);
            const pos = createMockPosition(0, 1);
            expect(isAtBibtexEntryStart(doc, pos)).toBe(false);
        });

        it('returns false when on a field line', () => {
            const doc = createMockDocument(sampleBibtex);
            const pos = createMockPosition(1, 0);
            expect(isAtBibtexEntryStart(doc, pos)).toBe(false);
        });

        it('returns false for non-bibtex files', () => {
            const doc = createMockDocument(sampleBibtex, 'org');
            const pos = createMockPosition(0, 0);
            expect(isAtBibtexEntryStart(doc, pos)).toBe(false);
        });

        it('handles various entry types', () => {
            const entries = [
                '@article{key,',
                '@Article{key,',
                '@ARTICLE{key,',
                '@book{key,',
                '@inproceedings{key,',
                '@misc{key,',
                '@phdthesis{key,',
                '@techreport{key,'
            ];

            for (const entry of entries) {
                const doc = createMockDocument(entry);
                const pos = createMockPosition(0, 0);
                expect(isAtBibtexEntryStart(doc, pos)).toBe(true);
            }
        });
    });

    describe('getEntryRange', () => {
        const sampleBibtex = `@article{smith2020,
  author = {John Smith},
  title = {A Sample Article},
  year = {2020}
}

@book{jones2021,
  author = {Jane Jones},
  title = {A Sample Book},
  year = {2021}
}`;

        it('finds the range of the first entry', () => {
            const doc = createMockDocument(sampleBibtex);
            const pos = createMockPosition(0, 0);
            const range = getEntryRange(doc, pos);

            expect(range).not.toBeNull();
            expect(range!.start.line).toBe(0);
            expect(range!.end.line).toBe(4);
        });

        it('finds the range of the second entry', () => {
            const doc = createMockDocument(sampleBibtex);
            const pos = createMockPosition(6, 0);
            const range = getEntryRange(doc, pos);

            expect(range).not.toBeNull();
            expect(range!.start.line).toBe(6);
            expect(range!.end.line).toBe(10);
        });

        it('finds entry when cursor is on field line', () => {
            const doc = createMockDocument(sampleBibtex);
            const pos = createMockPosition(2, 0); // On title line of first entry
            const range = getEntryRange(doc, pos);

            expect(range).not.toBeNull();
            expect(range!.start.line).toBe(0);
            expect(range!.end.line).toBe(4);
        });

        it('handles entry with nested braces', () => {
            const bibtex = `@article{key,
  title = {A {Title} with {Nested} Braces},
  author = {Smith, {John}}
}`;
            const doc = createMockDocument(bibtex);
            const pos = createMockPosition(0, 0);
            const range = getEntryRange(doc, pos);

            expect(range).not.toBeNull();
            expect(range!.start.line).toBe(0);
            expect(range!.end.line).toBe(3);
        });
    });

    describe('getEntryAtPosition', () => {
        const sampleBibtex = `@article{smith2020,
  author = {John Smith},
  title = {A Sample Article},
  year = {2020},
  journal = {Test Journal}
}`;

        it('parses entry at position', () => {
            const doc = createMockDocument(sampleBibtex);
            const pos = createMockPosition(0, 0);
            const entry = getEntryAtPosition(doc, pos);

            expect(entry).not.toBeNull();
            expect(entry!.key).toBe('smith2020');
            expect(entry!.type).toBe('article');
            expect(entry!.author).toBe('John Smith');
            expect(entry!.title).toBe('A Sample Article');
            expect(entry!.year).toBe('2020');
        });

        it('returns null when not in an entry', () => {
            const doc = createMockDocument('% Just a comment');
            const pos = createMockPosition(0, 0);
            const entry = getEntryAtPosition(doc, pos);

            expect(entry).toBeNull();
        });
    });

    describe('BIBTEX_SPEED_COMMANDS configuration', () => {
        it('has all required commands defined', () => {
            const requiredCommands = [
                'scimax.bibtex.nextEntry',
                'scimax.bibtex.previousEntry',
                'scimax.bibtex.jumpToEntry',
                'scimax.bibtex.sortFields',
                'scimax.bibtex.downcaseEntry',
                'scimax.bibtex.titleCase',
                'scimax.bibtex.sentenceCase',
                'scimax.bibtex.cleanEntry',
                'scimax.bibtex.openPdf',
                'scimax.bibtex.openUrl',
                'scimax.bibtex.openNotes',
                'scimax.bibtex.googleScholar',
                'scimax.bibtex.crossref',
                'scimax.bibtex.webOfScience',
                'scimax.bibtex.copyKey',
                'scimax.bibtex.copyBibtex',
                'scimax.bibtex.killEntry',
                'scimax.bibtex.help'
            ];

            const definedCommands = BIBTEX_SPEED_COMMANDS.map(cmd => cmd.command);

            for (const cmd of requiredCommands) {
                expect(definedCommands).toContain(cmd);
            }
        });

        it('has unique keys for all commands', () => {
            const keys = BIBTEX_SPEED_COMMANDS.map(cmd => cmd.key);
            const uniqueKeys = new Set(keys);
            expect(uniqueKeys.size).toBe(keys.length);
        });

        it('has descriptions for all commands', () => {
            for (const cmd of BIBTEX_SPEED_COMMANDS) {
                expect(cmd.description).toBeTruthy();
                expect(cmd.description.length).toBeGreaterThan(0);
            }
        });
    });

    describe('BibTeX parsing integration', () => {
        it('correctly parses entries for speed command operations', () => {
            const bibtex = `@Article{Einstein1905,
  Author = {Albert Einstein},
  Title = {On the Electrodynamics of Moving Bodies},
  Journal = {Annalen der Physik},
  Year = {1905},
  Volume = {17},
  Pages = {891--921},
  DOI = {10.1002/andp.19053221004}
}`;
            const result = parseBibTeX(bibtex);

            expect(result.entries).toHaveLength(1);
            expect(result.entries[0].key).toBe('Einstein1905');
            expect(result.entries[0].type).toBe('article');
            expect(result.entries[0].doi).toBe('10.1002/andp.19053221004');
        });

        it('handles multiple entries', () => {
            const bibtex = `@article{entry1,
  title = {First}
}

@book{entry2,
  title = {Second}
}

@inproceedings{entry3,
  title = {Third}
}`;
            const result = parseBibTeX(bibtex);

            expect(result.entries).toHaveLength(3);
            expect(result.entries[0].key).toBe('entry1');
            expect(result.entries[1].key).toBe('entry2');
            expect(result.entries[2].key).toBe('entry3');
        });
    });

    describe('Title case conversion', () => {
        // Test the title case logic indirectly through expected behavior
        it('preserves braced content in titles', () => {
            const bibtex = `@article{key,
  title = {The {DNA} Structure}
}`;
            const result = parseBibTeX(bibtex);
            // Braces are preserved during parsing
            expect(result.entries[0].title).toContain('DNA');
        });
    });

    describe('Field ordering', () => {
        it('recognizes standard BibTeX fields', () => {
            const standardFields = [
                'author', 'title', 'journal', 'year', 'volume',
                'number', 'pages', 'doi', 'url', 'abstract'
            ];

            const bibtex = `@article{key,
  author = {Test Author},
  title = {Test Title},
  journal = {Test Journal},
  year = {2024},
  volume = {1},
  number = {2},
  pages = {1-10},
  doi = {10.1234/test},
  url = {https://example.com},
  abstract = {Test abstract}
}`;
            const result = parseBibTeX(bibtex);

            for (const field of standardFields) {
                expect(result.entries[0].fields[field]).toBeDefined();
            }
        });
    });
});
