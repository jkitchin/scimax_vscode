/**
 * Tests for Custom Exporter System
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Import the module under test
import {
    compileTemplate,
    renderTemplate,
    extractCustomKeywords,
    ExporterRegistry,
    getDefaultExporterPaths,
    initializeExporterRegistry,
    EXAMPLE_CMU_MEMO_MANIFEST,
    EXAMPLE_CMU_MEMO_TEMPLATE,
    TemplateContext,
    KeywordDefinition,
    ExporterManifest,
} from '../customExporter';

describe('Custom Exporter Template Engine', () => {
    describe('compileTemplate', () => {
        it('should compile a simple template', () => {
            const template = compileTemplate('Hello {{name}}!');
            expect(template).toBeDefined();
            expect(typeof template).toBe('function');
        });

        it('should compile template with conditionals', () => {
            const template = compileTemplate('{{#if show}}Visible{{/if}}');
            expect(template).toBeDefined();
        });

        it('should compile template with each loops', () => {
            const template = compileTemplate('{{#each items}}{{this}}{{/each}}');
            expect(template).toBeDefined();
        });
    });

    describe('renderTemplate', () => {
        it('should render simple variable substitution', () => {
            const template = compileTemplate('Hello {{name}}!');
            const context: TemplateContext = {
                title: '',
                author: '',
                date: '',
                language: 'en',
                body: '',
                name: 'World',
            };
            const result = renderTemplate(template, context);
            expect(result).toBe('Hello World!');
        });

        it('should render multiple variables', () => {
            const template = compileTemplate('{{title}} by {{author}}');
            const context: TemplateContext = {
                title: 'My Document',
                author: 'John Doe',
                date: '2024-01-01',
                language: 'en',
                body: '',
            };
            const result = renderTemplate(template, context);
            expect(result).toBe('My Document by John Doe');
        });

        it('should render conditionals with truthy values', () => {
            const template = compileTemplate('{{#if showIntro}}Introduction{{/if}}');
            const context: TemplateContext = {
                title: '',
                author: '',
                date: '',
                language: 'en',
                body: '',
                showIntro: true,
            };
            const result = renderTemplate(template, context);
            expect(result).toBe('Introduction');
        });

        it('should not render conditionals with falsy values', () => {
            const template = compileTemplate('{{#if showIntro}}Introduction{{/if}}');
            const context: TemplateContext = {
                title: '',
                author: '',
                date: '',
                language: 'en',
                body: '',
                showIntro: false,
            };
            const result = renderTemplate(template, context);
            expect(result).toBe('');
        });

        it('should render else branch when condition is falsy', () => {
            const template = compileTemplate('{{#if premium}}Pro{{else}}Free{{/if}}');
            const context: TemplateContext = {
                title: '',
                author: '',
                date: '',
                language: 'en',
                body: '',
                premium: false,
            };
            const result = renderTemplate(template, context);
            expect(result).toBe('Free');
        });

        it('should render each loops', () => {
            const template = compileTemplate('{{#each items}}[{{this}}]{{/each}}');
            const context: TemplateContext = {
                title: '',
                author: '',
                date: '',
                language: 'en',
                body: '',
                items: ['a', 'b', 'c'],
            };
            const result = renderTemplate(template, context);
            expect(result).toBe('[a][b][c]');
        });

        it('should render raw body content with triple braces', () => {
            const template = compileTemplate('{{{body}}}');
            const context: TemplateContext = {
                title: '',
                author: '',
                date: '',
                language: 'en',
                body: '<div>HTML content</div>',
            };
            const result = renderTemplate(template, context);
            expect(result).toBe('<div>HTML content</div>');
        });

        it('should handle missing variables gracefully', () => {
            const template = compileTemplate('Value: {{missing}}');
            const context: TemplateContext = {
                title: '',
                author: '',
                date: '',
                language: 'en',
                body: '',
            };
            const result = renderTemplate(template, context);
            // Handlebars returns empty string for missing variables by default
            expect(result).toBe('Value: ');
        });
    });

    describe('Handlebars Helpers', () => {
        describe('default helper', () => {
            it('should return value when present', () => {
                const template = compileTemplate('{{default name "Anonymous"}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                    name: 'John',
                };
                const result = renderTemplate(template, context);
                expect(result).toBe('John');
            });

            it('should return default when value is missing', () => {
                const template = compileTemplate('{{default name "Anonymous"}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                };
                const result = renderTemplate(template, context);
                expect(result).toBe('Anonymous');
            });

            it('should return default when value is empty string', () => {
                const template = compileTemplate('{{default name "Anonymous"}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                    name: '',
                };
                const result = renderTemplate(template, context);
                expect(result).toBe('Anonymous');
            });
        });

        describe('required helper', () => {
            it('should return value when present', () => {
                const template = compileTemplate('{{required name "name"}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                    name: 'John',
                };
                const result = renderTemplate(template, context);
                expect(result).toBe('John');
            });

            it('should return NOT FOUND placeholder when missing', () => {
                const template = compileTemplate('{{required name "name"}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                };
                const result = renderTemplate(template, context);
                expect(result).toBe('[NOT FOUND: name]');
            });
        });

        describe('join helper', () => {
            it('should join array with separator', () => {
                const template = compileTemplate('{{join items ", "}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                    items: ['apple', 'banana', 'cherry'],
                };
                const result = renderTemplate(template, context);
                expect(result).toBe('apple, banana, cherry');
            });

            it('should return empty string for non-array', () => {
                const template = compileTemplate('{{join notArray ", "}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                    notArray: 'string',
                };
                const result = renderTemplate(template, context);
                expect(result).toBe('');
            });
        });

        describe('ifeq helper', () => {
            it('should render content when values are equal', () => {
                const template = compileTemplate('{{#ifeq status "active"}}Active{{/ifeq}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                    status: 'active',
                };
                const result = renderTemplate(template, context);
                expect(result).toBe('Active');
            });

            it('should not render content when values differ', () => {
                const template = compileTemplate('{{#ifeq status "active"}}Active{{/ifeq}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                    status: 'inactive',
                };
                const result = renderTemplate(template, context);
                expect(result).toBe('');
            });
        });

        describe('upper/lower helpers', () => {
            it('should convert to uppercase', () => {
                const template = compileTemplate('{{upper name}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                    name: 'hello',
                };
                const result = renderTemplate(template, context);
                expect(result).toBe('HELLO');
            });

            it('should convert to lowercase', () => {
                const template = compileTemplate('{{lower name}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                    name: 'HELLO',
                };
                const result = renderTemplate(template, context);
                expect(result).toBe('hello');
            });
        });

        describe('today/year helpers', () => {
            it('should return current date in ISO format', () => {
                const template = compileTemplate('{{today}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                };
                const result = renderTemplate(template, context);
                expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            });

            it('should return current year', () => {
                const template = compileTemplate('{{year}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                };
                const result = renderTemplate(template, context);
                expect(result).toBe(String(new Date().getFullYear()));
            });
        });

        describe('latex helper', () => {
            it('should escape special LaTeX characters', () => {
                const template = compileTemplate('{{latex text}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                    text: 'Price: $100 & 50%',
                };
                const result = renderTemplate(template, context);
                expect(result).toContain('\\$');
                expect(result).toContain('\\&');
                expect(result).toContain('\\%');
            });
        });

        describe('html helper', () => {
            it('should escape HTML special characters', () => {
                const template = compileTemplate('{{html text}}');
                const context: TemplateContext = {
                    title: '',
                    author: '',
                    date: '',
                    language: 'en',
                    body: '',
                    text: '<script>alert("xss")</script>',
                };
                const result = renderTemplate(template, context);
                expect(result).toContain('&lt;');
                expect(result).toContain('&gt;');
                expect(result).toContain('&quot;');
            });
        });
    });
});

describe('extractCustomKeywords', () => {
    // Create a minimal mock document
    function createMockDoc(keywords: Record<string, string> = {}): any {
        return {
            type: 'org-data',
            keywords,
            children: [],
        };
    }

    it('should extract keyword with value', () => {
        const doc = createMockDoc({ DEPARTMENT: 'Chemical Engineering' });
        const defs: Record<string, KeywordDefinition> = {
            department: { description: 'Department name' },
        };
        const result = extractCustomKeywords(doc, defs);
        expect(result.department).toBe('Chemical Engineering');
    });

    it('should use default value when keyword is missing', () => {
        const doc = createMockDoc({});
        const defs: Record<string, KeywordDefinition> = {
            department: { default: 'Default Department' },
        };
        const result = extractCustomKeywords(doc, defs);
        expect(result.department).toBe('Default Department');
    });

    it('should mark required missing fields with NOT FOUND', () => {
        const doc = createMockDoc({});
        const defs: Record<string, KeywordDefinition> = {
            recipient: { required: true },
        };
        const result = extractCustomKeywords(doc, defs);
        expect(result.recipient).toBe('[NOT FOUND: recipient]');
    });

    it('should parse boolean type', () => {
        const doc = createMockDoc({ SIGNATURE: 'true' });
        const defs: Record<string, KeywordDefinition> = {
            signature: { type: 'boolean' },
        };
        const result = extractCustomKeywords(doc, defs);
        expect(result.signature).toBe(true);
    });

    it('should parse boolean type with "yes"', () => {
        const doc = createMockDoc({ SIGNATURE: 'yes' });
        const defs: Record<string, KeywordDefinition> = {
            signature: { type: 'boolean' },
        };
        const result = extractCustomKeywords(doc, defs);
        expect(result.signature).toBe(true);
    });

    it('should parse boolean type with "t"', () => {
        const doc = createMockDoc({ SIGNATURE: 't' });
        const defs: Record<string, KeywordDefinition> = {
            signature: { type: 'boolean' },
        };
        const result = extractCustomKeywords(doc, defs);
        expect(result.signature).toBe(true);
    });

    it('should parse number type', () => {
        const doc = createMockDoc({ COUNT: '42' });
        const defs: Record<string, KeywordDefinition> = {
            count: { type: 'number' },
        };
        const result = extractCustomKeywords(doc, defs);
        expect(result.count).toBe(42);
    });

    it('should return 0 for invalid number', () => {
        const doc = createMockDoc({ COUNT: 'not-a-number' });
        const defs: Record<string, KeywordDefinition> = {
            count: { type: 'number' },
        };
        const result = extractCustomKeywords(doc, defs);
        expect(result.count).toBe(0);
    });

    it('should handle case-insensitive keyword lookup', () => {
        const doc = createMockDoc({ MYKEY: 'value' });
        const defs: Record<string, KeywordDefinition> = {
            mykey: { description: 'Test' },
        };
        const result = extractCustomKeywords(doc, defs);
        expect(result.mykey).toBe('value');
    });

    it('should extract multiple keywords', () => {
        const doc = createMockDoc({
            TO: 'Recipient',
            FROM: 'Sender',
            SUBJECT: 'Test Subject',
        });
        const defs: Record<string, KeywordDefinition> = {
            to: { required: true },
            from: { required: true },
            subject: { required: true },
        };
        const result = extractCustomKeywords(doc, defs);
        expect(result.to).toBe('Recipient');
        expect(result.from).toBe('Sender');
        expect(result.subject).toBe('Test Subject');
    });
});

describe('getDefaultExporterPaths', () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalXdgConfig = process.env.XDG_CONFIG_HOME;

    afterEach(() => {
        process.env.HOME = originalHome;
        process.env.USERPROFILE = originalUserProfile;
        process.env.XDG_CONFIG_HOME = originalXdgConfig;
    });

    it('should include ~/.scimax/exporters when HOME is set', () => {
        process.env.HOME = '/home/testuser';
        delete process.env.USERPROFILE;
        delete process.env.XDG_CONFIG_HOME;

        const paths = getDefaultExporterPaths();
        // Use path.join for cross-platform compatibility
        const expectedPath = path.join('/home/testuser', '.scimax', 'exporters');
        expect(paths).toContain(expectedPath);
    });

    it('should include XDG config path when set', () => {
        process.env.HOME = '/home/testuser';
        process.env.XDG_CONFIG_HOME = '/home/testuser/.config';

        const paths = getDefaultExporterPaths();
        // Use path.join for cross-platform compatibility
        const expectedPath = path.join('/home/testuser/.config', 'scimax', 'exporters');
        expect(paths).toContain(expectedPath);
    });

    it('should use USERPROFILE on Windows', () => {
        delete process.env.HOME;
        process.env.USERPROFILE = 'C:\\Users\\testuser';
        delete process.env.XDG_CONFIG_HOME;

        const paths = getDefaultExporterPaths();
        expect(paths.some(p => p.includes('testuser'))).toBe(true);
    });
});

describe('ExporterRegistry', () => {
    let tempDir: string;

    beforeEach(async () => {
        // Create a temporary directory for test exporters
        tempDir = path.join(os.tmpdir(), `scimax-test-${Date.now()}`);
        await fs.promises.mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
        // Clean up temporary directory
        try {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
        // Clear the singleton
        ExporterRegistry.getInstance().clear();
    });

    it('should be a singleton', () => {
        const registry1 = ExporterRegistry.getInstance();
        const registry2 = ExporterRegistry.getInstance();
        expect(registry1).toBe(registry2);
    });

    it('should load exporter from directory', async () => {
        // Create a test exporter
        const exporterDir = path.join(tempDir, 'test-exporter');
        await fs.promises.mkdir(exporterDir);

        const manifest: ExporterManifest = {
            id: 'test-exporter',
            name: 'Test Exporter',
            parent: 'latex',
            outputFormat: 'tex',
            template: 'template.tex',
        };

        await fs.promises.writeFile(
            path.join(exporterDir, 'manifest.json'),
            JSON.stringify(manifest)
        );
        await fs.promises.writeFile(
            path.join(exporterDir, 'template.tex'),
            '\\documentclass{article}\n{{body}}'
        );

        const registry = ExporterRegistry.getInstance();
        await registry.loadFromDirectory(tempDir);

        expect(registry.has('test-exporter')).toBe(true);
        const exporter = registry.get('test-exporter');
        expect(exporter?.name).toBe('Test Exporter');
    });

    it('should handle missing directory gracefully', async () => {
        const registry = ExporterRegistry.getInstance();
        await registry.loadFromDirectory('/nonexistent/path');
        // Should not throw
        expect(registry.getAll()).toHaveLength(0);
    });

    it('should skip invalid exporters without crashing', async () => {
        // Create an invalid exporter (missing template)
        const exporterDir = path.join(tempDir, 'invalid-exporter');
        await fs.promises.mkdir(exporterDir);

        await fs.promises.writeFile(
            path.join(exporterDir, 'manifest.json'),
            JSON.stringify({
                id: 'invalid',
                name: 'Invalid',
                parent: 'latex',
                outputFormat: 'tex',
                template: 'missing.tex',
            })
        );

        const registry = ExporterRegistry.getInstance();
        await registry.loadFromDirectory(tempDir);

        // Should not have loaded the invalid exporter
        expect(registry.has('invalid')).toBe(false);
    });

    it('should clear all exporters', async () => {
        const exporterDir = path.join(tempDir, 'test-exporter');
        await fs.promises.mkdir(exporterDir);

        await fs.promises.writeFile(
            path.join(exporterDir, 'manifest.json'),
            JSON.stringify({
                id: 'test',
                name: 'Test',
                parent: 'latex',
                outputFormat: 'tex',
                template: 'template.tex',
            })
        );
        await fs.promises.writeFile(
            path.join(exporterDir, 'template.tex'),
            '{{body}}'
        );

        const registry = ExporterRegistry.getInstance();
        await registry.loadFromDirectory(tempDir);
        expect(registry.getAll().length).toBeGreaterThan(0);

        registry.clear();
        expect(registry.getAll()).toHaveLength(0);
    });
});

describe('Example Templates', () => {
    it('should have valid CMU Memo manifest', () => {
        expect(EXAMPLE_CMU_MEMO_MANIFEST.id).toBe('cmu-memo');
        expect(EXAMPLE_CMU_MEMO_MANIFEST.parent).toBe('latex');
        expect(EXAMPLE_CMU_MEMO_MANIFEST.outputFormat).toBe('pdf');
        expect(EXAMPLE_CMU_MEMO_MANIFEST.keywords).toBeDefined();
        expect(EXAMPLE_CMU_MEMO_MANIFEST.keywords?.to?.required).toBe(true);
        expect(EXAMPLE_CMU_MEMO_MANIFEST.keywords?.from?.required).toBe(true);
        expect(EXAMPLE_CMU_MEMO_MANIFEST.keywords?.department?.default).toBeDefined();
    });

    it('should have valid CMU Memo template', () => {
        expect(EXAMPLE_CMU_MEMO_TEMPLATE).toContain('\\documentclass');
        expect(EXAMPLE_CMU_MEMO_TEMPLATE).toContain('{{department}}');
        expect(EXAMPLE_CMU_MEMO_TEMPLATE).toContain('{{to}}');
        expect(EXAMPLE_CMU_MEMO_TEMPLATE).toContain('{{from}}');
        expect(EXAMPLE_CMU_MEMO_TEMPLATE).toContain('{{{body}}}');
        expect(EXAMPLE_CMU_MEMO_TEMPLATE).toContain('{{#if signatureLines}}');
    });

    it('should compile CMU Memo template without errors', () => {
        const template = compileTemplate(EXAMPLE_CMU_MEMO_TEMPLATE);
        expect(template).toBeDefined();

        // Render with minimal context
        const context: TemplateContext = {
            title: 'Test',
            author: 'Test Author',
            date: '2024-01-01',
            language: 'en',
            body: 'Test body content',
            department: 'Test Department',
            to: 'Recipient',
            from: 'Sender',
            subject: 'Test Subject',
            signatureLines: true,
        };

        const result = renderTemplate(template, context);
        expect(result).toContain('\\documentclass');
        expect(result).toContain('Test Department');
        expect(result).toContain('Recipient');
        expect(result).toContain('Sender');
        expect(result).toContain('Test body content');
        expect(result).toContain('\\signaturelines');
    });
});

describe('Integration: Full Export Flow', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = path.join(os.tmpdir(), `scimax-test-${Date.now()}`);
        await fs.promises.mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
        try {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
        ExporterRegistry.getInstance().clear();
    });

    it('should load and execute a custom exporter', async () => {
        // Create a simple test exporter
        const exporterDir = path.join(tempDir, 'simple-letter');
        await fs.promises.mkdir(exporterDir);

        const manifest: ExporterManifest = {
            id: 'simple-letter',
            name: 'Simple Letter',
            parent: 'latex',
            outputFormat: 'tex',
            template: 'template.tex',
            keywords: {
                recipient: { required: true },
                greeting: { default: 'Dear' },
            },
        };

        const templateContent = `\\documentclass{letter}
\\begin{document}
{{greeting}} {{recipient}},

{{{body}}}

Sincerely,
{{author}}
\\end{document}`;

        await fs.promises.writeFile(
            path.join(exporterDir, 'manifest.json'),
            JSON.stringify(manifest, null, 2)
        );
        await fs.promises.writeFile(
            path.join(exporterDir, 'template.tex'),
            templateContent
        );

        // Load the exporter
        const registry = ExporterRegistry.getInstance();
        await registry.loadFromDirectory(tempDir);

        // Verify it loaded
        expect(registry.has('simple-letter')).toBe(true);

        // Get the exporter and render
        const exporter = registry.get('simple-letter')!;
        const context: TemplateContext = {
            title: 'Letter',
            author: 'John Doe',
            date: '2024-01-01',
            language: 'en',
            body: 'This is the letter body.',
            recipient: 'Jane Smith',
            greeting: 'Hello',
        };

        const result = renderTemplate(exporter.compiledTemplate, context);

        expect(result).toContain('\\documentclass{letter}');
        expect(result).toContain('Hello Jane Smith');
        expect(result).toContain('This is the letter body.');
        expect(result).toContain('John Doe');
    });
});
