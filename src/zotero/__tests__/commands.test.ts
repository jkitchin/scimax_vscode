/**
 * Tests for Zotero commands module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';

// Mock vscode module
vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: vi.fn().mockReturnValue({
            get: vi.fn().mockImplementation((key: string) => {
                if (key === 'citationSyntax') return 'org-ref-v3';
                if (key === 'defaultCiteStyle') return 'cite';
                return undefined;
            })
        })
    },
    window: {
        showErrorMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showQuickPick: vi.fn(),
        showSaveDialog: vi.fn(),
        withProgress: vi.fn().mockImplementation(async (_options, task) => {
            const progress = { report: vi.fn() };
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: vi.fn()
            };
            return task(progress, token);
        }),
        activeTextEditor: null
    },
    commands: {
        registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() })
    },
    ProgressLocation: {
        Notification: 1
    },
    Position: class {
        constructor(public line: number, public character: number) {}
    },
    Selection: class {
        constructor(public anchor: unknown, public active: unknown) {}
    },
    Uri: {
        file: (path: string) => ({ fsPath: path })
    }
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn()
}));

// Mock zoteroService
vi.mock('../zoteroService', () => ({
    isZoteroRunning: vi.fn(),
    openCitationPicker: vi.fn(),
    exportBibTeX: vi.fn()
}));

// Import after mocking
import {
    findDocumentBibliography,
    escapeRegExp,
    formatOrgRefCitation,
    registerZoteroCommands,
    appendBibTeXEntries,
    findCitationAtCursor,
    formatKeysForAppend
} from '../commands';
import * as vscode from 'vscode';
import * as fsPromises from 'fs/promises';
import { isZoteroRunning, openCitationPicker, exportBibTeX } from '../zoteroService';

describe('findDocumentBibliography', () => {
    // Use a temp directory that exists on all platforms for cross-platform tests
    const docDir = path.resolve(process.cwd(), 'test-docs');
    const docPath = path.join(docDir, 'paper.org');

    describe('bibliography: link syntax', () => {
        it('should find simple relative path', () => {
            const text = 'Some text\nbibliography:./refs.bib\nMore text';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe(path.join(docDir, 'refs.bib'));
        });

        it('should find absolute path', () => {
            const absPath = path.resolve('/absolute/path/refs.bib');
            const text = `bibliography:${absPath}`;
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe(absPath);
        });

        it('should expand tilde path', () => {
            const originalHome = process.env.HOME;
            const testHome = path.resolve('/home/testuser');
            process.env.HOME = testHome;

            const text = 'bibliography:~/Documents/refs.bib';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe(path.join(testHome, 'Documents', 'refs.bib'));

            process.env.HOME = originalHome;
        });

        it('should add .bib extension if missing', () => {
            const text = 'bibliography:./references';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe(path.join(docDir, 'references.bib'));
        });

        it('should handle comma-separated paths (take first)', () => {
            const text = 'bibliography:./local.bib,~/global.bib';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe(path.join(docDir, 'local.bib'));
        });

        it('should be case-insensitive', () => {
            const text = 'BIBLIOGRAPHY:./refs.bib';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe(path.join(docDir, 'refs.bib'));
        });

        it('should handle path without leading ./', () => {
            const text = 'bibliography:refs.bib';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe(path.join(docDir, 'refs.bib'));
        });
    });

    describe('#+BIBLIOGRAPHY: keyword syntax', () => {
        it('should find #+BIBLIOGRAPHY: keyword', () => {
            const text = '#+TITLE: Paper\n#+BIBLIOGRAPHY: ./references.bib\n* Introduction';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe(path.join(docDir, 'references.bib'));
        });

        it('should handle absolute path in keyword', () => {
            const absPath = path.resolve('/absolute/refs.bib');
            const text = `#+BIBLIOGRAPHY: ${absPath}`;
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe(absPath);
        });

        it('should prefer bibliography: link over #+BIBLIOGRAPHY:', () => {
            const text = 'bibliography:./first.bib\n#+BIBLIOGRAPHY: ./second.bib';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe(path.join(docDir, 'first.bib'));
        });
    });

    describe('no bibliography found', () => {
        it('should return null when no bibliography link', () => {
            const text = '* Heading\nSome content without bibliography';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBeNull();
        });

        it('should return null for empty document', () => {
            const result = findDocumentBibliography('', docPath);
            expect(result).toBeNull();
        });
    });
});

describe('escapeRegExp', () => {
    it('should escape special regex characters', () => {
        expect(escapeRegExp('test.key')).toBe('test\\.key');
        expect(escapeRegExp('test*key')).toBe('test\\*key');
        expect(escapeRegExp('test+key')).toBe('test\\+key');
        expect(escapeRegExp('test?key')).toBe('test\\?key');
        expect(escapeRegExp('test^key')).toBe('test\\^key');
        expect(escapeRegExp('test$key')).toBe('test\\$key');
        expect(escapeRegExp('test{key}')).toBe('test\\{key\\}');
        expect(escapeRegExp('test(key)')).toBe('test\\(key\\)');
        expect(escapeRegExp('test[key]')).toBe('test\\[key\\]');
        expect(escapeRegExp('test|key')).toBe('test\\|key');
        expect(escapeRegExp('test\\key')).toBe('test\\\\key');
    });

    it('should handle strings without special characters', () => {
        expect(escapeRegExp('simplekey2024')).toBe('simplekey2024');
        expect(escapeRegExp('smith-jones_2024')).toBe('smith-jones_2024');
    });

    it('should handle empty string', () => {
        expect(escapeRegExp('')).toBe('');
    });

    it('should handle multiple special characters', () => {
        expect(escapeRegExp('a.b*c?d')).toBe('a\\.b\\*c\\?d');
    });
});

describe('formatOrgRefCitation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('org-ref v3 syntax', () => {
        beforeEach(() => {
            (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
                get: vi.fn().mockImplementation((key: string) => {
                    if (key === 'citationSyntax') return 'org-ref-v3';
                    if (key === 'defaultCiteStyle') return 'cite';
                    return undefined;
                })
            });
        });

        it('should format single key with & prefix', () => {
            const result = formatOrgRefCitation(['smith2024']);
            expect(result).toBe('cite:&smith2024');
        });

        it('should format multiple keys with ; separator', () => {
            const result = formatOrgRefCitation(['smith2024', 'jones2023', 'doe2022']);
            expect(result).toBe('cite:&smith2024;&jones2023;&doe2022');
        });

        it('should use configured cite style', () => {
            (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
                get: vi.fn().mockImplementation((key: string) => {
                    if (key === 'citationSyntax') return 'org-ref-v3';
                    if (key === 'defaultCiteStyle') return 'citep';
                    return undefined;
                })
            });

            const result = formatOrgRefCitation(['smith2024']);
            expect(result).toBe('citep:&smith2024');
        });
    });

    describe('org-ref v2 syntax', () => {
        beforeEach(() => {
            (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
                get: vi.fn().mockImplementation((key: string) => {
                    if (key === 'citationSyntax') return 'org-ref-v2';
                    if (key === 'defaultCiteStyle') return 'cite';
                    return undefined;
                })
            });
        });

        it('should format single key without prefix', () => {
            const result = formatOrgRefCitation(['smith2024']);
            expect(result).toBe('cite:smith2024');
        });

        it('should format multiple keys with , separator', () => {
            const result = formatOrgRefCitation(['smith2024', 'jones2023', 'doe2022']);
            expect(result).toBe('cite:smith2024,jones2023,doe2022');
        });

        it('should use configured cite style', () => {
            (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
                get: vi.fn().mockImplementation((key: string) => {
                    if (key === 'citationSyntax') return 'org-ref-v2';
                    if (key === 'defaultCiteStyle') return 'citet';
                    return undefined;
                })
            });

            const result = formatOrgRefCitation(['smith2024']);
            expect(result).toBe('citet:smith2024');
        });
    });

    describe('default values', () => {
        it('should default to org-ref-v3 when not configured', () => {
            (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
                get: vi.fn().mockReturnValue(undefined)
            });

            const result = formatOrgRefCitation(['smith2024']);
            expect(result).toBe('cite:&smith2024');
        });
    });
});

describe('registerZoteroCommands', () => {
    let mockContext: { subscriptions: { dispose: () => void }[] };
    let mockReferenceManager: { loadBibliographies: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();

        mockContext = {
            subscriptions: []
        };

        mockReferenceManager = {
            loadBibliographies: vi.fn().mockResolvedValue(undefined)
        };
    });

    it('should register the insertCitation command', () => {
        registerZoteroCommands(mockContext as any, mockReferenceManager as any);

        expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
            'scimax.zotero.insertCitation',
            expect.any(Function)
        );
        expect(mockContext.subscriptions).toHaveLength(1);
    });
});

describe('insertCitation command behavior', () => {
    let commandHandler: () => Promise<void>;
    // Use cross-platform paths for test fixtures
    const mockDocDir = path.resolve(process.cwd(), 'test-user-docs');
    const mockDocPath = path.join(mockDocDir, 'test.org');

    let mockEditor: {
        document: {
            languageId: string;
            uri: { fsPath: string };
            getText: ReturnType<typeof vi.fn>;
            lineAt: ReturnType<typeof vi.fn>;
            lineCount: number;
        };
        selection: { active: { line: number; character: number } };
        edit: ReturnType<typeof vi.fn>;
    };
    let mockReferenceManager: { loadBibliographies: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();

        mockEditor = {
            document: {
                languageId: 'org',
                uri: { fsPath: mockDocPath },
                getText: vi.fn().mockReturnValue('* Test document'),
                lineAt: vi.fn().mockReturnValue({ text: '' }),
                lineCount: 1
            },
            selection: { active: { line: 0, character: 0 } },
            edit: vi.fn().mockResolvedValue(true)
        };

        mockReferenceManager = {
            loadBibliographies: vi.fn().mockResolvedValue(undefined)
        };

        // Set up activeTextEditor
        (vscode.window as any).activeTextEditor = mockEditor;

        // Capture the command handler
        (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mockImplementation(
            (_name: string, handler: () => Promise<void>) => {
                commandHandler = handler;
                return { dispose: vi.fn() };
            }
        );

        registerZoteroCommands({ subscriptions: [] } as any, mockReferenceManager as any);
    });

    afterEach(() => {
        (vscode.window as any).activeTextEditor = null;
    });

    it('should show error when no active editor', async () => {
        (vscode.window as any).activeTextEditor = null;

        await commandHandler();

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No active editor');
    });

    it('should show warning for non-org/markdown/latex files', async () => {
        mockEditor.document.languageId = 'javascript';
        (isZoteroRunning as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        (openCitationPicker as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        await commandHandler();

        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            'Zotero citations work best in org, markdown, or LaTeX files'
        );
    });

    it('should show error when Zotero is not running', async () => {
        (isZoteroRunning as ReturnType<typeof vi.fn>).mockResolvedValue(false);

        await commandHandler();

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            'Zotero is not running or Better BibTeX is not installed. Please start Zotero with Better BibTeX enabled.'
        );
    });

    it('should return silently when user cancels citation picker', async () => {
        (isZoteroRunning as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        (openCitationPicker as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        await commandHandler();

        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(mockEditor.edit).not.toHaveBeenCalled();
    });

    it('should show error when BibTeX export fails', async () => {
        (isZoteroRunning as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        (openCitationPicker as ReturnType<typeof vi.fn>).mockResolvedValue({
            keys: ['smith2024'],
            raw: '[@smith2024]'
        });
        (exportBibTeX as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (fsPromises.access as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

        await commandHandler();

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            'Failed to fetch BibTeX from Zotero'
        );
    });

    it('should insert citation and update bib file on success', async () => {
        const bibtex = '@article{smith2024,\n  author = {Smith},\n  title = {Test}\n}';

        (isZoteroRunning as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        (openCitationPicker as ReturnType<typeof vi.fn>).mockResolvedValue({
            keys: ['smith2024'],
            raw: '[@smith2024]'
        });
        (exportBibTeX as ReturnType<typeof vi.fn>).mockResolvedValue(bibtex);
        (fsPromises.access as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
        (fsPromises.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
            Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        );
        (fsPromises.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        // Mock configuration for v3 syntax
        (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
            get: vi.fn().mockImplementation((key: string) => {
                if (key === 'citationSyntax') return 'org-ref-v3';
                if (key === 'defaultCiteStyle') return 'cite';
                return undefined;
            })
        });

        await commandHandler();

        // Should have written to bib file
        expect(fsPromises.writeFile).toHaveBeenCalled();

        // Should have inserted citation
        expect(mockEditor.edit).toHaveBeenCalled();

        // Should show success message
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            expect.stringContaining('Inserted 1 citation')
        );

        // Should reload bibliographies
        expect(mockReferenceManager.loadBibliographies).toHaveBeenCalled();
    });

    it('should use existing bibliography link from document', async () => {
        const bibtex = '@article{smith2024,\n  author = {Smith},\n  title = {Test}\n}';

        mockEditor.document.getText.mockReturnValue('bibliography:./existing.bib\n* Content');

        (isZoteroRunning as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        (openCitationPicker as ReturnType<typeof vi.fn>).mockResolvedValue({
            keys: ['smith2024'],
            raw: '[@smith2024]'
        });
        (exportBibTeX as ReturnType<typeof vi.fn>).mockResolvedValue(bibtex);
        (fsPromises.access as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        (fsPromises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('');
        (fsPromises.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        await commandHandler();

        // Should write to the existing bib path (use cross-platform path)
        expect(fsPromises.writeFile).toHaveBeenCalledWith(
            path.join(mockDocDir, 'existing.bib'),
            expect.any(String),
            'utf8'
        );
    });

    it('should prompt user when references.bib exists but not linked', async () => {
        const bibtex = '@article{smith2024,\n  author = {Smith},\n  title = {Test}\n}';

        mockEditor.document.getText.mockReturnValue('* Content without bib link');

        (isZoteroRunning as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        (openCitationPicker as ReturnType<typeof vi.fn>).mockResolvedValue({
            keys: ['smith2024'],
            raw: '[@smith2024]'
        });
        (exportBibTeX as ReturnType<typeof vi.fn>).mockResolvedValue(bibtex);

        // First access check (for references.bib) succeeds
        (fsPromises.access as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

        // User chooses to use existing file
        (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValue({
            label: 'Yes, use references.bib',
            value: 'use'
        });

        (fsPromises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('');
        (fsPromises.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        await commandHandler();

        expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ value: 'use' }),
                expect.objectContaining({ value: 'choose' }),
                expect.objectContaining({ value: 'cancel' })
            ]),
            expect.any(Object)
        );
    });

    it('should skip duplicate entries when adding to bib file', async () => {
        const existingBib = '@article{smith2024,\n  author = {Smith},\n  title = {Existing}\n}';
        const newBib = '@article{smith2024,\n  author = {Smith},\n  title = {New}\n}';

        mockEditor.document.getText.mockReturnValue('bibliography:./refs.bib');

        (isZoteroRunning as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        (openCitationPicker as ReturnType<typeof vi.fn>).mockResolvedValue({
            keys: ['smith2024'],
            raw: '[@smith2024]'
        });
        (exportBibTeX as ReturnType<typeof vi.fn>).mockResolvedValue(newBib);
        (fsPromises.access as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        (fsPromises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(existingBib);
        (fsPromises.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        await commandHandler();

        // Should show message indicating duplicate
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            expect.stringContaining('already existed')
        );
    });
});

describe('Citation key edge cases', () => {
    it('should handle keys with hyphens', () => {
        (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
            get: vi.fn().mockImplementation((key: string) => {
                if (key === 'citationSyntax') return 'org-ref-v3';
                if (key === 'defaultCiteStyle') return 'cite';
                return undefined;
            })
        });

        const result = formatOrgRefCitation(['smith-jones-2024']);
        expect(result).toBe('cite:&smith-jones-2024');
    });

    it('should handle keys with underscores', () => {
        (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
            get: vi.fn().mockImplementation((key: string) => {
                if (key === 'citationSyntax') return 'org-ref-v3';
                if (key === 'defaultCiteStyle') return 'cite';
                return undefined;
            })
        });

        const result = formatOrgRefCitation(['smith_jones_2024']);
        expect(result).toBe('cite:&smith_jones_2024');
    });

    it('should handle keys with colons', () => {
        (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
            get: vi.fn().mockImplementation((key: string) => {
                if (key === 'citationSyntax') return 'org-ref-v3';
                if (key === 'defaultCiteStyle') return 'cite';
                return undefined;
            })
        });

        const result = formatOrgRefCitation(['smith:2024']);
        expect(result).toBe('cite:&smith:2024');
    });
});

describe('appendBibTeXEntries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should add new entry to empty file', async () => {
        const bibtex = '@article{smith2024,\n  author = {Smith},\n  title = {Test}\n}';
        const existingKeys = new Set<string>();

        // File doesn't exist
        (fsPromises.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
            Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        );
        (fsPromises.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        const addedKeys = await appendBibTeXEntries('/path/to/refs.bib', bibtex, existingKeys);

        expect(addedKeys).toEqual(['smith2024']);
        expect(fsPromises.writeFile).toHaveBeenCalledWith(
            '/path/to/refs.bib',
            expect.stringContaining('@article{smith2024'),
            'utf8'
        );
    });

    it('should append entry to existing file', async () => {
        const existingBib = '@article{jones2023,\n  author = {Jones}\n}';
        const newBib = '@article{smith2024,\n  author = {Smith},\n  title = {Test}\n}';
        const existingKeys = new Set<string>();

        (fsPromises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(existingBib);
        (fsPromises.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        const addedKeys = await appendBibTeXEntries('/path/to/refs.bib', newBib, existingKeys);

        expect(addedKeys).toEqual(['smith2024']);
        expect(fsPromises.writeFile).toHaveBeenCalledWith(
            '/path/to/refs.bib',
            expect.stringContaining('@article{jones2023'),
            'utf8'
        );
        expect(fsPromises.writeFile).toHaveBeenCalledWith(
            '/path/to/refs.bib',
            expect.stringContaining('@article{smith2024'),
            'utf8'
        );
    });

    it('should skip duplicate entries', async () => {
        const bibtex = '@article{smith2024,\n  author = {Smith},\n  title = {Test}\n}';
        const existingKeys = new Set<string>(['smith2024']);

        const addedKeys = await appendBibTeXEntries('/path/to/refs.bib', bibtex, existingKeys);

        expect(addedKeys).toEqual([]);
        expect(fsPromises.writeFile).not.toHaveBeenCalled();
    });

    it('should add only non-duplicate entries from multiple', async () => {
        const bibtex = `@article{smith2024,
  author = {Smith}
}

@book{jones2023,
  author = {Jones}
}`;
        const existingKeys = new Set<string>(['jones2023']);

        (fsPromises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('');
        (fsPromises.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        const addedKeys = await appendBibTeXEntries('/path/to/refs.bib', bibtex, existingKeys);

        expect(addedKeys).toEqual(['smith2024']);
    });

    it('should throw on non-ENOENT read errors', async () => {
        const bibtex = '@article{smith2024,\n  author = {Smith}\n}';
        const existingKeys = new Set<string>();

        (fsPromises.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
            Object.assign(new Error('Permission denied'), { code: 'EACCES' })
        );

        await expect(appendBibTeXEntries('/path/to/refs.bib', bibtex, existingKeys))
            .rejects.toThrow('Permission denied');
    });

    it('should throw on write errors', async () => {
        const bibtex = '@article{smith2024,\n  author = {Smith}\n}';
        const existingKeys = new Set<string>();

        (fsPromises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('');
        (fsPromises.writeFile as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('Disk full')
        );

        await expect(appendBibTeXEntries('/path/to/refs.bib', bibtex, existingKeys))
            .rejects.toThrow('Failed to write bibliography file: Disk full');
    });

    it('should handle entries with nested braces', async () => {
        const bibtex = '@article{smith2024,\n  author = {Smith, {John}},\n  title = {{Title with {nested} braces}}\n}';
        const existingKeys = new Set<string>();

        (fsPromises.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
            Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        );
        (fsPromises.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        const addedKeys = await appendBibTeXEntries('/path/to/refs.bib', bibtex, existingKeys);

        expect(addedKeys).toEqual(['smith2024']);
        // Verify the full entry is preserved
        const writeCall = (fsPromises.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(writeCall[1]).toContain('{Title with {nested} braces}');
    });
});

describe('findCitationAtCursor', () => {
    describe('v3 syntax (org-ref v3)', () => {
        it('should detect cursor at end of single-key v3 citation', () => {
            const line = 'Some text cite:&smith2024 more text';
            const cursorColumn = 25; // right after 'cite:&smith2024'
            const result = findCitationAtCursor(line, cursorColumn);

            expect(result).not.toBeNull();
            expect(result?.style).toBe('cite');
            expect(result?.isV3).toBe(true);
            expect(result?.existingKeys).toEqual(['smith2024']);
        });

        it('should detect cursor at end of multi-key v3 citation', () => {
            const line = 'cite:&smith2024;&jones2023;&doe2022';
            const cursorColumn = 35;
            const result = findCitationAtCursor(line, cursorColumn);

            expect(result).not.toBeNull();
            expect(result?.style).toBe('cite');
            expect(result?.isV3).toBe(true);
            expect(result?.existingKeys).toEqual(['smith2024', 'jones2023', 'doe2022']);
        });

        it('should detect citep v3 style', () => {
            const line = 'citep:&author2024';
            const cursorColumn = 17;
            const result = findCitationAtCursor(line, cursorColumn);

            expect(result).not.toBeNull();
            expect(result?.style).toBe('citep');
            expect(result?.isV3).toBe(true);
        });

        it('should detect citet v3 style', () => {
            const line = 'citet:&author2024';
            const cursorColumn = 17;
            const result = findCitationAtCursor(line, cursorColumn);

            expect(result).not.toBeNull();
            expect(result?.style).toBe('citet');
            expect(result?.isV3).toBe(true);
        });
    });

    describe('v2 syntax (org-ref v2)', () => {
        it('should detect cursor at end of single-key v2 citation', () => {
            const line = 'Some text cite:smith2024 more text';
            const cursorColumn = 24; // right after 'cite:smith2024'
            const result = findCitationAtCursor(line, cursorColumn);

            expect(result).not.toBeNull();
            expect(result?.style).toBe('cite');
            expect(result?.isV3).toBe(false);
            expect(result?.existingKeys).toEqual(['smith2024']);
        });

        it('should detect cursor at end of multi-key v2 citation', () => {
            const line = 'cite:smith2024,jones2023,doe2022';
            const cursorColumn = 32;
            const result = findCitationAtCursor(line, cursorColumn);

            expect(result).not.toBeNull();
            expect(result?.style).toBe('cite');
            expect(result?.isV3).toBe(false);
            expect(result?.existingKeys).toEqual(['smith2024', 'jones2023', 'doe2022']);
        });

        it('should detect citep v2 style', () => {
            const line = 'citep:author2024';
            const cursorColumn = 16;
            const result = findCitationAtCursor(line, cursorColumn);

            expect(result).not.toBeNull();
            expect(result?.style).toBe('citep');
            expect(result?.isV3).toBe(false);
        });
    });

    describe('cursor not at citation end', () => {
        it('should return null when cursor is before citation', () => {
            const line = 'Some text cite:&smith2024 more text';
            const cursorColumn = 5; // in the middle of "Some text"
            const result = findCitationAtCursor(line, cursorColumn);

            expect(result).toBeNull();
        });

        it('should return null when cursor is after citation with space', () => {
            const line = 'cite:&smith2024 more text';
            const cursorColumn = 16; // after the space
            const result = findCitationAtCursor(line, cursorColumn);

            expect(result).toBeNull();
        });

        it('should return null when cursor is in middle of citation', () => {
            const line = 'cite:&smith2024;&jones2023';
            const cursorColumn = 15; // in the middle
            const result = findCitationAtCursor(line, cursorColumn);

            expect(result).toBeNull();
        });

        it('should return null for empty line', () => {
            const result = findCitationAtCursor('', 0);
            expect(result).toBeNull();
        });

        it('should return null for line without citation', () => {
            const line = 'Just some regular text without citations';
            const result = findCitationAtCursor(line, line.length);
            expect(result).toBeNull();
        });
    });

    describe('edge cases', () => {
        it('should handle keys with special characters', () => {
            const line = 'cite:&smith-jones_2024';
            const cursorColumn = 22;
            const result = findCitationAtCursor(line, cursorColumn);

            expect(result).not.toBeNull();
            expect(result?.existingKeys).toEqual(['smith-jones_2024']);
        });

        it('should handle keys with colons', () => {
            const line = 'cite:&prefix:key2024';
            const cursorColumn = 20;
            const result = findCitationAtCursor(line, cursorColumn);

            expect(result).not.toBeNull();
            expect(result?.existingKeys).toEqual(['prefix:key2024']);
        });

        it('should handle multiple citations on same line', () => {
            const line = 'cite:&first2024 and cite:&second2024';
            // Cursor at end of second citation
            const cursorColumn = 36;
            const result = findCitationAtCursor(line, cursorColumn);

            expect(result).not.toBeNull();
            expect(result?.existingKeys).toEqual(['second2024']);
        });

        it('should detect citation at very end of line', () => {
            const line = 'cite:&endkey2024';
            const cursorColumn = 16;
            const result = findCitationAtCursor(line, cursorColumn);

            expect(result).not.toBeNull();
            expect(result?.existingKeys).toEqual(['endkey2024']);
        });
    });
});

describe('formatKeysForAppend', () => {
    // Helper to create CitationAtCursor objects for testing
    const makeOrgV3Citation = (): Parameters<typeof formatKeysForAppend>[1] => ({
        format: 'org-v3', style: 'cite', isV3: true, startColumn: 0, endColumn: 10, existingKeys: []
    });
    const makeOrgV2Citation = (): Parameters<typeof formatKeysForAppend>[1] => ({
        format: 'org-v2', style: 'cite', isV3: false, startColumn: 0, endColumn: 10, existingKeys: []
    });
    const makeLatexCitation = (): Parameters<typeof formatKeysForAppend>[1] => ({
        format: 'latex', style: 'cite', isV3: false, startColumn: 0, endColumn: 10, existingKeys: []
    });
    const makeMarkdownCitation = (): Parameters<typeof formatKeysForAppend>[1] => ({
        format: 'markdown', style: 'pandoc', isV3: false, startColumn: 0, endColumn: 10, existingKeys: []
    });

    describe('org-mode v3 syntax', () => {
        it('should format single key for v3 append', () => {
            const result = formatKeysForAppend(['newkey2024'], makeOrgV3Citation());
            expect(result).toBe(';&newkey2024');
        });

        it('should format multiple keys for v3 append', () => {
            const result = formatKeysForAppend(['key1', 'key2', 'key3'], makeOrgV3Citation());
            expect(result).toBe(';&key1;&key2;&key3');
        });
    });

    describe('org-mode v2 syntax', () => {
        it('should format single key for v2 append', () => {
            const result = formatKeysForAppend(['newkey2024'], makeOrgV2Citation());
            expect(result).toBe(',newkey2024');
        });

        it('should format multiple keys for v2 append', () => {
            const result = formatKeysForAppend(['key1', 'key2', 'key3'], makeOrgV2Citation());
            expect(result).toBe(',key1,key2,key3');
        });
    });

    describe('LaTeX syntax', () => {
        it('should format single key for LaTeX append', () => {
            const result = formatKeysForAppend(['newkey2024'], makeLatexCitation());
            expect(result).toBe(',newkey2024');
        });

        it('should format multiple keys for LaTeX append', () => {
            const result = formatKeysForAppend(['key1', 'key2'], makeLatexCitation());
            expect(result).toBe(',key1,key2');
        });
    });

    describe('Markdown syntax', () => {
        it('should format single key for Markdown append', () => {
            const result = formatKeysForAppend(['newkey2024'], makeMarkdownCitation());
            expect(result).toBe('; @newkey2024');
        });

        it('should format multiple keys for Markdown append', () => {
            const result = formatKeysForAppend(['key1', 'key2'], makeMarkdownCitation());
            expect(result).toBe('; @key1; @key2');
        });
    });

    describe('edge cases', () => {
        it('should handle empty keys array for v3', () => {
            const result = formatKeysForAppend([], makeOrgV3Citation());
            expect(result).toBe('');
        });

        it('should handle empty keys array for v2', () => {
            const result = formatKeysForAppend([], makeOrgV2Citation());
            expect(result).toBe('');
        });

        it('should handle keys with special characters', () => {
            const result = formatKeysForAppend(['smith-jones_2024'], makeOrgV3Citation());
            expect(result).toBe(';&smith-jones_2024');
        });
    });
});
