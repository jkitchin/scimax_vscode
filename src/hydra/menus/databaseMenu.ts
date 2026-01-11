/**
 * Database Menu - Org database operations
 */

import { HydraMenuDefinition } from '../types';

export const databaseMenu: HydraMenuDefinition = {
    id: 'scimax.database',
    title: 'Database',
    hint: 'Org file database operations',
    parent: 'scimax.main',
    groups: [
        {
            title: 'Search',
            items: [
                {
                    key: 's',
                    label: 'Full-text Search',
                    description: 'Search all content',
                    icon: 'search',
                    exit: 'exit',
                    action: 'scimax.db.search',
                },
                {
                    key: 'v',
                    label: 'Vector Search',
                    description: 'Semantic similarity search',
                    icon: 'sparkle',
                    exit: 'exit',
                    action: 'scimax.db.vectorSearch',
                },
                {
                    key: 'h',
                    label: 'Search Headings',
                    description: 'Search by heading text',
                    icon: 'list-tree',
                    exit: 'exit',
                    action: 'scimax.db.searchHeadings',
                },
            ],
        },
        {
            title: 'Tasks',
            items: [
                {
                    key: 't',
                    label: 'Search TODOs',
                    description: 'Find TODO items',
                    icon: 'checklist',
                    exit: 'exit',
                    action: 'scimax.db.searchTodos',
                },
                {
                    key: 'a',
                    label: 'Agenda',
                    description: 'View scheduled items',
                    icon: 'calendar',
                    exit: 'exit',
                    action: 'scimax.db.agenda',
                },
            ],
        },
        {
            title: 'Links',
            items: [
                {
                    key: 'l',
                    label: 'Search Links',
                    description: 'Find org links',
                    icon: 'link',
                    exit: 'exit',
                    action: 'scimax.db.searchLinks',
                },
                {
                    key: 'b',
                    label: 'Backlinks',
                    description: 'Find backlinks to current file',
                    icon: 'references',
                    exit: 'exit',
                    action: 'scimax.db.backlinks',
                },
            ],
        },
        {
            title: 'Index',
            items: [
                {
                    key: 'i',
                    label: 'Index Current File',
                    description: 'Re-index the current file',
                    icon: 'refresh',
                    exit: 'exit',
                    action: 'scimax.db.indexFile',
                },
                {
                    key: 'I',
                    label: 'Index All Files',
                    description: 'Re-index all files',
                    icon: 'sync',
                    exit: 'exit',
                    action: 'scimax.db.indexAll',
                },
            ],
        },
        {
            title: 'Statistics',
            items: [
                {
                    key: 'S',
                    label: 'Database Stats',
                    description: 'Show database statistics',
                    icon: 'graph',
                    exit: 'exit',
                    action: 'scimax.db.stats',
                },
            ],
        },
    ],
};
