/**
 * Version Control Menu - git operations (scimax-version-control hydra)
 */

import { HydraMenuDefinition } from '../types';

export const vcMenu: HydraMenuDefinition = {
    id: 'scimax.vc',
    title: 'Version Control',
    hint: 'Git operations for the current file (or dired marks) and repository',
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
                    description: 'Stage the file (or the dired marks); unstage if already staged',
                    icon: 'add',
                    exit: 'exit',
                    action: 'scimax.vc.stage',
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
                {
                    key: 'm',
                    label: 'Merge conflicts',
                    description: 'Resolve conflict blocks in this file (smerge)',
                    icon: 'git-merge',
                    exit: 'submenu',
                    action: 'scimax.conflicts',
                },
                {
                    key: 'i',
                    label: 'Ignore',
                    description: 'Add the file to .gitignore',
                    icon: 'eye-closed',
                    exit: 'exit',
                    action: 'scimax.vc.ignore',
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
                    action: 'scimax.vc.git',
                    args: ['git.commit'],
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
                    action: 'scimax.vc.git',
                    args: ['git.fetch'],
                },
                {
                    key: 'b',
                    label: 'Branch',
                    description: 'Create a branch',
                    icon: 'git-branch',
                    exit: 'exit',
                    action: 'scimax.vc.git',
                    args: ['git.branch'],
                },
                {
                    key: 'k',
                    label: 'Checkout',
                    description: 'Switch branches',
                    icon: 'git-compare',
                    exit: 'exit',
                    action: 'scimax.vc.git',
                    args: ['git.checkout'],
                },
                {
                    key: 'v',
                    label: 'Status',
                    description: 'Repository status (edamagit or Source Control)',
                    icon: 'source-control',
                    exit: 'exit',
                    action: 'scimax.vc.status',
                },
                {
                    key: 'D',
                    label: 'Changed files',
                    description: 'The repository\'s changed files in dired (vc-dir)',
                    icon: 'list-unordered',
                    exit: 'exit',
                    action: 'scimax.vc.dir',
                },
            ],
        },
    ],
};

const stay = (key: string, label: string, description: string, icon: string, action: string) =>
    ({ key, label, description, icon, exit: 'stay' as const, action });

/**
 * Conflicts Menu - resolve git conflict blocks (smerge-mode). The keys match
 * smerge mode's single keys at a marker line and the C-c ^ prefix.
 */
export const conflictsMenu: HydraMenuDefinition = {
    id: 'scimax.conflicts',
    title: 'Merge Conflicts',
    hint: 'Keep mine, theirs or both for each conflict block',
    parent: 'scimax.vc',
    groups: [
        {
            title: 'Move',
            items: [
                stay('n', 'Next conflict', 'Go to the next conflict block', 'arrow-down', 'scimax.smerge.next'),
                stay('p', 'Previous conflict', 'Go to the previous conflict block', 'arrow-up', 'scimax.smerge.previous'),
            ],
        },
        {
            title: 'Keep',
            items: [
                stay('m', 'Mine', 'Keep my side (above =======), then go to the next conflict', 'arrow-left', 'scimax.smerge.keepMine'),
                stay('t', 'Theirs', 'Keep their side (below =======), then go to the next conflict', 'arrow-right', 'scimax.smerge.keepTheirs'),
                stay('b', 'Both', 'Keep both sides, mine first', 'arrow-both', 'scimax.smerge.keepBoth'),
                stay('B', 'Base', 'Keep the common ancestor (diff3 conflicts)', 'history', 'scimax.smerge.keepBase'),
                stay('M', 'All mine', 'Keep my side of every conflict in the file', 'check-all', 'scimax.smerge.keepAllMine'),
                stay('T', 'All theirs', 'Keep their side of every conflict in the file', 'check-all', 'scimax.smerge.keepAllTheirs'),
            ],
        },
        {
            title: 'Look',
            items: [
                stay('=', 'Compare', 'Diff mine against theirs for this conflict', 'diff', 'scimax.smerge.compare'),
                {
                    key: 'e',
                    label: 'Merge editor',
                    description: 'Open the file in the 3-way merge editor',
                    icon: 'git-merge',
                    exit: 'exit',
                    action: 'scimax.smerge.mergeEditor',
                },
            ],
        },
    ],
};
