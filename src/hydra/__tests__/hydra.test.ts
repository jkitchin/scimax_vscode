/**
 * Tests for the Hydra Menu Framework
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HydraMenuDefinition, HydraMenuItem, HydraMenuGroup } from '../types';

// Mock VS Code API
vi.mock('vscode', () => ({
    window: {
        createQuickPick: vi.fn(() => ({
            title: '',
            placeholder: '',
            matchOnDescription: false,
            matchOnDetail: false,
            items: [],
            onDidChangeValue: vi.fn(),
            onDidAccept: vi.fn(),
            onDidHide: vi.fn(),
            show: vi.fn(),
            hide: vi.fn(),
            dispose: vi.fn(),
            selectedItems: [],
        })),
        showQuickPick: vi.fn(),
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
    },
    commands: {
        executeCommand: vi.fn(),
        registerCommand: vi.fn(),
    },
    workspace: {
        getConfiguration: vi.fn(() => ({
            get: vi.fn((key: string, defaultValue: unknown) => defaultValue),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    },
    EventEmitter: vi.fn(() => ({
        event: vi.fn(),
        fire: vi.fn(),
        dispose: vi.fn(),
    })),
    QuickPickItemKind: {
        Separator: -1,
        Default: 0,
    },
}));

describe('Hydra Types', () => {
    describe('HydraMenuItem', () => {
        it('should have required properties', () => {
            const item: HydraMenuItem = {
                key: 'a',
                label: 'Test Action',
                exit: 'exit',
                action: 'test.command',
            };

            expect(item.key).toBe('a');
            expect(item.label).toBe('Test Action');
            expect(item.exit).toBe('exit');
            expect(item.action).toBe('test.command');
        });

        it('should support optional properties', () => {
            const item: HydraMenuItem = {
                key: 'b',
                label: 'With Options',
                description: 'Description text',
                icon: 'search',
                exit: 'stay',
                action: async () => { /* async action */ },
                args: ['arg1', 'arg2'],
                when: () => true,
                isToggle: true,
                getToggleState: async () => true,
            };

            expect(item.description).toBe('Description text');
            expect(item.icon).toBe('search');
            expect(item.isToggle).toBe(true);
        });

        it('should support submenu exit behavior', () => {
            const item: HydraMenuItem = {
                key: 's',
                label: 'Submenu',
                exit: 'submenu',
                action: 'my.submenu.id',
            };

            expect(item.exit).toBe('submenu');
        });
    });

    describe('HydraMenuGroup', () => {
        it('should have items array', () => {
            const group: HydraMenuGroup = {
                items: [
                    { key: 'a', label: 'Item A', exit: 'exit', action: 'cmd.a' },
                    { key: 'b', label: 'Item B', exit: 'exit', action: 'cmd.b' },
                ],
            };

            expect(group.items).toHaveLength(2);
        });

        it('should support optional title and when', () => {
            const group: HydraMenuGroup = {
                title: 'My Group',
                items: [],
                when: () => true,
            };

            expect(group.title).toBe('My Group');
            expect(group.when?.()).toBe(true);
        });
    });

    describe('HydraMenuDefinition', () => {
        it('should have required properties', () => {
            const menu: HydraMenuDefinition = {
                id: 'test.menu',
                title: 'Test Menu',
                groups: [
                    {
                        items: [
                            { key: 'a', label: 'Action', exit: 'exit', action: 'test.action' },
                        ],
                    },
                ],
            };

            expect(menu.id).toBe('test.menu');
            expect(menu.title).toBe('Test Menu');
            expect(menu.groups).toHaveLength(1);
        });

        it('should support hierarchical menus', () => {
            const menu: HydraMenuDefinition = {
                id: 'child.menu',
                title: 'Child Menu',
                parent: 'parent.menu',
                showBack: true,
                groups: [],
            };

            expect(menu.parent).toBe('parent.menu');
            expect(menu.showBack).toBe(true);
        });

        it('should support lifecycle hooks', () => {
            const onShowSpy = vi.fn();
            const onHideSpy = vi.fn();

            const menu: HydraMenuDefinition = {
                id: 'hooks.menu',
                title: 'With Hooks',
                groups: [],
                onShow: onShowSpy,
                onHide: onHideSpy,
            };

            menu.onShow?.();
            menu.onHide?.();

            expect(onShowSpy).toHaveBeenCalled();
            expect(onHideSpy).toHaveBeenCalled();
        });
    });
});

