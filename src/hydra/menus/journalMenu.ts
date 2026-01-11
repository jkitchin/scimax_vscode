/**
 * Journal Menu - Date-based journaling operations
 */

import { HydraMenuDefinition } from '../types';

export const journalMenu: HydraMenuDefinition = {
    id: 'scimax.journal',
    title: 'Journal',
    hint: 'Date-based journaling system',
    parent: 'scimax.main',
    groups: [
        {
            title: 'Open Entry',
            items: [
                {
                    key: 't',
                    label: 'Today',
                    description: 'Open today\'s journal entry',
                    icon: 'calendar',
                    exit: 'exit',
                    action: 'scimax.journal.today',
                },
                {
                    key: 'y',
                    label: 'Yesterday',
                    description: 'Open yesterday\'s entry',
                    icon: 'history',
                    exit: 'exit',
                    action: 'scimax.journal.yesterday',
                },
                {
                    key: 'w',
                    label: 'Tomorrow',
                    description: 'Open tomorrow\'s entry',
                    icon: 'arrow-right',
                    exit: 'exit',
                    action: 'scimax.journal.tomorrow',
                },
                {
                    key: 'g',
                    label: 'Go to Date',
                    description: 'Open entry for specific date',
                    icon: 'milestone',
                    exit: 'exit',
                    action: 'scimax.journal.goto',
                },
            ],
        },
        {
            title: 'Navigation',
            items: [
                {
                    key: 'p',
                    label: 'Previous Entry',
                    description: 'Navigate to previous entry',
                    icon: 'arrow-left',
                    exit: 'exit',
                    action: 'scimax.journal.previousEntry',
                },
                {
                    key: 'n',
                    label: 'Next Entry',
                    description: 'Navigate to next entry',
                    icon: 'arrow-right',
                    exit: 'exit',
                    action: 'scimax.journal.nextEntry',
                },
                {
                    key: 'v',
                    label: 'Week View',
                    description: 'View entries for the week',
                    icon: 'calendar',
                    exit: 'exit',
                    action: 'scimax.journal.weekView',
                },
            ],
        },
        {
            title: 'Create & Search',
            items: [
                {
                    key: 'c',
                    label: 'New Entry',
                    description: 'Create new entry with template',
                    icon: 'new-file',
                    exit: 'exit',
                    action: 'scimax.journal.new',
                },
                {
                    key: 's',
                    label: 'Search',
                    description: 'Search journal entries',
                    icon: 'search',
                    exit: 'exit',
                    action: 'scimax.journal.search',
                },
            ],
        },
        {
            title: 'Insert',
            items: [
                {
                    key: 'h',
                    label: 'Insert Heading',
                    description: 'Insert timestamped heading',
                    icon: 'list-tree',
                    exit: 'exit',
                    action: 'scimax.journal.insertHeading',
                },
            ],
        },
    ],
};
