import { describe, it, expect, vi } from 'vitest';

const { openMailto, openExternal } = vi.hoisted(() => ({
    openMailto: vi.fn(async (_url: string) => true),
    openExternal: vi.fn(async () => true),
}));

vi.mock('vscode', () => ({
    env: { openExternal },
    Uri: { parse: (s: string) => ({ toString: () => s }) },
    Disposable: class { dispose() { /* none */ } },
}));
vi.mock('../../org/mail', () => ({ openMailto }));

import { mailtoFollowHandler } from '../linkFollowAdapter';

describe('mailtoFollowHandler', () => {
    it('composes through the configured mail client, not the system mail app', async () => {
        await mailtoFollowHandler.follow('mailto:me+tag@x.org?subject=Hi', {} as never);
        expect(openMailto).toHaveBeenCalledWith('mailto:me+tag@x.org?subject=Hi');
        expect(openExternal).not.toHaveBeenCalled();
    });

    it('accepts a path without the mailto: prefix', async () => {
        openMailto.mockClear();
        await mailtoFollowHandler.follow('a@b.org', {} as never);
        expect(openMailto).toHaveBeenCalledWith('mailto:a@b.org');
    });
});
