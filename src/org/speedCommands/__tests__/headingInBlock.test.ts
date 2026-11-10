import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));
import { isAtHeadingStart, orgLineInBlock } from '../context';

const lines = [
    '* Real heading',          // 0
    '#+begin_src sh',          // 1
    'cat > a.org <<EOF',       // 2
    '* Inside src',            // 3
    'EOF',                     // 4
    '#+end_src',               // 5
    '* After the block',       // 6
    '#+BEGIN_EXAMPLE',         // 7
    '** Inside example',       // 8
    '#+END_EXAMPLE',           // 9
    '#+begin_src python',      // 10  never closed
    '* After an unclosed begin', // 11
];
const inBlock = (n: number) => orgLineInBlock(i => lines[i], lines.length, n);

function doc(languageId = 'org') {
    return {
        languageId,
        lineCount: lines.length,
        lineAt: (i: number) => ({ text: lines[i] }),
    } as any;
}

describe('headings inside org blocks', () => {
    it('knows which lines are between #+begin_ and its #+end_', () => {
        expect(inBlock(3)).toBe(true);
        expect(inBlock(8)).toBe(true);
        expect(inBlock(0)).toBe(false);
        expect(inBlock(6)).toBe(false);
        expect(inBlock(11)).toBe(false);
    });

    it('turns off speed commands on `* lines` inside a block only', () => {
        const at = (line: number) => isAtHeadingStart(doc(), { line, character: 0 } as any);
        expect(at(0)).toBe(true);
        expect(at(3)).toBe(false);
        expect(at(6)).toBe(true);
        expect(at(8)).toBe(false);
        expect(at(11)).toBe(true);
    });
});
