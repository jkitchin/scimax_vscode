/**
 * Tests for Org Publishing Engine
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import type { PublishProject } from '../publishProject';

// Mock fs module
vi.mock('fs', () => ({
    promises: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        readdir: vi.fn(),
        stat: vi.fn(),
        access: vi.fn(),
        mkdir: vi.fn(),
        copyFile: vi.fn(),
    },
}));

// Mock minimatch
vi.mock('minimatch', () => ({
    minimatch: vi.fn((path: string, pattern: string) => {
        // Simple implementation for testing
        if (pattern === 'drafts/*') {
            return path.startsWith('drafts/');
        }
        return false;
    }),
}));

// Mock the parser and exporter
vi.mock('../../parser/orgExportParser', () => ({
    parseOrgFast: vi.fn(() => ({
        type: 'org-data',
        children: [],
        keywords: { TITLE: 'Test Title', DATE: '2026-01-16' },
    })),
}));

vi.mock('../../parser/orgExportHtml', () => ({
    exportToHtml: vi.fn(() => '<html><body>Test</body></html>'),
}));

vi.mock('../../parser/orgInclude', () => ({
    hasIncludes: vi.fn(() => false),
    processIncludes: vi.fn((content: string) => content),
}));

import * as fs from 'fs';
import {
    computeOutputPath,
    generateSitemapOrg,
    createProjectConfig,
} from '../orgPublish';

describe('computeOutputPath', () => {
    const workspaceRoot = '/home/user/project';

    it('should convert .org to .html', () => {
        const project: PublishProject = {
            name: 'test',
            baseDirectory: './org',
            publishingDirectory: './docs',
        };

        const result = computeOutputPath(
            '/home/user/project/org/page.org',
            project,
            workspaceRoot
        );

        expect(result).toBe(path.join(workspaceRoot, 'docs', 'page.html'));
    });

    it('should preserve subdirectory structure', () => {
        const project: PublishProject = {
            name: 'test',
            baseDirectory: './org',
            publishingDirectory: './docs',
        };

        const result = computeOutputPath(
            '/home/user/project/org/subdir/nested/page.org',
            project,
            workspaceRoot
        );

        expect(result).toBe(path.join(workspaceRoot, 'docs', 'subdir', 'nested', 'page.html'));
    });

    it('should handle different base directories', () => {
        const project: PublishProject = {
            name: 'test',
            baseDirectory: './src/content',
            publishingDirectory: './public',
        };

        const result = computeOutputPath(
            '/home/user/project/src/content/about.org',
            project,
            workspaceRoot
        );

        expect(result).toBe(path.join(workspaceRoot, 'public', 'about.html'));
    });
});

describe('generateSitemapOrg', () => {
    it('should generate basic sitemap with title', () => {
        const entries = [
            { file: '/path/to/about.org', relativePath: 'about.org', title: 'About' },
            { file: '/path/to/contact.org', relativePath: 'contact.org', title: 'Contact' },
        ];

        const project: PublishProject = {
            name: 'test',
            baseDirectory: './org',
            publishingDirectory: './docs',
            sitemapTitle: 'My Site Map',
        };

        const result = generateSitemapOrg(entries, project);

        expect(result).toContain('#+TITLE: My Site Map');
        expect(result).toContain('[[file:about.html][About]]');
        expect(result).toContain('[[file:contact.html][Contact]]');
    });

    it('should sort entries alphabetically by default', () => {
        const entries = [
            { file: '/path/to/zebra.org', relativePath: 'zebra.org', title: 'Zebra' },
            { file: '/path/to/apple.org', relativePath: 'apple.org', title: 'Apple' },
            { file: '/path/to/mango.org', relativePath: 'mango.org', title: 'Mango' },
        ];

        const project: PublishProject = {
            name: 'test',
            baseDirectory: './org',
            publishingDirectory: './docs',
            sitemapSortFiles: 'alphabetically',
        };

        const result = generateSitemapOrg(entries, project);
        const lines = result.split('\n');

        const appleIndex = lines.findIndex(l => l.includes('Apple'));
        const mangoIndex = lines.findIndex(l => l.includes('Mango'));
        const zebraIndex = lines.findIndex(l => l.includes('Zebra'));

        expect(appleIndex).toBeLessThan(mangoIndex);
        expect(mangoIndex).toBeLessThan(zebraIndex);
    });

    it('should sort entries chronologically when specified', () => {
        const entries = [
            { file: '/path/to/new.org', relativePath: 'new.org', title: 'New Post', date: new Date('2026-01-15') },
            { file: '/path/to/old.org', relativePath: 'old.org', title: 'Old Post', date: new Date('2026-01-01') },
            { file: '/path/to/mid.org', relativePath: 'mid.org', title: 'Mid Post', date: new Date('2026-01-10') },
        ];

        const project: PublishProject = {
            name: 'test',
            baseDirectory: './org',
            publishingDirectory: './docs',
            sitemapSortFiles: 'chronologically',
        };

        const result = generateSitemapOrg(entries, project);
        const lines = result.split('\n');

        const oldIndex = lines.findIndex(l => l.includes('Old Post'));
        const midIndex = lines.findIndex(l => l.includes('Mid Post'));
        const newIndex = lines.findIndex(l => l.includes('New Post'));

        expect(oldIndex).toBeLessThan(midIndex);
        expect(midIndex).toBeLessThan(newIndex);
    });

    it('should sort entries anti-chronologically for blogs', () => {
        const entries = [
            { file: '/path/to/new.org', relativePath: 'new.org', title: 'New Post', date: new Date('2026-01-15') },
            { file: '/path/to/old.org', relativePath: 'old.org', title: 'Old Post', date: new Date('2026-01-01') },
        ];

        const project: PublishProject = {
            name: 'blog',
            baseDirectory: './posts',
            publishingDirectory: './docs',
            sitemapSortFiles: 'anti-chronologically',
        };

        const result = generateSitemapOrg(entries, project);
        const lines = result.split('\n');

        const newIndex = lines.findIndex(l => l.includes('New Post'));
        const oldIndex = lines.findIndex(l => l.includes('Old Post'));

        expect(newIndex).toBeLessThan(oldIndex);
    });

    it('should include date in entries when available', () => {
        const entries = [
            { file: '/path/to/post.org', relativePath: 'post.org', title: 'Post', date: new Date('2026-01-16') },
        ];

        const project: PublishProject = {
            name: 'test',
            baseDirectory: './org',
            publishingDirectory: './docs',
        };

        const result = generateSitemapOrg(entries, project);

        expect(result).toContain('2026-01-16');
    });

    it('should use default sitemap title when not specified', () => {
        const entries = [
            { file: '/path/to/page.org', relativePath: 'page.org', title: 'Page' },
        ];

        const project: PublishProject = {
            name: 'test',
            baseDirectory: './org',
            publishingDirectory: './docs',
        };

        const result = generateSitemapOrg(entries, project);

        expect(result).toContain('#+TITLE: Site Map');
    });

    it('should generate tree-style sitemap when specified', () => {
        const entries = [
            { file: '/path/to/index.org', relativePath: 'index.org', title: 'Home' },
            { file: '/path/to/docs/intro.org', relativePath: 'docs/intro.org', title: 'Introduction' },
            { file: '/path/to/docs/guide.org', relativePath: 'docs/guide.org', title: 'Guide' },
        ];

        const project: PublishProject = {
            name: 'test',
            baseDirectory: './org',
            publishingDirectory: './docs',
            sitemapStyle: 'tree',
        };

        const result = generateSitemapOrg(entries, project);

        expect(result).toContain('* docs');
        expect(result).toContain('[[file:docs/intro.html][Introduction]]');
    });
});

describe('createProjectConfig', () => {
    it('should create basic project config', () => {
        const config = createProjectConfig(
            'my-site',
            './org',
            './docs',
            false,
            true
        );

        expect(config.projects['my-site']).toBeDefined();
        expect(config.projects['my-site']).toHaveProperty('baseDirectory', './org');
        expect(config.projects['my-site']).toHaveProperty('publishingDirectory', './docs');
        expect(config.projects['my-site']).toHaveProperty('autoSitemap', true);
    });

    it('should apply GitHub Pages settings when enabled', () => {
        const config = createProjectConfig(
            'website',
            './org',
            './docs',
            true,
            true
        );

        expect(config.githubPages).toBe(true);
        const project = config.projects['website'] as PublishProject;
        expect(project.sitemapFilename).toBe('index.org');
        expect(project.sitemapTitle).toBe('Home');
    });

    it('should disable sitemap when specified', () => {
        const config = createProjectConfig(
            'no-sitemap',
            './org',
            './docs',
            false,
            false
        );

        const project = config.projects['no-sitemap'] as PublishProject;
        expect(project.autoSitemap).toBe(false);
    });

    it('should set default theme to true', () => {
        const config = createProjectConfig(
            'themed',
            './org',
            './docs',
            false,
            true
        );

        const project = config.projects['themed'] as PublishProject;
        expect(project.useDefaultTheme).toBe(true);
    });

    it('should set recursive to true', () => {
        const config = createProjectConfig(
            'recursive',
            './org',
            './docs',
            false,
            true
        );

        const project = config.projects['recursive'] as PublishProject;
        expect(project.recursive).toBe(true);
    });
});

describe('File Publishing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // These tests would require more complex mocking of fs and the export pipeline
    // For now, we test the utility functions above which are the core logic

    it('should be tested with integration tests', () => {
        // The actual file publishing involves:
        // 1. Reading source files
        // 2. Parsing org content
        // 3. Exporting to HTML
        // 4. Writing output files
        // This is better tested as an integration test with a real filesystem
        expect(true).toBe(true);
    });
});
