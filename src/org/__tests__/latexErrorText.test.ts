import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { latexErrorText } from '../latexPreviewProvider';

describe('latexErrorText', () => {
    it('takes the TeX error from stdout, where TeX writes it', () => {
        const stdout = [
            'This is pdfTeX, Version 3.141592653',
            '(./equation.tex',
            '! Missing $ inserted.',
            '<inserted text> ',
            '                $',
            'l.12 ',
            '     ',
            'No pages of output.',
        ].join('\n');
        const text = latexErrorText({ stdout, stderr: '' });
        expect(text.startsWith('! Missing $ inserted.')).toBe(true);
        expect(text).toContain('l.12');
        expect(text).not.toContain('No pages of output');
    });
    it('falls back to stderr when TeX did not run', () => {
        expect(latexErrorText({ stdout: '', stderr: 'spawn latex ENOENT' })).toBe('spawn latex ENOENT');
    });
});
