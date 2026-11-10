import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));
vi.mock('../../database/lazyDb', () => ({ getDatabase: vi.fn() }));
vi.mock('../speedCommands/metadata', () => ({ setPropertyValue: vi.fn() }));
vi.mock('../speedCommands/context', () => ({ getHeadingLevel: vi.fn() }));

import { hasOwnPersonTag, toPeople } from '../people';
import type { HeadingRecord } from '../../database/scimaxDbCore';

function row(title: string, tags: string[], inherited: string[], props: Record<string, string> = {}): HeadingRecord {
    return {
        title, tags: JSON.stringify(tags), inherited_tags: JSON.stringify(inherited),
        properties: JSON.stringify(props), file_path: '/n/people.org', line_number: 1,
    } as unknown as HeadingRecord;
}

describe('people', () => {
    it('keeps only headings that carry :person: themselves', () => {
        const people = toPeople([
            row('Ana Ramirez :person:', ['person'], [], { EMAIL: 'ana@x.org' }),
            row('Meeting notes', [], ['person']),
            row('Bo :Person:', ['Person'], []),
        ]);
        expect(people.map(p => p.name)).toEqual(['Ana Ramirez', 'Bo']);
        expect(people[0].email).toBe('ana@x.org');
    });

    it('reads own tags defensively', () => {
        expect(hasOwnPersonTag('not json')).toBe(false);
        expect(hasOwnPersonTag(undefined)).toBe(false);
        expect(hasOwnPersonTag('["x","person"]')).toBe(true);
    });
});
