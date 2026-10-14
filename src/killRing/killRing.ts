/**
 * Emacs-style kill ring (pure data structure, no VS Code dependency)
 *
 * Entries are stored newest first. The yank pointer names the entry the next
 * yank inserts; a new kill resets it to the head, and yank-pop rotates it
 * toward older entries, wrapping around at the end.
 */

export type KillMode = 'new' | 'append' | 'prepend';

export const DEFAULT_KILL_RING_SIZE = 120;

export class KillRing {
    private ring: string[] = [];
    private yankIndex = 0;

    constructor(private readonly maxSize: () => number = () => DEFAULT_KILL_RING_SIZE) {}

    get length(): number {
        return this.ring.length;
    }

    /** The newest entry (what the system clipboard should hold). */
    head(): string | undefined {
        return this.ring[0];
    }

    /** The entry under the yank pointer. */
    current(): string | undefined {
        return this.ring[this.yankIndex];
    }

    get pointer(): number {
        return this.yankIndex;
    }

    /** All entries, newest first. */
    entries(): readonly string[] {
        return this.ring;
    }

    /**
     * Add killed text. 'append' and 'prepend' join it onto the head entry
     * (consecutive kills), falling back to a new entry when the ring is empty.
     * Empty text is ignored. The yank pointer resets to the head.
     */
    push(text: string, mode: KillMode = 'new'): void {
        if (!text) return;
        if (mode !== 'new' && this.ring.length > 0) {
            this.ring[0] = mode === 'append' ? this.ring[0] + text : text + this.ring[0];
        } else {
            this.ring.unshift(text);
            const max = Math.max(1, this.maxSize());
            if (this.ring.length > max) this.ring.length = max;
        }
        this.yankIndex = 0;
    }

    /** Move the yank pointer n entries toward older kills (wrapping) and return that entry. */
    rotate(n = 1): string | undefined {
        const len = this.ring.length;
        if (len === 0) return undefined;
        this.yankIndex = (((this.yankIndex + n) % len) + len) % len;
        return this.ring[this.yankIndex];
    }

    /** Point the yank pointer at entry i. */
    setPointer(i: number): void {
        if (i >= 0 && i < this.ring.length) this.yankIndex = i;
    }

    /** Remove entry i, keeping the pointer on the same entry where possible. */
    remove(i: number): void {
        if (i < 0 || i >= this.ring.length) return;
        this.ring.splice(i, 1);
        if (i < this.yankIndex) this.yankIndex--;
        if (this.yankIndex >= this.ring.length) this.yankIndex = 0;
    }

    clear(): void {
        this.ring = [];
        this.yankIndex = 0;
    }
}
