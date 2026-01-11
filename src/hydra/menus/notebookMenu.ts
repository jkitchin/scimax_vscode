/**
 * Notebook Menu - Project notebook operations
 */

import { HydraMenuDefinition } from '../types';

export const notebookMenu: HydraMenuDefinition = {
    id: 'scimax.notebook',
    title: 'Notebook',
    hint: 'Project-based organization',
    parent: 'scimax.main',
    groups: [
        {
            title: 'Navigation',
            items: [
                {
                    key: 'o',
                    label: 'Open Notebook',
                    description: 'Open an existing notebook',
                    icon: 'notebook',
                    exit: 'exit',
                    action: 'scimax.notebook.open',
                },
                {
                    key: 'l',
                    label: 'List Notebooks',
                    description: 'Show all notebooks',
                    icon: 'list-flat',
                    exit: 'exit',
                    action: 'scimax.notebook.list',
                },
            ],
        },
        {
            title: 'Create',
            items: [
                {
                    key: 'n',
                    label: 'New Notebook',
                    description: 'Create a new notebook',
                    icon: 'new-file',
                    exit: 'exit',
                    action: 'scimax.notebook.new',
                },
                {
                    key: 'e',
                    label: 'New Entry',
                    description: 'Add entry to current notebook',
                    icon: 'add',
                    exit: 'exit',
                    action: 'scimax.notebook.newEntry',
                },
            ],
        },
        {
            title: 'Search',
            items: [
                {
                    key: 's',
                    label: 'Search Notebook',
                    description: 'Search within current notebook',
                    icon: 'search',
                    exit: 'exit',
                    action: 'scimax.notebook.search',
                },
            ],
        },
        {
            title: 'Files',
            items: [
                {
                    key: 'f',
                    label: 'Open File',
                    description: 'Open file from notebook',
                    icon: 'file',
                    exit: 'exit',
                    action: 'scimax.notebook.openFile',
                },
                {
                    key: 'r',
                    label: 'Recent Files',
                    description: 'Show recent notebook files',
                    icon: 'history',
                    exit: 'exit',
                    action: 'scimax.notebook.recentFiles',
                },
            ],
        },
    ],
};
