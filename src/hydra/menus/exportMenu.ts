/**
 * Export Menu - Hierarchical org export dispatcher
 *
 * Emacs org-mode style export menu with:
 * - First level: choose export format (h=HTML, l=LaTeX, m=Markdown)
 * - Second level: format-specific export options
 */

import { HydraMenuDefinition } from '../types';

/**
 * Main export dispatcher - first level menu
 */
export const exportMenu: HydraMenuDefinition = {
    id: 'scimax.export',
    title: 'Org Export Dispatcher',
    hint: 'Select export format...',
    groups: [
        {
            items: [
                {
                    key: 'h',
                    label: 'HTML exports',
                    description: 'Export to HTML format',
                    icon: 'file-code',
                    exit: 'submenu',
                    action: 'scimax.export.html',
                },
                {
                    key: 'l',
                    label: 'LaTeX exports',
                    description: 'Export to LaTeX/PDF',
                    icon: 'file-pdf',
                    exit: 'submenu',
                    action: 'scimax.export.latex',
                },
                {
                    key: 'm',
                    label: 'Markdown exports',
                    description: 'Export to Markdown',
                    icon: 'markdown',
                    exit: 'submenu',
                    action: 'scimax.export.markdown',
                },
            ],
        },
    ],
};

/**
 * HTML export submenu
 */
export const htmlExportMenu: HydraMenuDefinition = {
    id: 'scimax.export.html',
    title: 'HTML Export',
    parent: 'scimax.export',
    groups: [
        {
            items: [
                {
                    key: 'h',
                    label: 'HTML file',
                    description: 'Export to .html file',
                    icon: 'file-code',
                    exit: 'exit',
                    action: 'scimax.org.exportHtml',
                },
                {
                    key: 'o',
                    label: 'HTML and open',
                    description: 'Export and open in browser',
                    icon: 'link-external',
                    exit: 'exit',
                    action: 'scimax.org.exportHtmlOpen',
                },
                {
                    key: 'p',
                    label: 'HTML preview',
                    description: 'Preview in VS Code',
                    icon: 'preview',
                    exit: 'exit',
                    action: 'scimax.org.previewHtml',
                },
            ],
        },
    ],
};

/**
 * LaTeX export submenu
 */
export const latexExportMenu: HydraMenuDefinition = {
    id: 'scimax.export.latex',
    title: 'LaTeX Export',
    parent: 'scimax.export',
    groups: [
        {
            items: [
                {
                    key: 'l',
                    label: 'LaTeX file',
                    description: 'Export to .tex file',
                    icon: 'file',
                    exit: 'exit',
                    action: 'scimax.org.exportLatex',
                },
                {
                    key: 'p',
                    label: 'PDF file',
                    description: 'Export to PDF',
                    icon: 'file-pdf',
                    exit: 'exit',
                    action: 'scimax.org.exportPdf',
                },
                {
                    key: 'o',
                    label: 'PDF and open',
                    description: 'Export PDF and open',
                    icon: 'link-external',
                    exit: 'exit',
                    action: 'scimax.org.exportLatexOpen',
                },
                {
                    key: 'v',
                    label: 'Preview LaTeX',
                    description: 'Open in LaTeX Workshop',
                    icon: 'preview',
                    exit: 'exit',
                    action: 'scimax.latex.openPreview',
                },
                {
                    key: 's',
                    label: 'SyncTeX',
                    description: 'Forward sync to preview',
                    icon: 'sync',
                    exit: 'exit',
                    action: 'scimax.latex.forwardSync',
                },
            ],
        },
    ],
};

/**
 * Markdown export submenu
 */
export const markdownExportMenu: HydraMenuDefinition = {
    id: 'scimax.export.markdown',
    title: 'Markdown Export',
    parent: 'scimax.export',
    groups: [
        {
            items: [
                {
                    key: 'm',
                    label: 'Markdown file',
                    description: 'Export to .md file',
                    icon: 'markdown',
                    exit: 'exit',
                    action: 'scimax.org.exportMarkdown',
                },
                {
                    key: 'o',
                    label: 'Markdown and open',
                    description: 'Export and open',
                    icon: 'link-external',
                    exit: 'exit',
                    action: 'scimax.org.exportMarkdownOpen',
                },
            ],
        },
    ],
};

/**
 * All export menus for registration
 */
export const exportMenus: HydraMenuDefinition[] = [
    exportMenu,
    htmlExportMenu,
    latexExportMenu,
    markdownExportMenu,
];
