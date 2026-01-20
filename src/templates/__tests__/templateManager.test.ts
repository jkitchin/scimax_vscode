/**
 * Tests for the Template Manager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// Mock VS Code API
vi.mock('vscode', () => ({
    window: {
        activeTextEditor: {
            document: {
                fileName: '/test/project/document.org',
            },
            insertSnippet: vi.fn(),
        },
        showInputBox: vi.fn(),
        showQuickPick: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showOpenDialog: vi.fn(),
    },
    workspace: {
        getConfiguration: vi.fn(() => ({
            get: vi.fn((key: string, defaultValue?: unknown) => {
                const config: Record<string, unknown> = {
                    'directory': '/test/templates',
                    'defaultFormat': 'org',
                    'dateFormat': 'yyyy-MM-dd',
                    'timeFormat': 'HH:mm',
                    'author': 'Test Author',
                };
                return config[key] ?? defaultValue;
            }),
        })),
        workspaceFolders: [{ name: 'test-workspace', uri: { fsPath: '/test/workspace' } }],
        createFileSystemWatcher: vi.fn(() => ({
            onDidChange: vi.fn(),
            onDidCreate: vi.fn(),
            onDidDelete: vi.fn(),
            dispose: vi.fn(),
        })),
        openTextDocument: vi.fn(),
    },
    Uri: {
        file: vi.fn((p: string) => ({ fsPath: p })),
    },
    RelativePattern: vi.fn(),
    SnippetString: vi.fn((content: string) => ({ value: content })),
    commands: {
        executeCommand: vi.fn(),
    },
}));

// Mock fs module
vi.mock('fs', () => ({
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(),
    promises: {
        mkdir: vi.fn(),
        writeFile: vi.fn(),
    },
}));

// Import after mocking
import { TemplateManager, Template, TemplateFormat } from '../templateManager';

// Create a testable version that exposes private methods
class TestableTemplateManager extends TemplateManager {
    // Expose private methods for testing
    public testReplaceAutoFillVariables(content: string): string {
        return (this as any).replaceAutoFillVariables(content);
    }

    public testExtractNamedVariables(content: string): Array<{ name: string; defaultValue?: string }> {
        return (this as any).extractNamedVariables(content);
    }

    public testConvertToSnippet(content: string): string {
        return (this as any).convertToSnippet(content);
    }

    public testParseTemplateMetadata(content: string, ext: string): {
        name?: string;
        description?: string;
        format?: TemplateFormat;
        defaultFilename?: string;
        category?: string;
        content: string;
    } {
        return (this as any).parseTemplateMetadata(content, ext);
    }

    public testFormatTemplateName(baseName: string): string {
        return (this as any).formatTemplateName(baseName);
    }

    public testGetFormatFromDirName(dirName: string): TemplateFormat | undefined {
        return (this as any).getFormatFromDirName(dirName);
    }

    public testGetFormatFromExtension(ext: string): TemplateFormat {
        return (this as any).getFormatFromExtension(ext);
    }

    public testGenerateUUID(): string {
        return (this as any).generateUUID();
    }
}

describe('TemplateManager', () => {
    let manager: TestableTemplateManager;
    const mockContext = {
        subscriptions: [],
        globalStorageUri: { fsPath: '/test/storage' },
        globalState: {
            get: vi.fn(),
            update: vi.fn(),
        },
    } as any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset environment
        process.env.USER = 'testuser';
        process.env.HOME = '/home/testuser';
        manager = new TestableTemplateManager(mockContext);
    });

    describe('extractNamedVariables', () => {
        it('should extract simple named variables', () => {
            const content = 'Hello ${name}, welcome to ${project}!';
            const vars = manager.testExtractNamedVariables(content);

            expect(vars).toHaveLength(2);
            expect(vars[0]).toEqual({ name: 'name', defaultValue: undefined });
            expect(vars[1]).toEqual({ name: 'project', defaultValue: undefined });
        });

        it('should extract variables with default values', () => {
            const content = '${title:Untitled} by ${author:Anonymous}';
            const vars = manager.testExtractNamedVariables(content);

            expect(vars).toHaveLength(2);
            expect(vars[0]).toEqual({ name: 'title', defaultValue: 'Untitled' });
            expect(vars[1]).toEqual({ name: 'author', defaultValue: 'Anonymous' });
        });

        it('should not extract numeric tab stops', () => {
            const content = '${1:first} ${name} ${2:second} ${title}';
            const vars = manager.testExtractNamedVariables(content);

            expect(vars).toHaveLength(2);
            expect(vars.map(v => v.name)).toEqual(['name', 'title']);
        });

        it('should not duplicate variables', () => {
            const content = '${name} is ${name} and ${name} again';
            const vars = manager.testExtractNamedVariables(content);

            expect(vars).toHaveLength(1);
            expect(vars[0].name).toBe('name');
        });

        it('should handle underscores in variable names', () => {
            const content = '${my_variable} and ${another_var}';
            const vars = manager.testExtractNamedVariables(content);

            expect(vars).toHaveLength(2);
            expect(vars[0].name).toBe('my_variable');
            expect(vars[1].name).toBe('another_var');
        });

        it('should return empty array for content with no variables', () => {
            const content = 'Plain text with ${1:tab stops} only';
            const vars = manager.testExtractNamedVariables(content);

            expect(vars).toHaveLength(0);
        });
    });

    describe('convertToSnippet', () => {
        it('should preserve tab stops', () => {
            const content = '${1:first} ${2:second} $0';
            const result = manager.testConvertToSnippet(content);

            expect(result).toBe('${1:first} ${2:second} $0');
        });

        it('should escape standalone dollar signs', () => {
            // Note: $100 is NOT escaped because $1 is a valid tab stop in VS Code snippets
            // VS Code interprets $100 as: tab stop $1 followed by literal "00"
            // To get literal $100 in a template, use \$100
            const content = 'Price: $ABC and ${1:amount}';
            const result = manager.testConvertToSnippet(content);

            expect(result).toBe('Price: \\$ABC and ${1:amount}');
        });

        it('should not escape dollar followed by digit (valid tab stop)', () => {
            const content = '$100 means tab stop $1 followed by 00';
            const result = manager.testConvertToSnippet(content);

            // $1 is preserved as tab stop, $100 = $1 + "00"
            expect(result).toBe('$100 means tab stop $1 followed by 00');
        });

        it('should escape dollar signs in variable names', () => {
            const content = '$PATH is ${1:value}';
            const result = manager.testConvertToSnippet(content);

            expect(result).toBe('\\$PATH is ${1:value}');
        });

        it('should handle multiple dollar signs', () => {
            const content = '$$$ money ${1:amount} $$$';
            const result = manager.testConvertToSnippet(content);

            expect(result).toBe('\\$\\$\\$ money ${1:amount} \\$\\$\\$');
        });
    });

    describe('parseTemplateMetadata', () => {
        it('should parse org-mode metadata', () => {
            const content = `#+NAME: My Template
#+DESCRIPTION: A test template
#+CATEGORY: Test

* Heading
Content here`;
            const result = manager.testParseTemplateMetadata(content, '.org');

            expect(result.name).toBe('My Template');
            expect(result.description).toBe('A test template');
            expect(result.category).toBe('Test');
            expect(result.content).toBe('* Heading\nContent here');
        });

        it('should parse markdown metadata', () => {
            const content = `<!-- NAME: Markdown Template -->
<!-- DESCRIPTION: A markdown template -->

# Heading
Content`;
            const result = manager.testParseTemplateMetadata(content, '.md');

            expect(result.name).toBe('Markdown Template');
            expect(result.description).toBe('A markdown template');
            expect(result.content).toBe('# Heading\nContent');
        });

        it('should parse LaTeX metadata', () => {
            const content = `% NAME: LaTeX Template
% DESCRIPTION: A LaTeX template
% FILENAME: article

\\documentclass{article}`;
            const result = manager.testParseTemplateMetadata(content, '.tex');

            expect(result.name).toBe('LaTeX Template');
            expect(result.description).toBe('A LaTeX template');
            expect(result.defaultFilename).toBe('article');
            expect(result.content).toBe('\\documentclass{article}');
        });

        it('should use TITLE as fallback for NAME', () => {
            const content = `#+TITLE: Title Based Name

Content`;
            const result = manager.testParseTemplateMetadata(content, '.org');

            expect(result.name).toBe('Title Based Name');
        });

        it('should handle empty metadata', () => {
            const content = 'Just content, no metadata';
            const result = manager.testParseTemplateMetadata(content, '.org');

            expect(result.name).toBeUndefined();
            expect(result.content).toBe('Just content, no metadata');
        });
    });

    describe('formatTemplateName', () => {
        it('should convert hyphens to spaces and capitalize', () => {
            expect(manager.testFormatTemplateName('my-template')).toBe('My Template');
        });

        it('should convert underscores to spaces and capitalize', () => {
            expect(manager.testFormatTemplateName('my_template')).toBe('My Template');
        });

        it('should handle mixed separators', () => {
            expect(manager.testFormatTemplateName('my-cool_template')).toBe('My Cool Template');
        });

        it('should capitalize single words', () => {
            expect(manager.testFormatTemplateName('template')).toBe('Template');
        });
    });

    describe('getFormatFromDirName', () => {
        it('should recognize org directories', () => {
            expect(manager.testGetFormatFromDirName('org')).toBe('org');
            expect(manager.testGetFormatFromDirName('ORG')).toBe('org');
            expect(manager.testGetFormatFromDirName('org-mode')).toBe('org');
        });

        it('should recognize markdown directories', () => {
            expect(manager.testGetFormatFromDirName('markdown')).toBe('markdown');
            expect(manager.testGetFormatFromDirName('md')).toBe('markdown');
            expect(manager.testGetFormatFromDirName('MD')).toBe('markdown');
        });

        it('should recognize latex directories', () => {
            expect(manager.testGetFormatFromDirName('latex')).toBe('latex');
            expect(manager.testGetFormatFromDirName('tex')).toBe('latex');
            expect(manager.testGetFormatFromDirName('TEX')).toBe('latex');
        });

        it('should return undefined for unknown directories', () => {
            expect(manager.testGetFormatFromDirName('unknown')).toBeUndefined();
            expect(manager.testGetFormatFromDirName('documents')).toBeUndefined();
        });
    });

    describe('getFormatFromExtension', () => {
        it('should recognize org extensions', () => {
            expect(manager.testGetFormatFromExtension('.org')).toBe('org');
            expect(manager.testGetFormatFromExtension('.ORG')).toBe('org');
        });

        it('should recognize markdown extensions', () => {
            expect(manager.testGetFormatFromExtension('.md')).toBe('markdown');
            expect(manager.testGetFormatFromExtension('.markdown')).toBe('markdown');
        });

        it('should recognize latex extensions', () => {
            expect(manager.testGetFormatFromExtension('.tex')).toBe('latex');
            expect(manager.testGetFormatFromExtension('.latex')).toBe('latex');
        });

        it('should return default format for unknown extensions', () => {
            // Default is 'org' based on mock config
            expect(manager.testGetFormatFromExtension('.txt')).toBe('org');
            expect(manager.testGetFormatFromExtension('.unknown')).toBe('org');
        });
    });

    describe('generateUUID', () => {
        it('should generate valid UUID format', () => {
            const uuid = manager.testGenerateUUID();
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

            expect(uuid).toMatch(uuidPattern);
        });

        it('should generate unique UUIDs', () => {
            const uuid1 = manager.testGenerateUUID();
            const uuid2 = manager.testGenerateUUID();
            const uuid3 = manager.testGenerateUUID();

            expect(uuid1).not.toBe(uuid2);
            expect(uuid2).not.toBe(uuid3);
            expect(uuid1).not.toBe(uuid3);
        });
    });

    describe('replaceAutoFillVariables', () => {
        it('should replace {{author}} variable', () => {
            const content = 'Author: {{author}}';
            const result = manager.testReplaceAutoFillVariables(content);

            expect(result).toBe('Author: Test Author');
        });

        it('should replace {{user}} variable', () => {
            const content = 'User: {{user}}';
            const result = manager.testReplaceAutoFillVariables(content);

            expect(result).toBe('User: testuser');
        });

        it('should replace date-related variables', () => {
            const content = '{{year}}-{{month}}-{{day}}';
            const result = manager.testReplaceAutoFillVariables(content);

            // Check format is correct (4 digit year, 2 digit month, 2 digit day)
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it('should replace {{filename}} variable', () => {
            const content = 'File: {{filename}}';
            const result = manager.testReplaceAutoFillVariables(content);

            expect(result).toBe('File: document');
        });

        it('should replace {{workspace}} variable', () => {
            const content = 'Workspace: {{workspace}}';
            const result = manager.testReplaceAutoFillVariables(content);

            expect(result).toBe('Workspace: test-workspace');
        });

        it('should handle case-insensitive variable names', () => {
            const content = '{{DATE}} {{Date}} {{date}}';
            const result = manager.testReplaceAutoFillVariables(content);

            // All should be replaced with the same date
            const parts = result.split(' ');
            expect(parts[0]).toBe(parts[1]);
            expect(parts[1]).toBe(parts[2]);
        });

        it('should preserve unknown variables', () => {
            const content = '{{unknown}} stays as is';
            const result = manager.testReplaceAutoFillVariables(content);

            expect(result).toBe('{{unknown}} stays as is');
        });

        it('should replace {{uuid}} with unique value', () => {
            const content = '{{uuid}}';
            const result = manager.testReplaceAutoFillVariables(content);

            expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        });

        it('should replace multiple variables in same content', () => {
            const content = '{{author}} created {{filename}} on {{date}}';
            const result = manager.testReplaceAutoFillVariables(content);

            expect(result).toContain('Test Author');
            expect(result).toContain('document');
            expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
        });
    });

    describe('getAvailableTemplates', () => {
        it('should return built-in templates', () => {
            const templates = manager.getAvailableTemplates();

            expect(templates.length).toBeGreaterThan(0);
            expect(templates.some(t => t.builtIn)).toBe(true);
        });

        it('should filter by format', () => {
            const orgTemplates = manager.getAvailableTemplates('org');
            const mdTemplates = manager.getAvailableTemplates('markdown');
            const latexTemplates = manager.getAvailableTemplates('latex');

            expect(orgTemplates.every(t => t.format === 'org')).toBe(true);
            expect(mdTemplates.every(t => t.format === 'markdown')).toBe(true);
            expect(latexTemplates.every(t => t.format === 'latex')).toBe(true);
        });

        it('should include org article template', () => {
            const templates = manager.getAvailableTemplates('org');
            const article = templates.find(t => t.id === 'org:article');

            expect(article).toBeDefined();
            expect(article?.name).toBe('Article');
            expect(article?.category).toBe('Documents');
        });

        it('should include markdown readme template', () => {
            const templates = manager.getAvailableTemplates('markdown');
            const readme = templates.find(t => t.id === 'md:readme');

            expect(readme).toBeDefined();
            expect(readme?.name).toBe('README');
        });

        it('should include latex beamer template', () => {
            const templates = manager.getAvailableTemplates('latex');
            const beamer = templates.find(t => t.id === 'latex:beamer');

            expect(beamer).toBeDefined();
            expect(beamer?.name).toBe('Beamer Presentation');
        });
    });

    describe('getTemplate', () => {
        it('should return built-in template by ID', () => {
            const template = manager.getTemplate('org:article');

            expect(template).toBeDefined();
            expect(template?.id).toBe('org:article');
            expect(template?.builtIn).toBe(true);
        });

        it('should return undefined for unknown ID', () => {
            const template = manager.getTemplate('unknown:template');

            expect(template).toBeUndefined();
        });
    });

    describe('Built-in Templates', () => {
        it('should have templates for all formats', () => {
            const orgTemplates = manager.getAvailableTemplates('org');
            const mdTemplates = manager.getAvailableTemplates('markdown');
            const latexTemplates = manager.getAvailableTemplates('latex');

            expect(orgTemplates.length).toBeGreaterThan(0);
            expect(mdTemplates.length).toBeGreaterThan(0);
            expect(latexTemplates.length).toBeGreaterThan(0);
        });

        it('org article should have proper structure', () => {
            const article = manager.getTemplate('org:article');

            expect(article?.content).toContain('#+TITLE:');
            expect(article?.content).toContain('#+AUTHOR:');
            expect(article?.content).toContain('{{author}}');
            expect(article?.content).toContain('${1:');
        });

        it('markdown readme should have proper structure', () => {
            const readme = manager.getTemplate('md:readme');

            expect(readme?.content).toContain('# ${1:');
            expect(readme?.content).toContain('## Installation');
            expect(readme?.content).toContain('## Usage');
        });

        it('latex article should have proper structure', () => {
            const article = manager.getTemplate('latex:article');

            expect(article?.content).toContain('\\documentclass');
            expect(article?.content).toContain('\\begin{document}');
            expect(article?.content).toContain('\\end{document}');
        });

        it('templates should have required fields', () => {
            const templates = manager.getAvailableTemplates();

            for (const template of templates) {
                expect(template.id).toBeTruthy();
                expect(template.name).toBeTruthy();
                expect(template.description).toBeTruthy();
                expect(template.format).toMatch(/^(org|markdown|latex)$/);
                expect(template.content).toBeTruthy();
                expect(typeof template.builtIn).toBe('boolean');
            }
        });
    });
});

describe('Template Processing Integration', () => {
    let manager: TestableTemplateManager;
    const mockContext = {
        subscriptions: [],
        globalStorageUri: { fsPath: '/test/storage' },
        globalState: {
            get: vi.fn(),
            update: vi.fn(),
        },
    } as any;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.USER = 'testuser';
        manager = new TestableTemplateManager(mockContext);
    });

    it('should process template with all variable types', () => {
        // This tests the interaction between different variable processing
        const content = '{{author}} wrote ${title:My Title} with ${1:tab stop}';

        // Replace auto-fill variables
        const afterAutoFill = manager.testReplaceAutoFillVariables(content);
        expect(afterAutoFill).toContain('Test Author');
        expect(afterAutoFill).toContain('${title:My Title}');

        // Extract named variables
        const namedVars = manager.testExtractNamedVariables(afterAutoFill);
        expect(namedVars).toHaveLength(1);
        expect(namedVars[0].name).toBe('title');

        // Convert to snippet
        const snippet = manager.testConvertToSnippet(afterAutoFill);
        expect(snippet).toContain('${1:tab stop}');
    });
});
