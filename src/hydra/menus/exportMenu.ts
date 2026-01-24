/**
 * Export Menu - Hierarchical org export dispatcher
 *
 * Emacs org-mode style export menu with:
 * - First level: choose export format (h=HTML, l=LaTeX, m=Markdown)
 * - Second level: format-specific export options
 * - Body-only toggle: [b] to toggle body-only export mode
 */

import { HydraMenuDefinition } from '../types';

// =============================================================================
// Export State
// =============================================================================

/**
 * Body-only export mode toggle state
 * When true, exports produce only the document body without wrapper/preamble
 */
let bodyOnlyMode = false;

/**
 * Get the current body-only mode state
 */
export function isBodyOnlyMode(): boolean {
    return bodyOnlyMode;
}

/**
 * Set the body-only mode state
 */
export function setBodyOnlyMode(value: boolean): void {
    bodyOnlyMode = value;
}

/**
 * Toggle body-only mode and return the new state
 */
export function toggleBodyOnlyMode(): boolean {
    bodyOnlyMode = !bodyOnlyMode;
    return bodyOnlyMode;
}

/**
 * Main export dispatcher - first level menu
 */
export const exportMenu: HydraMenuDefinition = {
    id: 'scimax.export',
    title: 'Org Export Dispatcher',
    hint: 'Select export format... [b] toggles body-only mode',
    groups: [
        {
            title: 'Options',
            items: [
                {
                    key: 'b',
                    label: 'Body only',
                    description: 'Export without document wrapper/preamble',
                    icon: 'symbol-namespace',
                    exit: 'stay',
                    action: () => {
                        toggleBodyOnlyMode();
                    },
                    isToggle: true,
                    getToggleState: () => bodyOnlyMode,
                },
            ],
        },
        {
            title: 'Export Formats',
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
                {
                    key: 'd',
                    label: 'Word document',
                    description: 'Export to Microsoft Word (.docx)',
                    icon: 'file',
                    exit: 'submenu',
                    action: 'scimax.export.docx',
                },
                {
                    key: 'j',
                    label: 'Jupyter Notebook',
                    description: 'Export to .ipynb',
                    icon: 'notebook',
                    exit: 'submenu',
                    action: 'scimax.export.jupyter',
                },
                {
                    key: 'k',
                    label: 'Clipboard exports',
                    description: 'Copy to clipboard (ox-clip)',
                    icon: 'clippy',
                    exit: 'submenu',
                    action: 'scimax.export.clipboard',
                },
            ],
        },
        {
            title: 'Custom Exporters',
            items: [
                {
                    key: 'c',
                    label: 'Custom exports',
                    description: 'User-defined export templates',
                    icon: 'extensions',
                    exit: 'exit',
                    action: 'scimax.export.custom',
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
 * DOCX export submenu
 * Export to Microsoft Word (.docx) format
 */
export const docxExportMenu: HydraMenuDefinition = {
    id: 'scimax.export.docx',
    title: 'Word Document Export',
    hint: 'Export to Microsoft Word format with syntax highlighting',
    parent: 'scimax.export',
    groups: [
        {
            items: [
                {
                    key: 'd',
                    label: 'Word document',
                    description: 'Export to .docx file',
                    icon: 'file',
                    exit: 'exit',
                    action: 'scimax.org.exportDocx',
                },
                {
                    key: 'o',
                    label: 'Word and open',
                    description: 'Export and open in Word',
                    icon: 'link-external',
                    exit: 'exit',
                    action: 'scimax.org.exportDocxOpen',
                },
            ],
        },
    ],
};

/**
 * Jupyter Notebook export submenu
 * Export to Jupyter Notebook (.ipynb) format
 */
export const jupyterExportMenu: HydraMenuDefinition = {
    id: 'scimax.export.jupyter',
    title: 'Jupyter Notebook Export',
    hint: 'Export to Jupyter Notebook format (ox-ipynb compatible)',
    parent: 'scimax.export',
    groups: [
        {
            items: [
                {
                    key: 'j',
                    label: 'Jupyter Notebook',
                    description: 'Export to .ipynb file',
                    icon: 'notebook',
                    exit: 'exit',
                    action: 'scimax.org.exportIpynb',
                },
                {
                    key: 'o',
                    label: 'Notebook and open',
                    description: 'Export and open in notebook viewer',
                    icon: 'link-external',
                    exit: 'exit',
                    action: 'scimax.org.exportIpynbOpen',
                },
                {
                    key: 'p',
                    label: 'Participant notebook',
                    description: 'Export with solutions stripped (for teaching)',
                    icon: 'mortar-board',
                    exit: 'exit',
                    action: 'scimax.org.exportIpynbParticipant',
                },
            ],
        },
    ],
};

/**
 * Clipboard export submenu (ox-clip style)
 * Copy formatted content to clipboard for pasting into email, Word, etc.
 */
export const clipboardExportMenu: HydraMenuDefinition = {
    id: 'scimax.export.clipboard',
    title: 'Clipboard Export',
    hint: 'Copy to clipboard for pasting into other apps',
    parent: 'scimax.export',
    groups: [
        {
            title: 'HTML',
            items: [
                {
                    key: 'h',
                    label: 'HTML (rich)',
                    description: 'Copy as formatted rich text',
                    icon: 'file-code',
                    exit: 'exit',
                    action: 'scimax.org.clipboardHtmlRich',
                },
                {
                    key: 'H',
                    label: 'HTML (source)',
                    description: 'Copy HTML source code',
                    icon: 'code',
                    exit: 'exit',
                    action: 'scimax.org.clipboardHtmlSource',
                },
            ],
        },
        {
            title: 'Other Formats',
            items: [
                {
                    key: 'l',
                    label: 'LaTeX',
                    description: 'Copy LaTeX source',
                    icon: 'file',
                    exit: 'exit',
                    action: 'scimax.org.clipboardLatex',
                },
                {
                    key: 'm',
                    label: 'Markdown',
                    description: 'Copy Markdown source',
                    icon: 'markdown',
                    exit: 'exit',
                    action: 'scimax.org.clipboardMarkdown',
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
    docxExportMenu,
    jupyterExportMenu,
    clipboardExportMenu,
];
