/**
 * Version Control Menu - git operations (scimax-version-control hydra)
 */

import { HydraMenuDefinition } from '../types';

export const vcMenu: HydraMenuDefinition = {
    id: 'scimax.vc',
    title: 'Version Control',
    hint: 'Git operations for the current file and repository',
    parent: 'scimax.main',
    groups: [
        {
            title: 'File',
            items: [
                {
                    key: 'n',
                    label: 'Next Action',
                    description: 'Register, commit, resolve, or sync this file',
                    icon: 'arrow-right',
                    exit: 'exit',
                    action: 'scimax.vc.nextAction',
                },
                {
                    key: 's',
                    label: 'Stage',
                    description: 'Stage the current file',
                    icon: 'add',
                    exit: 'exit',
                    action: 'git.stage',
                },
                {
                    key: 'd',
                    label: 'Diff',
                    description: 'Diff the file against HEAD',
                    icon: 'diff',
                    exit: 'exit',
                    action: 'scimax.vc.diff',
                },
                {
                    key: 'l',
                    label: 'Log',
                    description: 'History of the current file',
                    icon: 'history',
                    exit: 'exit',
                    action: 'scimax.vc.log',
                },
                {
                    key: 'r',
                    label: 'Revert',
                    description: 'Discard changes to the file',
                    icon: 'discard',
                    exit: 'exit',
                    action: 'scimax.vc.revert',
                },
                {
                    key: 'g',
                    label: 'Blame',
                    description: 'Toggle line-by-line blame',
                    icon: 'person',
                    exit: 'exit',
                    action: 'scimax.vc.annotate',
                },
            ],
        },
        {
            title: 'Repository',
            items: [
                {
                    key: 'c',
                    label: 'Commit',
                    description: 'Commit staged changes (Source Control)',
                    icon: 'check',
                    exit: 'exit',
                    action: 'git.commit',
                },
                {
                    key: 'p',
                    label: 'Push',
                    description: 'Push the current branch',
                    icon: 'cloud-upload',
                    exit: 'exit',
                    action: 'scimax.vc.push',
                },
                {
                    key: 'u',
                    label: 'Pull',
                    description: 'Pull the current branch',
                    icon: 'cloud-download',
                    exit: 'exit',
                    action: 'scimax.vc.pull',
                },
                {
                    key: 'f',
                    label: 'Fetch',
                    description: 'Fetch from remotes',
                    icon: 'sync',
                    exit: 'exit',
                    action: 'git.fetch',
                },
                {
                    key: 'b',
                    label: 'Branch',
                    description: 'Create a branch',
                    icon: 'git-branch',
                    exit: 'exit',
                    action: 'git.branch',
                },
                {
                    key: 'k',
                    label: 'Checkout',
                    description: 'Switch branches',
                    icon: 'git-compare',
                    exit: 'exit',
                    action: 'git.checkout',
                },
                {
                    key: 'v',
                    label: 'Status',
                    description: 'Repository status (edamagit or Source Control)',
                    icon: 'source-control',
                    exit: 'exit',
                    action: 'scimax.vc.status',
                },
            ],
        },
    ],
};
