/**
 * Tests for Org Publishing Project Configuration
 */

import { describe, it, expect } from 'vitest';
import {
    PublishProject,
    PublishConfig,
    ComponentProject,
    isComponentProject,
    isPublishProject,
    mergeWithDefaults,
    validateProject,
    validateConfig,
    toHtmlExportOptions,
    DEFAULT_PROJECT_CONFIG,
    GITHUB_PAGES_PRESET,
    TocConfig,
    flattenToc,
    getTocFiles,
    findTocEntry,
} from '../publishProject';

describe('PublishProject Types', () => {
    describe('isComponentProject', () => {
        it('should return true for component projects', () => {
            const component: ComponentProject = {
                name: 'full-site',
                components: ['pages', 'static'],
            };
            expect(isComponentProject(component)).toBe(true);
        });

        it('should return false for regular projects', () => {
            const project: PublishProject = {
                name: 'pages',
                baseDirectory: './org',
                publishingDirectory: './docs',
            };
            expect(isComponentProject(project)).toBe(false);
        });
    });

    describe('isPublishProject', () => {
        it('should return true for regular projects', () => {
            const project: PublishProject = {
                name: 'pages',
                baseDirectory: './org',
                publishingDirectory: './docs',
            };
            expect(isPublishProject(project)).toBe(true);
        });

        it('should return false for component projects', () => {
            const component: ComponentProject = {
                name: 'full-site',
                components: ['pages', 'static'],
            };
            expect(isPublishProject(component)).toBe(false);
        });
    });
});

describe('mergeWithDefaults', () => {
    it('should merge partial config with defaults', () => {
        const partial = {
            name: 'my-project',
            baseDirectory: './src',
            publishingDirectory: './out',
        };

        const result = mergeWithDefaults(partial);

        expect(result.name).toBe('my-project');
        expect(result.baseDirectory).toBe('./src');
        expect(result.publishingDirectory).toBe('./out');
        expect(result.recursive).toBe(DEFAULT_PROJECT_CONFIG.recursive);
        expect(result.autoSitemap).toBe(DEFAULT_PROJECT_CONFIG.autoSitemap);
        expect(result.baseExtension).toBe(DEFAULT_PROJECT_CONFIG.baseExtension);
    });

    it('should use GitHub Pages preset when specified', () => {
        const partial = {
            name: 'gh-pages',
            baseDirectory: './org',
        };

        const result = mergeWithDefaults(partial, GITHUB_PAGES_PRESET);

        expect(result.publishingDirectory).toBe('./docs');
        expect(result.sitemapFilename).toBe('index.org');
        expect(result.sitemapTitle).toBe('Home');
    });

    it('should allow overriding preset values', () => {
        const partial = {
            name: 'custom',
            baseDirectory: './org',
            publishingDirectory: './public',
            sitemapFilename: 'sitemap.org',
        };

        const result = mergeWithDefaults(partial, GITHUB_PAGES_PRESET);

        expect(result.publishingDirectory).toBe('./public');
        expect(result.sitemapFilename).toBe('sitemap.org');
    });

    it('should provide default name if not specified', () => {
        const partial = {
            baseDirectory: './org',
            publishingDirectory: './docs',
        };

        const result = mergeWithDefaults(partial);

        expect(result.name).toBe('default');
    });
});

describe('validateProject', () => {
    it('should return no errors for valid project', () => {
        const project = {
            name: 'valid-project',
            baseDirectory: './org',
            publishingDirectory: './docs',
        };

        const errors = validateProject(project);

        expect(errors).toHaveLength(0);
    });

    it('should require name', () => {
        const project = {
            baseDirectory: './org',
            publishingDirectory: './docs',
        };

        const errors = validateProject(project);

        expect(errors.some(e => e.field === 'name')).toBe(true);
    });

    it('should require baseDirectory', () => {
        const project = {
            name: 'test',
            publishingDirectory: './docs',
        };

        const errors = validateProject(project);

        expect(errors.some(e => e.field === 'baseDirectory')).toBe(true);
    });

    it('should require publishingDirectory', () => {
        const project = {
            name: 'test',
            baseDirectory: './org',
        };

        const errors = validateProject(project);

        expect(errors.some(e => e.field === 'publishingDirectory')).toBe(true);
    });

    it('should reject same base and publishing directory', () => {
        const project = {
            name: 'test',
            baseDirectory: './org',
            publishingDirectory: './org',
        };

        const errors = validateProject(project);

        expect(errors.some(e => e.field === 'publishingDirectory')).toBe(true);
        expect(errors.some(e => e.message.includes('different'))).toBe(true);
    });
});

