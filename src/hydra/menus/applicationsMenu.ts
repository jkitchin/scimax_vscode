/**
 * Applications Menu - Open external applications
 */

import { HydraMenuDefinition } from '../types';

export const applicationsMenu: HydraMenuDefinition = {
    id: 'scimax.applications',
    title: 'Applications',
    hint: 'Open external applications',
    parent: 'scimax.main',
    groups: [
        {
            title: 'External Applications',
            items: [
                {
                    key: 'a',
                    label: 'Agenda',
                    description: 'Show today\'s agenda',
                    icon: 'checklist',
                    exit: 'exit',
                    action: 'scimax.db.agenda',
                },
                {
                    key: 'b',
                    label: 'Bash Terminal',
                    description: 'Open external terminal at current file location',
                    icon: 'terminal',
                    exit: 'exit',
                    action: 'scimax.openExternalTerminalHere',
                },
                {
                    key: 'd',
                    label: 'Dired',
                    description: 'Open Dired in the current file\'s directory',
                    icon: 'file-directory',
                    exit: 'exit',
                    action: 'scimax.dired.openCurrent',
                },
                {
                    key: 'f',
                    label: 'Finder / File Manager',
                    description: 'Reveal current file in system file manager',
                    icon: 'folder-opened',
                    exit: 'exit',
                    action: 'scimax.revealInFileManager',
                },
            ],
        },
    ],
};
