/**
 * Jump Menu - Avy-style quick navigation
 */

import { HydraMenuDefinition } from '../types';

export const jumpMenu: HydraMenuDefinition = {
    id: 'scimax.jump',
    title: 'Jump (Avy)',
    hint: 'Quick navigation with character hints',
    parent: 'scimax.main',
    groups: [
        {
            title: 'Jump to Character',
            items: [
                {
                    key: 'c',
                    label: 'Jump to Char',
                    description: 'Jump to a character',
                    icon: 'debug-step-into',
                    exit: 'exit',
                    action: 'scimax.jump.char',
                },
                {
                    key: '2',
                    label: 'Jump to 2 Chars',
                    description: 'Jump to two characters',
                    icon: 'debug-step-into',
                    exit: 'exit',
                    action: 'scimax.jump.char2',
                },
            ],
        },
        {
            title: 'Jump to Word',
            items: [
                {
                    key: 'w',
                    label: 'Jump to Word',
                    description: 'Jump to start of word',
                    icon: 'symbol-text',
                    exit: 'exit',
                    action: 'scimax.jump.word',
                },
            ],
        },
        {
            title: 'Jump to Line',
            items: [
                {
                    key: 'l',
                    label: 'Jump to Line',
                    description: 'Jump to a line',
                    icon: 'list-ordered',
                    exit: 'exit',
                    action: 'scimax.jump.line',
                },
                {
                    key: 'a',
                    label: 'Jump Above',
                    description: 'Jump to line above cursor',
                    icon: 'arrow-up',
                    exit: 'exit',
                    action: 'scimax.jump.lineAbove',
                },
                {
                    key: 'b',
                    label: 'Jump Below',
                    description: 'Jump to line below cursor',
                    icon: 'arrow-down',
                    exit: 'exit',
                    action: 'scimax.jump.lineBelow',
                },
            ],
        },
    ],
};