describe('validateConfig', () => {
    it('should return no errors for valid config', () => {
        const config: PublishConfig = {
            projects: {
                website: {
                    name: 'website',
                    baseDirectory: './org',
                    publishingDirectory: './docs',
                },
            },
        };

        const errors = validateConfig(config);

        expect(errors).toHaveLength(0);
    });

    it('should require at least one project', () => {
        const config: Partial<PublishConfig> = {
            projects: {},
        };

        const errors = validateConfig(config);

        expect(errors.some(e => e.field === 'projects')).toBe(true);
    });

    it('should validate component project references', () => {
        const config: PublishConfig = {
            projects: {
                'full-site': {
                    name: 'full-site',
                    components: ['pages', 'nonexistent'],
                },
                pages: {
                    name: 'pages',
                    baseDirectory: './org',
                    publishingDirectory: './docs',
                },
            },
        };

        const errors = validateConfig(config);

        expect(errors.some(e => e.message.includes('nonexistent'))).toBe(true);
    });

    it('should validate nested project configs', () => {
        const config: PublishConfig = {
            projects: {
                invalid: {
                    name: 'invalid',
                    baseDirectory: './org',
                    // missing publishingDirectory
                } as PublishProject,
            },
        };

        const errors = validateConfig(config);

        expect(errors.some(e => e.field.includes('publishingDirectory'))).toBe(true);
    });
});

describe('toHtmlExportOptions', () => {
    it('should convert project options to HTML export options', () => {
        const project: PublishProject = {
            name: 'test',
            baseDirectory: './org',
            publishingDirectory: './docs',
            withToc: 3,
            sectionNumbers: true,
            cssFiles: ['./css/style.css'],
            jsFiles: ['./js/app.js'],
            htmlHeadExtra: '<meta name="test">',
            htmlPreamble: '<nav>Nav</nav>',
            htmlPostamble: '<footer>Footer</footer>',
        };

        const options = toHtmlExportOptions(project);

        expect(options.toc).toBe(3);
        expect(options.sectionNumbers).toBe(true);
        expect(options.cssFiles).toEqual(['./css/style.css']);
        expect(options.jsFiles).toEqual(['./js/app.js']);
        expect(options.headExtra).toBe('<meta name="test">');
        expect(options.preamble).toBe(true);
        expect(options.preambleContent).toBe('<nav>Nav</nav>');
        expect(options.postamble).toBe(true);
        expect(options.postambleContent).toBe('<footer>Footer</footer>');
    });

    it('should handle missing optional fields', () => {
        const project: PublishProject = {
            name: 'minimal',
            baseDirectory: './org',
            publishingDirectory: './docs',
        };

        const options = toHtmlExportOptions(project);

        expect(options.toc).toBeUndefined();
        expect(options.sectionNumbers).toBeUndefined();
        expect(options.cssFiles).toBeUndefined();
        expect(options.preamble).toBe(false);
        expect(options.postamble).toBe(false);
    });
});

describe('DEFAULT_PROJECT_CONFIG', () => {
    it('should have sensible defaults', () => {
        expect(DEFAULT_PROJECT_CONFIG.baseExtension).toBe('org');
        expect(DEFAULT_PROJECT_CONFIG.recursive).toBe(true);
        expect(DEFAULT_PROJECT_CONFIG.publishingFunction).toBe('org-html-publish-to-html');
        expect(DEFAULT_PROJECT_CONFIG.autoSitemap).toBe(true);
        expect(DEFAULT_PROJECT_CONFIG.sitemapFilename).toBe('sitemap.org');
        expect(DEFAULT_PROJECT_CONFIG.useDefaultTheme).toBe(true);
    });
});

describe('GITHUB_PAGES_PRESET', () => {
    it('should be configured for GitHub Pages', () => {
        expect(GITHUB_PAGES_PRESET.publishingDirectory).toBe('./docs');
        expect(GITHUB_PAGES_PRESET.sitemapFilename).toBe('index.org');
        expect(GITHUB_PAGES_PRESET.sitemapTitle).toBe('Home');
    });

    it('should include all default config values', () => {
        expect(GITHUB_PAGES_PRESET.baseExtension).toBe(DEFAULT_PROJECT_CONFIG.baseExtension);
        expect(GITHUB_PAGES_PRESET.recursive).toBe(DEFAULT_PROJECT_CONFIG.recursive);
    });
});

// =============================================================================
// TOC Helper Tests
// =============================================================================

