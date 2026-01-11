/**
 * References Menu - Bibliography management operations
 */

import { HydraMenuDefinition } from '../types';

export const referencesMenu: HydraMenuDefinition = {
    id: 'scimax.references',
    title: 'References',
    hint: 'Bibliography and citation management',
    parent: 'scimax.main',
    groups: [
        {
            title: 'Citations',
            items: [
                {
                    key: 'c',
                    label: 'Insert Citation',
                    description: 'Search and insert a citation',
                    icon: 'quote',
                    exit: 'exit',
                    action: 'scimax.ref.insertCitation',
                },
                {
                    key: 'o',
                    label: 'Open Entry',
                    description: 'Open a bibliography entry',
                    icon: 'book',
                    exit: 'exit',
                    action: 'scimax.ref.openEntry',
                },
                {
                    key: 'u',
                    label: 'Open URL',
                    description: 'Open URL for reference',
                    icon: 'link-external',
                    exit: 'exit',
                    action: 'scimax.ref.openUrl',
                },
            ],
        },
        {
            title: 'Add References',
            items: [
                {
                    key: 'd',
                    label: 'Fetch from DOI',
                    description: 'Add entry from DOI',
                    icon: 'cloud-download',
                    exit: 'exit',
                    action: 'scimax.ref.fetchFromDOI',
                },
                {
                    key: 'b',
                    label: 'Fetch from BibTeX',
                    description: 'Add entry from BibTeX string',
                    icon: 'file-code',
                    exit: 'exit',
                    action: 'scimax.ref.fetchFromBibtex',
                },
                {
                    key: 'n',
                    label: 'New Entry',
                    description: 'Create new bibliography entry',
                    icon: 'new-file',
                    exit: 'exit',
                    action: 'scimax.ref.newEntry',
                },
            ],
        },
        {
            title: 'Search',
            items: [
                {
                    key: 's',
                    label: 'Search References',
                    description: 'Search bibliography',
                    icon: 'search',
                    exit: 'exit',
                    action: 'scimax.ref.searchReferences',
                },
                {
                    key: 'w',
                    label: 'Citing Works',
                    description: 'Find works citing this reference',
                    icon: 'references',
                    exit: 'exit',
                    action: 'scimax.ref.showCitingWorks',
                },
                {
                    key: 'r',
                    label: 'Related Works',
                    description: 'Find related works',
                    icon: 'git-compare',
                    exit: 'exit',
                    action: 'scimax.ref.showRelatedWorks',
                },
            ],
        },
        {
            title: 'Citation Actions',
            items: [
                {
                    key: 'a',
                    label: 'Citation Actions',
                    description: 'Actions for citation at point',
                    icon: 'wand',
                    exit: 'exit',
                    action: 'scimax.ref.citationActions',
                },
            ],
        },
        {
            title: 'Management',
            items: [
                {
                    key: 'l',
                    label: 'Reload Bibliography',
                    description: 'Reload all bibliography files',
                    icon: 'refresh',
                    exit: 'exit',
                    action: 'scimax.ref.reload',
                },
            ],
        },
    ],
};
