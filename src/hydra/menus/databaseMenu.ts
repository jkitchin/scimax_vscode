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
                    label: 'Semantic Search',
                    description: 'AI-powered similarity search',
                    icon: 'sparkle',
                    exit: 'exit',
                    action: 'scimax.db.searchSemantic',
                },
                {
                    key: 'y',
                    label: 'Hybrid Search',
                    description: 'Combined keyword + semantic search',
                    icon: 'combine',
                    exit: 'exit',
                    action: 'scimax.db.searchHybrid',
                },
                {
                    key: 'h',
                    label: 'Search Headings',
                    description: 'Search by heading text',
                    icon: 'list-tree',
                    exit: 'exit',
                    action: 'scimax.db.searchHeadings',
                },
                {
                    key: 'b',
                    label: 'Search Code Blocks',
                    description: 'Search source blocks by language',
                    icon: 'code',
                    exit: 'exit',
                    action: 'scimax.db.searchBlocks',
                },
                {
                    key: '#',
                    label: 'Search Hashtags',
                    description: 'Find files with #hashtags',
                    icon: 'symbol-keyword',
                    exit: 'exit',
                    action: 'scimax.db.searchHashtags',
                },
            ],
        },
        {
            title: 'Filter',
            items: [
                {
                    key: ':',
                    label: 'Search by Tag',
                    description: 'Filter headings by org tags',
                    icon: 'tag',
                    exit: 'exit',
                    action: 'scimax.db.searchByTag',
                },
                {
                    key: 'p',
                    label: 'Search by Property',
                    description: 'Search property drawer values',
                    icon: 'symbol-property',
                    exit: 'exit',
                    action: 'scimax.db.searchByProperty',
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
                    description: 'View scheduled items',
                    icon: 'calendar',
                    exit: 'exit',
                    action: 'scimax.db.agenda',
                },
                {
                    key: 'd',
                    label: 'Deadlines',
                    description: 'Show upcoming deadlines',
                    icon: 'warning',
                    exit: 'exit',
                    action: 'scimax.db.deadlines',
                },
            ],
        },
        {
            title: 'Browse & Index',
            items: [
                {
                    key: 'f',
                    label: 'Browse Files',
                    description: 'Browse all indexed files',
                    icon: 'files',
                    exit: 'exit',
                    action: 'scimax.db.browseFiles',
                },
                {
                    key: 'i',
                    label: 'Reindex All Files',
                    description: 'Re-index all files in workspace',
                    icon: 'sync',
                    exit: 'exit',
                    action: 'scimax.db.reindex',
                },
                {
                    key: 'c',
                    label: 'Set Search Scope',
                    description: 'Limit searches to directory/project',
                    icon: 'folder',
                    exit: 'exit',
                    action: 'scimax.db.setScope',
                },
            ],
        },
        {
            title: 'Maintenance',
            items: [
                {
                    key: 'S',
                    label: 'Database Stats',
                    description: 'Show database statistics',
                    icon: 'graph',
                    exit: 'exit',
                    action: 'scimax.db.stats',
                },
                {
                    key: 'o',
                    label: 'Optimize Database',
                    description: 'Clean up and optimize (VACUUM)',
                    icon: 'tools',
                    exit: 'exit',
                    action: 'scimax.db.optimize',
                },
                {
                    key: 'e',
                    label: 'Configure Embeddings',
                    description: 'Setup Ollama/OpenAI for semantic search',
                    icon: 'settings-gear',
                    exit: 'exit',
                    action: 'scimax.db.configureEmbeddings',
                },
            ],
        },
    ],
};