describe('Menu Building', () => {
    it('should create a complete menu structure', () => {
        const menu: HydraMenuDefinition = {
            id: 'scimax.test',
            title: 'Test Menu',
            hint: 'Press a key to select',
            groups: [
                {
                    title: 'Navigation',
                    items: [
                        {
                            key: 'f',
                            label: 'Find File',
                            description: 'Open file picker',
                            icon: 'search',
                            exit: 'exit',
                            action: 'workbench.action.quickOpen',
                        },
                        {
                            key: 's',
                            label: 'Settings',
                            exit: 'submenu',
                            action: 'scimax.settings',
                        },
                    ],
                },
                {
                    title: 'Actions',
                    items: [
                        {
                            key: 'r',
                            label: 'Refresh',
                            exit: 'stay',
                            action: async () => console.log('refresh'),
                        },
                    ],
                },
            ],
        };

        expect(menu.groups).toHaveLength(2);
        expect(menu.groups[0].items).toHaveLength(2);
        expect(menu.groups[1].items).toHaveLength(1);
        expect(menu.groups[0].items[1].exit).toBe('submenu');
        expect(menu.groups[1].items[0].exit).toBe('stay');
    });

    it('should support conditional visibility', () => {
        let isEnabled = true;

        const item: HydraMenuItem = {
            key: 'x',
            label: 'Conditional',
            exit: 'exit',
            action: 'test.cmd',
            when: () => isEnabled,
        };

        expect(item.when?.()).toBe(true);

        isEnabled = false;
        expect(item.when?.()).toBe(false);
    });

    it('should support toggle items', async () => {
        let toggleState = false;

        const item: HydraMenuItem = {
            key: 't',
            label: 'Toggle Feature',
            exit: 'stay',
            action: () => { toggleState = !toggleState; },
            isToggle: true,
            getToggleState: () => toggleState,
        };

        expect(await item.getToggleState?.()).toBe(false);

        if (typeof item.action === 'function') {
            await item.action();
        }

        expect(await item.getToggleState?.()).toBe(true);
    });
});

describe('Exit Behaviors', () => {
    it('should distinguish exit behaviors', () => {
        const exitItem: HydraMenuItem = {
            key: 'e',
            label: 'Exit after',
            exit: 'exit',
            action: 'cmd',
        };

        const stayItem: HydraMenuItem = {
            key: 's',
            label: 'Stay open',
            exit: 'stay',
            action: 'cmd',
        };

        const submenuItem: HydraMenuItem = {
            key: 'm',
            label: 'Open submenu',
            exit: 'submenu',
            action: 'menu.id',
        };

        expect(exitItem.exit).toBe('exit');
        expect(stayItem.exit).toBe('stay');
        expect(submenuItem.exit).toBe('submenu');
    });
});

describe('Action Types', () => {
    it('should support string command actions', () => {
        const item: HydraMenuItem = {
            key: 'c',
            label: 'Command',
            exit: 'exit',
            action: 'scimax.journal.today',
            args: [new Date()],
        };

        expect(typeof item.action).toBe('string');
        expect(item.args).toHaveLength(1);
    });

    it('should support function actions', () => {
        const actionFn = vi.fn();

        const item: HydraMenuItem = {
            key: 'f',
            label: 'Function',
            exit: 'exit',
            action: actionFn,
        };

        expect(typeof item.action).toBe('function');

        if (typeof item.action === 'function') {
            item.action();
            expect(actionFn).toHaveBeenCalled();
        }
    });

    it('should support async function actions', async () => {
        const asyncAction = vi.fn().mockResolvedValue('done');

        const item: HydraMenuItem = {
            key: 'a',
            label: 'Async',
            exit: 'exit',
            action: asyncAction,
        };

        if (typeof item.action === 'function') {
            await item.action();
            expect(asyncAction).toHaveBeenCalled();
        }
    });
});

describe('Menu Hierarchy', () => {
    it('should support parent-child relationships', () => {
        const parentMenu: HydraMenuDefinition = {
            id: 'parent',
            title: 'Parent Menu',
            groups: [
                {
                    items: [
                        { key: 'c', label: 'Child', exit: 'submenu', action: 'child' },
                    ],
                },
            ],
        };

        const childMenu: HydraMenuDefinition = {
            id: 'child',
            title: 'Child Menu',
            parent: 'parent',
            showBack: true,
            groups: [],
        };

        expect(childMenu.parent).toBe(parentMenu.id);
        expect(childMenu.showBack).toBe(true);
    });

    it('should support deep nesting', () => {
        const level1: HydraMenuDefinition = { id: 'l1', title: 'Level 1', groups: [] };
        const level2: HydraMenuDefinition = { id: 'l2', title: 'Level 2', parent: 'l1', groups: [] };
        const level3: HydraMenuDefinition = { id: 'l3', title: 'Level 3', parent: 'l2', groups: [] };

        expect(level3.parent).toBe('l2');
        expect(level2.parent).toBe('l1');
        expect(level1.parent).toBeUndefined();
    });
});
