/**
 * File Menu - Find, open, and manage the current file (F12 f)
 */

import { HydraMenuDefinition } from '../types';

export const fileMenu: HydraMenuDefinition = {
    id: 'scimax.files',
    title: 'Files',
    hint: 'Find, open and manage files',
    parent: 'scimax.main',
    groups: [
        {
            title: 'Find',
            items: [
                {
                    key: 'f',
                    label: 'Find file',
                    description: 'Find a file from the current folder',
                    icon: 'go-to-file',
                    exit: 'exit',
                    action: 'scimax.findFile',
                },
                {
                    key: 'w',
                    label: 'Find file in workspace',
                    description: 'Find a file from the workspace root',
                    icon: 'root-folder',
                    exit: 'exit',
                    action: 'scimax.findFileWorkspace',
                },
                {
                    key: 'r',
                    label: 'Recent files',
                    description: 'Search recently opened files',
                    icon: 'history',
                    exit: 'exit',
                    action: 'scimax.fuzzySearchRecentFiles',
                },
                {
                    key: 'd',
                    label: 'Dired here',
                    description: 'Open Dired in the current file\'s folder',
                    icon: 'file-directory',
                    exit: 'exit',
                    action: 'scimax.dired.openCurrent',
                },
            ],
        },
        {
            title: 'Open outside VS Code',
            items: [
                {
                    key: 'o',
                    label: 'Reveal in Finder',
                    description: 'Show the current file in the system file manager',
                    icon: 'folder-opened',
                    exit: 'exit',
                    action: 'revealFileInOS',
                },
                {
                    key: 't',
                    label: 'External terminal here',
                    description: 'Open the system terminal in the current file\'s folder',
                    icon: 'terminal',
                    exit: 'exit',
                    action: 'scimax.openExternalTerminalHere',
                },
                {
                    key: 'e',
                    label: 'Open in default app',
                    description: 'Open the current file in its default application',
                    icon: 'link-external',
                    exit: 'exit',
                    action: 'scimax.file.openInDefaultApp',
                },
            ],
        },
        {
            title: 'This file',
            items: [
                {
                    key: 'c',
                    label: 'Copy path',
                    description: 'Copy the full path of the current file',
                    icon: 'copy',
                    exit: 'exit',
                    action: 'copyFilePath',
                },
                {
                    key: 'C',
                    label: 'Copy relative path',
                    description: 'Copy the path relative to the workspace',
                    icon: 'copy',
                    exit: 'exit',
                    action: 'copyRelativeFilePath',
                },
                {
                    key: 'i',
                    label: 'Insert file',
                    description: 'Insert another file\'s contents at the cursor',
                    icon: 'insert',
                    exit: 'exit',
                    action: 'scimax.insertFile',
                },
                {
                    key: 'R',
                    label: 'Rename file',
                    description: 'Rename or move the current file',
                    icon: 'edit',
                    exit: 'exit',
                    action: 'scimax.file.rename',
                },
                {
                    key: 'D',
                    label: 'Delete file',
                    description: 'Move the current file to the trash (asks first)',
                    icon: 'trash',
                    exit: 'exit',
                    action: 'scimax.file.delete',
                },
            ],
        },
    ],
};
