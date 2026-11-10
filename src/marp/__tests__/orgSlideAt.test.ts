import { describe, it, expect } from 'vitest';
import { orgSlideNumber } from '../orgSlideAt';
import { exportToMarp } from '../../parser/orgExportMarp';
import { slideStarts } from '../slideRenderer';

const org = [
    '#+TITLE: Talk',            // 0
    '',                         // 1
    '* Intro',                  // 2
    'Hello',                    // 3
    '** Detail',                // 4
    'more',                     // 5
    '* Skipped  :noexport:',    // 6
    'gone',                     // 7
    '* Methods',                // 8
    'text',                     // 9
    '-----',                    // 10
    'after the break',          // 11
    '* Results',                // 12
].join('\n');

const at = (line: number) => orgSlideNumber(org, line, text => exportToMarp(text));

describe('orgSlideNumber', () => {
    it('counts the title slide and heading slides up to the cursor', () => {
        expect(at(0)).toBe(1);   // title slide
        expect(at(2)).toBe(2);   // Intro
        expect(at(3)).toBe(2);
        expect(at(5)).toBe(3);   // ** is a slide at the default headingDivider 2
        expect(at(7)).toBe(3);   // inside a noexport subtree: the slide before it
        expect(at(8)).toBe(4);   // noexport subtree adds no slide
        expect(at(11)).toBe(5);  // ----- starts a slide
        expect(at(12)).toBe(6);
        expect(at(99)).toBe(6);
    });

    it('matches the slide count of the full deck', () => {
        const deck = exportToMarp(org);
        expect(deck).toContain('# Results');
        expect(at(12)).toBe(slideStarts(deck).length);
    });

    it('counts only shown slides before the cursor', () => {
        const hiding = (text: string) => exportToMarp(text).replace('# Intro', '<!-- scimax-hidden\n# Intro').replace('\nHello\n', '\nHello\nscimax-hidden -->\n');
        expect(orgSlideNumber(org, 9, hiding)).toBe(3);
    });
});
