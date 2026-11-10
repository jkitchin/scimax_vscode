import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';

vi.mock('vscode', () => ({}));

import { isInsideAny } from '../openDocs';

describe('isInsideAny', () => {
    const root = path.resolve('/work/notes');
    it('matches the target itself and files below a deleted folder', () => {
        expect(isInsideAny(root, [root])).toBe(true);
        expect(isInsideAny(path.join(root, 'a.org'), [root])).toBe(true);
        expect(isInsideAny(path.join(root, 'sub', 'b.org'), [root])).toBe(true);
    });
    it('does not match siblings with the same prefix or parents', () => {
        expect(isInsideAny(root + '-old/a.org', [root])).toBe(false);
        expect(isInsideAny(path.dirname(root), [root])).toBe(false);
        expect(isInsideAny(path.join(root, 'a.org'), [])).toBe(false);
    });
});
