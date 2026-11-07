import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { isTooBroadForProject } from '../projectRoots';

const home = path.resolve('/Users/alice');

describe('isTooBroadForProject', () => {
    it('rejects the home directory', () => {
        expect(isTooBroadForProject(home, home)).toBe(true);
        expect(isTooBroadForProject(home + path.sep, home)).toBe(true);
    });

    it('rejects ancestors of home', () => {
        expect(isTooBroadForProject(path.resolve('/Users'), home)).toBe(true);
        expect(isTooBroadForProject(path.resolve('/'), home)).toBe(true);
    });

    it('accepts folders inside home', () => {
        expect(isTooBroadForProject(path.join(home, 'Dropbox'), home)).toBe(false);
        expect(isTooBroadForProject(path.join(home, 'projects', 'scimax'), home)).toBe(false);
    });

    it('accepts unrelated folders and look-alike names', () => {
        expect(isTooBroadForProject(path.resolve('/Users/alice2'), home)).toBe(false);
        expect(isTooBroadForProject(path.resolve('/opt/notes'), home)).toBe(false);
    });
});
