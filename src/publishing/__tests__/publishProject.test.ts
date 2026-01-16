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
