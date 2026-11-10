/**
 * Address lists for email headers (To/Cc/Bcc), free of vscode for testing.
 *
 * A list is split on commas and semicolons, except inside a quoted display
 * name ("Ramirez, Ana" <ana@x.org>), an angle-bracket address, or an org
 * link ([[mailto:a@x.org][Ramirez, Ana]]).
 */

/** Split an address list into its trimmed, non-empty entries. */
export function splitAddresses(value: string | undefined): string[] {
    if (!value) return [];
    const parts: string[] = [];
    let current = '';
    let quoted = false;
    let angle = 0;
    let link = 0;
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (quoted) {
            current += ch;
            if (ch === '\\' && i + 1 < value.length) current += value[++i];
            else if (ch === '"') quoted = false;
            continue;
        }
        if (value.startsWith('[[', i)) { link++; current += '[['; i++; continue; }
        if (link > 0 && value.startsWith(']]', i)) { link--; current += ']]'; i++; continue; }
        if (ch === '"' && link === 0) quoted = true;
        else if (ch === '<' && link === 0) angle++;
        else if (ch === '>' && angle > 0) angle--;
        else if ((ch === ',' || ch === ';') && angle === 0 && link === 0) {
            parts.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts.map(s => s.trim()).filter(s => s.length > 0);
}

/** `Name <address>`, quoting a name RFC 5322 would misread (commas, dots, …). */
export function displayAddress(name: string, address: string): string {
    const trimmed = name.trim();
    if (!trimmed || trimmed === address) return address;
    const display = /[,;:<>()[\]@"\\.]/.test(trimmed) ? `"${trimmed.replace(/["\\]/g, '\\$&')}"` : trimmed;
    return `${display} <${address}>`;
}

const LINK_RE = /^\[\[([^\]]+)\](?:\[([^\]]*)\])?\]$/;

/**
 * Turn one address-list entry written as an org link into an address:
 * `[[mailto:a@x.org][Ana]]` → `Ana <a@x.org>`, and `[[id:…][Ana]]` → the
 * :EMAIL: of that heading via `idAddresses`. Other entries come back as is,
 * and so does an id link with no known address.
 */
export function resolveAddress(entry: string, idAddresses?: Map<string, string>): string {
    const m = entry.match(LINK_RE);
    if (!m) return entry;
    const target = m[1].trim();
    const desc = m[2] ?? '';
    if (/^mailto:/i.test(target)) {
        // A mailto target may carry ?subject=…; only the address matters here
        const address = target.replace(/^mailto:/i, '').replace(/\?.*$/, '');
        return displayAddress(desc, address);
    }
    if (/^id:/i.test(target)) {
        const address = idAddresses?.get(target.replace(/^id:/i, ''));
        return address ? displayAddress(desc, address) : entry;
    }
    return entry;
}

/** The ids of `[[id:…]]` links left unresolved in an address list. */
export function addressListIds(value: string): string[] {
    return splitAddresses(value)
        .map(e => e.match(LINK_RE))
        .filter((m): m is RegExpMatchArray => !!m && /^id:/i.test(m[1].trim()))
        .map(m => m[1].trim().replace(/^id:/i, ''));
}
