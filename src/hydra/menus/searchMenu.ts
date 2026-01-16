/**
 * Search Menu - Search and navigation operations
 */

import { HydraMenuDefinition } from '../types';

export const searchMenu: HydraMenuDefinition = {
    id: 'scimax.search',
    title: 'Search',
    hint: 'Search across files and content',
    parent: 'scimax.main',
    groups: [
        {
            title: 'Fuzzy Search',
            items: [
                {
                    key: 'f',
                    label: 'Search Current File',
                    description: 'Fuzzy search in current file',
                    icon: 'file-text',
                    exit: 'exit',
                    action: 'scimax.fuzzySearch.currentFile',
                },
                {
                    key: 'o',
                    label: 'Search Open Files',
                    description: 'Search across all open files',
                    icon: 'files',
                    exit: 'exit',
                    action: 'scimax.fuzzySearch.openFiles',
                },
                {
                    key: 'h',
                    label: 'Search Headings',
                    description: 'Search headings in current file',
                    icon: 'list-tree',
                    exit: 'exit',
                    action: 'scimax.fuzzySearch.headings',
                },
            ],
        },
        {
            title: 'Database Search',
            items: [
                {
                    key: 's',
                    label: 'Full-text Search',
                    description: 'Search all indexed content',
                    icon: 'search',
                    exit: 'exit',
                    action: 'scimax.db.search',
                },
                {
                    key: 'v',
                    label: 'Semantic Search',
                    description: 'AI-powered similarity search',
                    icon: 'sparkle',
                    exit: 'exit',
                    action: 'scimax.db.searchSemantic',
                },
            ],
        },
        {
            title: 'Tasks & Agenda',
            items: [
                {
                    key: 't',
                    label: 'Show TODOs',
                    description: 'List all TODO items',
                    icon: 'checklist',
                    exit: 'exit',
                    action: 'scimax.db.showTodos',
                },
                {
                    key: 'a',
                    label: 'Agenda',
                    description: 'View agenda items',
                    icon: 'calendar',
                    exit: 'exit',
                    action: 'scimax.db.agenda',
                },
            ],
        },
    ],
};