describe('flattenToc', () => {
    it('should flatten simple TOC with chapters', () => {
        const toc: TocConfig = {
            root: 'index',
            chapters: [
                { file: 'getting-started' },
                { file: 'installation' },
                { file: 'reference' },
            ],
        };

        const flat = flattenToc(toc);

        expect(flat).toHaveLength(4); // root + 3 chapters
        expect(flat[0].file).toBe('index');
        expect(flat[1].file).toBe('getting-started');
        expect(flat[2].file).toBe('installation');
        expect(flat[3].file).toBe('reference');
    });

    it('should add prev/next navigation links', () => {
        const toc: TocConfig = {
            root: 'index',
            chapters: [
                { file: 'first' },
                { file: 'second' },
                { file: 'third' },
            ],
        };

        const flat = flattenToc(toc);

        // First entry has no prev
        expect(flat[0].prev).toBeUndefined();
        expect(flat[0].next).toBe('first');

        // Middle entries have both
        expect(flat[1].prev).toBe('index');
        expect(flat[1].next).toBe('second');

        // Last entry has no next
        expect(flat[3].prev).toBe('second');
        expect(flat[3].next).toBeUndefined();
    });

    it('should handle nested sections', () => {
        const toc: TocConfig = {
            root: 'index',
            chapters: [
                {
                    file: 'guide',
                    sections: [
                        { file: 'guide/basics' },
                        { file: 'guide/advanced' },
                    ],
                },
            ],
        };

        const flat = flattenToc(toc);

        expect(flat).toHaveLength(4); // root + guide + 2 sections
        expect(flat[0].file).toBe('index');
        expect(flat[1].file).toBe('guide');
        expect(flat[2].file).toBe('guide/basics');
        expect(flat[3].file).toBe('guide/advanced');
    });

    it('should handle parts with chapters', () => {
        const toc: TocConfig = {
            root: 'intro',
            parts: [
                {
                    caption: 'Getting Started',
                    chapters: [
                        { file: 'install' },
                        { file: 'quickstart' },
                    ],
                },
                {
                    caption: 'Reference',
                    chapters: [
                        { file: 'api' },
                    ],
                },
            ],
        };

        const flat = flattenToc(toc);

        expect(flat).toHaveLength(4); // root + 3 chapters across parts
        expect(flat[1].part).toBe('Getting Started');
        expect(flat[2].part).toBe('Getting Started');
        expect(flat[3].part).toBe('Reference');
    });

    it('should set correct nesting levels', () => {
        const toc: TocConfig = {
            root: 'index',
            chapters: [
                {
                    file: 'guide',
                    sections: [
                        {
                            file: 'guide/basics',
                            sections: [
                                { file: 'guide/basics/intro' },
                            ],
                        },
                    ],
                },
            ],
        };

        const flat = flattenToc(toc);

        expect(flat[0].level).toBe(0); // root
        expect(flat[1].level).toBe(1); // guide
        expect(flat[2].level).toBe(2); // guide/basics
        expect(flat[3].level).toBe(3); // guide/basics/intro
    });
});

describe('getTocFiles', () => {
    it('should return all files from simple TOC', () => {
        const toc: TocConfig = {
            root: 'index',
            chapters: [
                { file: 'first' },
                { file: 'second' },
            ],
        };

        const files = getTocFiles(toc);

        expect(files).toContain('index');
        expect(files).toContain('first');
        expect(files).toContain('second');
        expect(files).toHaveLength(3);
    });

    it('should include nested section files', () => {
        const toc: TocConfig = {
            root: 'index',
            chapters: [
                {
                    file: 'guide',
                    sections: [
                        { file: 'guide/basics' },
                    ],
                },
            ],
        };

        const files = getTocFiles(toc);

        expect(files).toContain('guide');
        expect(files).toContain('guide/basics');
    });

    it('should include files from all parts', () => {
        const toc: TocConfig = {
            root: 'intro',
            parts: [
                {
                    caption: 'Part 1',
                    chapters: [{ file: 'ch1' }],
                },
                {
                    caption: 'Part 2',
                    chapters: [{ file: 'ch2' }],
                },
            ],
        };

        const files = getTocFiles(toc);

        expect(files).toContain('intro');
        expect(files).toContain('ch1');
        expect(files).toContain('ch2');
    });
});

describe('findTocEntry', () => {
    const toc: TocConfig = {
        root: 'index',
        chapters: [
            { file: 'getting-started', title: 'Getting Started' },
            { file: 'guide/basics' },
        ],
    };

    it('should find entry by exact file path', () => {
        const entry = findTocEntry(toc, 'getting-started');

        expect(entry).toBeDefined();
        expect(entry?.file).toBe('getting-started');
    });

    it('should find entry by path with extension', () => {
        const entry = findTocEntry(toc, 'getting-started.org');

        expect(entry).toBeDefined();
        expect(entry?.file).toBe('getting-started');
    });

    it('should find entry with subdirectory path', () => {
        const entry = findTocEntry(toc, 'guide/basics');

        expect(entry).toBeDefined();
        expect(entry?.file).toBe('guide/basics');
    });

    it('should return undefined for non-existent file', () => {
        const entry = findTocEntry(toc, 'nonexistent');

        expect(entry).toBeUndefined();
    });

    it('should include navigation info in found entry', () => {
        const entry = findTocEntry(toc, 'getting-started');

        expect(entry?.prev).toBe('index');
        expect(entry?.next).toBe('guide/basics');
    });
});
