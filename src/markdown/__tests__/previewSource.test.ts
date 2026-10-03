import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { previewLabelShows } from '../previewSource';

describe('previewLabelShows', () => {
    it('matches the preview and locked preview labels', () => {
        expect(previewLabelShows('Preview notes.md', 'notes.md')).toBe(true);
        expect(previewLabelShows('[Preview] notes.md', 'notes.md')).toBe(true);
        expect(previewLabelShows('Vorschau notes.md', 'notes.md')).toBe(true);
    });

    it('does not match a file whose name only ends the same way', () => {
        expect(previewLabelShows('Preview data.md', 'a.md')).toBe(false);
        expect(previewLabelShows('Preview notes.md', 'other.md')).toBe(false);
    });
});
