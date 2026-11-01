import { describe, it, expect } from 'vitest';
import { checkboxCookieEdits, replaceCookie, isCookieLine } from '../checkboxStatistics';

const apply = (content: string, line: number) => {
    const lines = content.split('\n');
    for (const e of checkboxCookieEdits(lines, line)) lines[e.line] = e.text;
    return lines.join('\n');
};

describe('Markdown checkbox statistics cookies', () => {
    it('updates the heading cookie', () => {
        const md = '## Checkboxes [0/3]\n- [x] task 1\n- [x] task 2\n- [ ] task 3\n';
        expect(apply(md, 1).split('\n')[0]).toBe('## Checkboxes [2/3]');
    });

    it('writes percentages', () => {
        const md = '# Tasks [0%]\n- [x] a\n- [ ] b\n';
        expect(apply(md, 2).split('\n')[0]).toBe('# Tasks [50%]');
    });

    it('stops at the next heading and skips fenced code', () => {
        const md = '## A [0/0]\n- [x] a\n```\n- [ ] not a box\n```\n## B\n- [ ] b\n';
        expect(apply(md, 1).split('\n')[0]).toBe('## A [1/1]');
    });

    it('counts direct children for a list item cookie, then the heading', () => {
        const md = [
            '## Plan [0/0]',
            '- [ ] parent [0/2]',
            '    - [x] child 1',
            '    - [ ] child 2',
            '        - [x] grandchild',
            '- [ ] other',
        ].join('\n');
        const out = apply(md, 2).split('\n');
        expect(out[1]).toBe('- [ ] parent [1/2]');
        expect(out[0]).toBe('## Plan [2/5]');
    });

    it('does not credit an earlier sibling item', () => {
        const md = '- a [0/1]\n  - [ ] x\n- b\n  - [x] y\n';
        expect(checkboxCookieEdits(md, 3)).toEqual([]);
    });

    it('recounts the cookie on the line itself', () => {
        const md = '## Done? [9/9]\n- [x] a\n- [ ] b\n';
        expect(apply(md, 0).split('\n')[0]).toBe('## Done? [1/2]');
        expect(isCookieLine('## Done? [9/9]')).toBe(true);
        expect(isCookieLine('Some text [1/2]')).toBe(false);
    });

    it('replaceCookie handles an empty list', () => {
        expect(replaceCookie('# X [3%]', 0, 0)).toBe('# X [0%]');
    });
});
