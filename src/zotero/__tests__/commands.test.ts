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
        withProgress: vi.fn().mockImplementation(async (_options, task) => task()),
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
    registerZoteroCommands
} from '../commands';
import * as vscode from 'vscode';
import * as fsPromises from 'fs/promises';
import { isZoteroRunning, openCitationPicker, exportBibTeX } from '../zoteroService';

describe('findDocumentBibliography', () => {
    const docPath = '/home/user/documents/paper.org';

    describe('bibliography: link syntax', () => {
        it('should find simple relative path', () => {
            const text = 'Some text\nbibliography:./refs.bib\nMore text';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe('/home/user/documents/refs.bib');
        });

        it('should find absolute path', () => {
            const text = 'bibliography:/absolute/path/refs.bib';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe('/absolute/path/refs.bib');
        });

        it('should expand tilde path', () => {
            const originalHome = process.env.HOME;
            process.env.HOME = '/home/testuser';

            const text = 'bibliography:~/Documents/refs.bib';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe('/home/testuser/Documents/refs.bib');

            process.env.HOME = originalHome;
        });

        it('should add .bib extension if missing', () => {
            const text = 'bibliography:./references';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe('/home/user/documents/references.bib');
        });

        it('should handle comma-separated paths (take first)', () => {
            const text = 'bibliography:./local.bib,~/global.bib';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe('/home/user/documents/local.bib');
        });

        it('should be case-insensitive', () => {
            const text = 'BIBLIOGRAPHY:./refs.bib';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe('/home/user/documents/refs.bib');
        });

        it('should handle path without leading ./', () => {
            const text = 'bibliography:refs.bib';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe('/home/user/documents/refs.bib');
        });
    });

    describe('#+BIBLIOGRAPHY: keyword syntax', () => {
        it('should find #+BIBLIOGRAPHY: keyword', () => {
            const text = '#+TITLE: Paper\n#+BIBLIOGRAPHY: ./references.bib\n* Introduction';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe('/home/user/documents/references.bib');
        });

        it('should handle absolute path in keyword', () => {
            const text = '#+BIBLIOGRAPHY: /absolute/refs.bib';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe('/absolute/refs.bib');
        });

        it('should prefer bibliography: link over #+BIBLIOGRAPHY:', () => {
            const text = 'bibliography:./first.bib\n#+BIBLIOGRAPHY: ./second.bib';
            const result = findDocumentBibliography(text, docPath);
            expect(result).toBe('/home/user/documents/first.bib');
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
                uri: { fsPath: '/home/user/test.org' },
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
        (fsPromises.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
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

        // Should write to the existing bib path
        expect(fsPromises.writeFile).toHaveBeenCalledWith(
            '/home/user/existing.bib',
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
