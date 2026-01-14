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
                    action: 'scimax.jump.gotoChar',
                },
                {
                    key: '2',
                    label: 'Jump to 2 Chars',
                    description: 'Jump to two characters',
                    icon: 'debug-step-into',
                    exit: 'exit',
                    action: 'scimax.jump.gotoChar2',
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
                    action: 'scimax.jump.gotoWord',
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
                    action: 'scimax.jump.gotoLine',
                },
                {
                    key: 's',
                    label: 'Jump to Symbol',
                    description: 'Jump to symbol/heading',
                    icon: 'symbol-class',
                    exit: 'exit',
                    action: 'scimax.jump.gotoSymbol',
                },
                {
                    key: 'u',
                    label: 'Jump to Subword',
                    description: 'Jump to subword boundary',
                    icon: 'symbol-text',
                    exit: 'exit',
                    action: 'scimax.jump.gotoSubword',
                },
            ],
        },
    ],
};
