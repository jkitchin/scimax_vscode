import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
    absolutizeLinks, assetTargets, isInside, numberedName, planAssetCopies, relativizeLinks,
} from '../slideLinks';

const lines = (...l: string[]) => l.join('\n');
/** A POSIX-style absolute path as this platform resolves it (`D:\d\a.png` on Windows). */
const abs = (p: string) => path.resolve(p);
/** The same path as written into slide Markdown, with forward slashes. */
const md = (p: string) => abs(p).split(path.sep).join('/');

describe('absolutizeLinks', () => {
    it('makes Markdown images and links absolute', () => {
        const text = lines('![bg left:40%](figs/a.png)', '[paper](../docs/p.pdf "Title")', '![](./b.png)');
        expect(absolutizeLinks(text, '/talks/one')).toBe(lines(
            `![bg left:40%](${md('/talks/one/figs/a.png')})`,
            `[paper](${md('/talks/docs/p.pdf')} "Title")`,
            `![](${md('/talks/one/b.png')})`,
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
            `<img src="${md('/d/figs/a.png')}" width="200"><video poster='${md('/d/p.jpg')}'></video>`,
            `<!-- _backgroundImage: url(${md('/d/bg.png')}) -->`,
            `<style scoped>section { background: url("${md('/d/x y.png')}"); }</style>`,
            `[logo]: ${md('/d/figs/logo.svg')}`,
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
            .toBe(`![](${md('/d/my fig.png').replace(/ /g, '%20')}) ![](<${md('/d/other fig.png')}>)`);
    });

    it('keeps a fragment', () => {
        expect(absolutizeLinks('![](icons.svg#star)', '/d')).toBe(`![](${md('/d/icons.svg')}#star)`);
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
        const moved = new Map([[abs('/talks/one/figs/a.png'), abs('/talks/two/figs/a-1.png')]]);
        expect(relativizeLinks(clip, '/talks/two', moved)).toBe('![bg](figs/a-1.png)');
    });
});

describe('assets', () => {
    it('lists shown files, not links', () => {
        const clip = absolutizeLinks(lines('![](a.png) [pdf](p.pdf)', '<!-- _backgroundImage: url(a.png) -->'), '/d');
        expect(assetTargets(clip)).toEqual([abs('/d/a.png')]);
    });

    it('plans copies next to the target deck', () => {
        const plan = planAssetCopies(
            [abs('/one/figs/a.png'), abs('/shared/logo.png'), abs('/two/figs/b.png')], abs('/two'), abs('/one'));
        expect([...plan]).toEqual([
            [abs('/one/figs/a.png'), abs('/two/figs/a.png')],
            [abs('/shared/logo.png'), abs('/two/figs/logo.png')],
        ]);
    });

    it('names alternatives and tests containment', () => {
        expect(numberedName('/d/figs/a.png', 2)).toBe('/d/figs/a-2.png');
        expect(isInside('/d/figs/a.png', '/d')).toBe(true);
        expect(isInside('/dx/a.png', '/d')).toBe(false);
    });
});
