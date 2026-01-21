/**
 * Template Menu - Document template operations
 */

import { HydraMenuDefinition } from '../types';

export const templateMenu: HydraMenuDefinition = {
    id: 'scimax.templates',
    title: 'Templates',
    hint: 'Document template system',
    parent: 'scimax.main',
    groups: [
        {
            title: 'Insert Template',
            items: [
                {
                    key: 'i',
                    label: 'Insert',
                    description: 'Insert template at cursor',
                    icon: 'insert',
                    exit: 'exit',
                    action: 'scimax.templates.quickInsert',
                },
                {
                    key: 'o',
                    label: 'Insert Org',
                    description: 'Insert org-mode template',
                    icon: 'file-text',
                    exit: 'exit',
                    action: 'scimax.templates.insertOrg',
                },
                {
                    key: 'm',
                    label: 'Insert Markdown',
                    description: 'Insert markdown template',
                    icon: 'markdown',
                    exit: 'exit',
                    action: 'scimax.templates.insertMarkdown',
                },
                {
                    key: 'x',
                    label: 'Insert LaTeX',
                    description: 'Insert LaTeX template',
                    icon: 'symbol-operator',
                    exit: 'exit',
                    action: 'scimax.templates.insertLatex',
                },
            ],
        },
        {
            title: 'New File',
            items: [
                {
                    key: 'n',
                    label: 'New File',
                    description: 'Create new file from template',
                    icon: 'new-file',
                    exit: 'exit',
                    action: 'scimax.templates.newFile',
                },
                {
                    key: 'O',
                    label: 'New Org File',
                    description: 'Create new org file from template',
                    icon: 'file-text',
                    exit: 'exit',
                    action: 'scimax.templates.newOrgFile',
                },
                {
                    key: 'M',
                    label: 'New Markdown File',
                    description: 'Create new markdown file from template',
                    icon: 'markdown',
                    exit: 'exit',
                    action: 'scimax.templates.newMarkdownFile',
                },
                {
                    key: 'X',
                    label: 'New LaTeX File',
                    description: 'Create new LaTeX file from template',
                    icon: 'symbol-operator',
                    exit: 'exit',
                    action: 'scimax.templates.newLatexFile',
                },
            ],
        },
        {
            title: 'Manage Templates',
            items: [
                {
                    key: 'l',
                    label: 'List All',
                    description: 'List all available templates',
                    icon: 'list-flat',
                    exit: 'exit',
                    action: 'scimax.templates.list',
                },
                {
                    key: 's',
                    label: 'Save Selection',
                    description: 'Create template from selection',
                    icon: 'save',
                    exit: 'exit',
                    action: 'scimax.templates.createFromSelection',
                },
                {
                    key: 'e',
                    label: 'Edit Templates',
                    description: 'Open templates directory in editor',
                    icon: 'edit',
                    exit: 'exit',
                    action: 'scimax.templates.editTemplates',
                },
                {
                    key: 'd',
                    label: 'Open Directory',
                    description: 'Open templates directory in file explorer',
                    icon: 'folder-opened',
                    exit: 'exit',
                    action: 'scimax.templates.openDirectory',
                },
                {
                    key: 'r',
                    label: 'Reload',
                    description: 'Reload templates from disk',
                    icon: 'refresh',
                    exit: 'exit',
                    action: 'scimax.templates.reload',
                },
            ],
        },
    ],
};
