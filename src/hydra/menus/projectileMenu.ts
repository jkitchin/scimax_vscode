/**
 * Projectile Menu - Project switching operations
 */

import { HydraMenuDefinition } from '../types';

export const projectileMenu: HydraMenuDefinition = {
    id: 'scimax.projectile',
    title: 'Projects (Projectile)',
    hint: 'Project management and switching',
    parent: 'scimax.main',
    groups: [
        {
            title: 'Switch',
            items: [
                {
                    key: 'p',
                    label: 'Switch Project',
                    description: 'Switch to another project',
                    icon: 'folder-opened',
                    exit: 'exit',
                    action: 'scimax.projectile.switch',
                },
            ],
        },
        {
            title: 'Manage',
            items: [
                {
                    key: 'a',
                    label: 'Add Project',
                    description: 'Add current folder as project',
                    icon: 'add',
                    exit: 'exit',
                    action: 'scimax.projectile.add',
                },
                {
                    key: 'r',
                    label: 'Remove Project',
                    description: 'Remove a project from list',
                    icon: 'remove',
                    exit: 'exit',
                    action: 'scimax.projectile.remove',
                },
                {
                    key: 's',
                    label: 'Scan for Projects',
                    description: 'Scan directories for projects',
                    icon: 'search',
                    exit: 'exit',
                    action: 'scimax.projectile.scan',
                },
            ],
        },
        {
            title: 'Files',
            items: [
                {
                    key: 'f',
                    label: 'Find File',
                    description: 'Find file in project',
                    icon: 'file-symlink-file',
                    exit: 'exit',
                    action: 'scimax.projectile.findFile',
                },
                {
                    key: 'g',
                    label: 'Search in Project',
                    description: 'Search text in project',
                    icon: 'search',
                    exit: 'exit',
                    action: 'scimax.projectile.searchInProject',
                },
            ],
        },
    ],
};
