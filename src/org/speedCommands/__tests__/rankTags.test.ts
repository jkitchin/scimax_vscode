import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));
vi.mock('../../../database/lazyDb', () => ({ getDatabase: async () => undefined }));

import { rankTags } from '../metadata';

const tags = ['paper', 'project', 'Work', 'work', 'workshop', 'homework'];

describe('rankTags', () => {
    it('puts the exact tag first, then prefixes, then other substrings', () => {
        expect(rankTags('work', tags)).toEqual(['work', 'Work', 'workshop', 'homework']);
    });

    it('matches case-insensitively, in list order within a rank', () => {
        expect(rankTags('P', tags)).toEqual(['paper', 'project', 'workshop']);
        expect(rankTags('proj', tags)).toEqual(['project']);
    });

    it('ignores surrounding colons and spaces', () => {
        expect(rankTags(' :paper: ', tags)).toEqual(['paper']);
    });

    it('leaves out tags that only have the letters in order', () => {
        // p..r..j appear in order in "project", but not together.
        expect(rankTags('prj', tags)).toEqual([]);
    });

    it('matches nothing with no filter typed', () => {
        expect(rankTags('', tags)).toEqual([]);
    });
});
