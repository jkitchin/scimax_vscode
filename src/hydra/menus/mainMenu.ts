/**
 * Main Scimax Menu - Entry point for all features
 */

import { HydraMenuDefinition } from '../types';

export const mainMenu: HydraMenuDefinition = {
    id: 'scimax.main',
    title: 'Scimax',
    hint: 'Press a key to select, or type to filter',
    groups: [
        {
            title: 'Features',
            items: [
                {
                    key: 'j',
                    label: 'Journal',
                    description: 'Date-based journaling',
                    icon: 'calendar',
                    exit: 'submenu',
                    action: 'scimax.journal',
                },
                {
                    key: 'r',
                    label: 'References',
                    description: 'Bibliography management',
                    icon: 'book',
                    exit: 'submenu',
                    action: 'scimax.references',
                },
                {
                    key: 'n',
                    label: 'Notebook',
                    description: 'Project notebooks',
                    icon: 'notebook',
                    exit: 'submenu',
                    action: 'scimax.notebook',
                },
                {
                    key: 'p',
                    label: 'Projects',
                    description: 'Project switching (projectile)',
                    icon: 'folder',
                    exit: 'submenu',
                    action: 'scimax.projectile',
                },
                {
                    key: 't',
                    label: 'Templates',
                    description: 'Document templates',
                    icon: 'file-code',
                    exit: 'submenu',
                    action: 'scimax.templates',
                },
            ],
        },
        {
            title: 'Search & Navigation',
            items: [
                {
                    key: 's',
                    label: 'Search',
                    description: 'Search across files',
                    icon: 'search',
                    exit: 'submenu',
                    action: 'scimax.search',
                },
                {
                    key: 'g',
                    label: 'Jump (Avy)',
                    description: 'Quick navigation',
                    icon: 'zap',
                    exit: 'submenu',
                    action: 'scimax.jump',
                },
            ],
        },
        {
            title: 'Database',
            items: [
                {
                    key: 'd',
                    label: 'Database',
                    description: 'Org database operations',
                    icon: 'database',
                    exit: 'submenu',
                    action: 'scimax.database',
                },
            ],
        },
    ],
};
