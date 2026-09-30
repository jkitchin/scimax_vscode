import { describe, it, expect } from 'vitest';
import {
    absolutizeLinks, assetTargets, isInside, numberedName, planAssetCopies, relativizeLinks,
} from '../slideLinks';

const lines = (...l: string[]) => l.join('\n');

describe('absolutizeLinks', () => {
    it('makes Markdown images and links absolute', () => {
        const text = lines('![bg left:40%](figs/a.png)', '[paper](../docs/p.pdf "Title")', '![](./b.png)');
        expect(absolutizeLinks(text, '/talks/one')).toBe(lines(
            '![bg left:40%](/talks/one/figs/a.png)',
            '[paper](/talks/docs/p.pdf "Title")',
            '![](/talks/one/b.png)',
        ));
    });

    it('handles HTML attributes, CSS url() and reference definitions', () => {
        const text = lines(
            '<img src="figs/a.png" width="200"><video poster=\'p.jpg\'></video>',
            '<!-- _backgroundImage: url(bg.png) -->',
            '<style scoped>section { background: url("x y.png"); }</style>',
            '[logo]: figs/logo.svg',
        );
        expect(absolutizeLinks(text, '/d')).toBe(lines(
            '<img src="/d/figs/a.png" width="200"><video poster=\'/d/p.jpg\'></video>',
            '<!-- _backgroundImage: url(/d/bg.png) -->',
            '<style scoped>section { background: url("/d/x y.png"); }</style>',
            '[logo]: /d/figs/logo.svg',
        ));
    });

    it('keeps URLs, anchors, absolute paths and code', () => {
        const text = lines(
            '![](https://example.com/a.png) ![](data:image/png;base64,AA) [x](#top) ![](/abs/a.png)',
            'Use `![](a.png)` for images.',
            '```markdown',
            '![](a.png)',
            '```',
        );
        expect(absolutizeLinks(text, '/d')).toBe(text);
    });

    it('decodes and re-encodes spaces', () => {
        expect(absolutizeLinks('![](my%20fig.png) ![](<other fig.png>)', '/d'))
            .toBe('![](/d/my%20fig.png) ![](</d/other fig.png>)');
    });

    it('keeps a fragment', () => {
        expect(absolutizeLinks('![](icons.svg#star)', '/d')).toBe('![](/d/icons.svg#star)');
    });
});

describe('relativizeLinks', () => {
    it('round trips within the same folder', () => {
        const text = lines('![bg](figs/a.png)', '<img src="../shared/logo.png">', '![](my%20fig.png)');
        expect(relativizeLinks(absolutizeLinks(text, '/talks/one'), '/talks/one')).toBe(text);
    });

    it('rebases onto another folder', () => {
        const clip = absolutizeLinks('![bg](figs/a.png)', '/talks/one');
        expect(relativizeLinks(clip, '/talks/two')).toBe('![bg](../one/figs/a.png)');
    });

    it('points at copies', () => {
        const clip = absolutizeLinks('![bg](figs/a.png)', '/talks/one');
        const moved = new Map([['/talks/one/figs/a.png', '/talks/two/figs/a-1.png']]);
        expect(relativizeLinks(clip, '/talks/two', moved)).toBe('![bg](figs/a-1.png)');
    });
});

describe('assets', () => {
    it('lists shown files, not links', () => {
        const clip = absolutizeLinks(lines('![](a.png) [pdf](p.pdf)', '<!-- _backgroundImage: url(a.png) -->'), '/d');
        expect(assetTargets(clip)).toEqual(['/d/a.png']);
    });

    it('plans copies next to the target deck', () => {
        const plan = planAssetCopies(['/one/figs/a.png', '/shared/logo.png', '/two/figs/b.png'], '/two', '/one');
        expect([...plan]).toEqual([
            ['/one/figs/a.png', '/two/figs/a.png'],
            ['/shared/logo.png', '/two/figs/logo.png'],
        ]);
    });

    it('names alternatives and tests containment', () => {
        expect(numberedName('/d/figs/a.png', 2)).toBe('/d/figs/a-2.png');
        expect(isInside('/d/figs/a.png', '/d')).toBe(true);
        expect(isInside('/dx/a.png', '/d')).toBe(false);
    });
});
