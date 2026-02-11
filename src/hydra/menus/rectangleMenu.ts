/**
 * Rectangle Menu - Emacs-style rectangle editing commands
 */

import { HydraMenuDefinition } from '../types';

export const rectangleMenu: HydraMenuDefinition = {
    id: 'scimax.rectangle',
    title: 'Rectangle',
    hint: 'Rectangle editing commands (C-x r ...)',
    parent: 'scimax.main',
    groups: [
        {
            title: 'Kill / Copy',
            items: [
                {
                    key: 'k',
                    label: 'Kill',
                    description: 'Kill rectangle and save',
                    icon: 'close',
                    exit: 'exit',
                    action: 'scimax.rectangle.kill',
                },
                {
                    key: 'w',
                    label: 'Copy',
                    description: 'Copy rectangle (no delete)',
                    icon: 'copy',
                    exit: 'exit',
                    action: 'scimax.rectangle.copy',
                },
                {
                    key: 'd',
                    label: 'Delete',
                    description: 'Delete rectangle (no save)',
                    icon: 'trash',
                    exit: 'exit',
                    action: 'scimax.rectangle.delete',
                },
                {
                    key: 'y',
                    label: 'Yank',
                    description: 'Yank last killed rectangle',
                    icon: 'clippy',
                    exit: 'exit',
                    action: 'scimax.rectangle.yank',
                },
            ],
        },
        {
            title: 'Modify',
            items: [
                {
                    key: 'o',
                    label: 'Open',
                    description: 'Insert blank space in rectangle',
                    icon: 'insert',
                    exit: 'exit',
                    action: 'scimax.rectangle.open',
                },
                {
                    key: 'c',
                    label: 'Clear',
                    description: 'Replace rectangle with spaces',
                    icon: 'whitespace',
                    exit: 'exit',
                    action: 'scimax.rectangle.clear',
                },
                {
                    key: 'n',
                    label: 'Number Lines',
                    description: 'Insert line numbers',
                    icon: 'list-ordered',
                    exit: 'exit',
                    action: 'scimax.rectangle.numberLines',
                },
                {
                    key: 't',
                    label: 'String',
                    description: 'Replace rectangle with string',
                    icon: 'symbol-string',
                    exit: 'exit',
                    action: 'scimax.rectangle.string',
                },
            ],
        },
    ],
};
