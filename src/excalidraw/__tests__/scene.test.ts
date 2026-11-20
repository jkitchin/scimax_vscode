import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
    normalizeScene,
    checkScene,
    sceneLinks,
    renderSceneSvg,
    encodeScenePayload,
    decodeScenePayload,
    parseSceneFile,
    orgLinkUri,
    parseOrgLinkUri,
    parseOrgLinkQuery,
    prepareSvgForHtml,
    stampLinkFrom,
    drawingFromPath,
} from '../scene';

const spec = {
    elements: [
        { id: 'a', type: 'rectangle', x: 0, y: 0, label: 'Data', orgLink: 'file:notes.org::*Data' },
        { id: 'b', type: 'ellipse', x: 300, y: 0, width: 120, height: 80, label: 'Model' },
        { id: 'ab', type: 'arrow', from: 'a', to: 'b', label: 'fit' },
    ],
};

describe('org link URIs', () => {
    it('round-trips links with & and = in them', () => {
        const link = 'file:a b.org::*Results & discussion';
        const uri = orgLinkUri(link, '/x/y.excalidraw');
        expect(parseOrgLinkUri(uri)).toEqual({ link, from: '/x/y.excalidraw' });
    });

    it('reads an already-decoded query to the end', () => {
        expect(parseOrgLinkQuery('from=/x/y.org&link=file:z.org::*A&B=c', false))
            .toEqual({ link: 'file:z.org::*A&B=c', from: '/x/y.org' });
        expect(parseOrgLinkQuery('link=id:123', false)).toEqual({ link: 'id:123', from: undefined });
        expect(parseOrgLinkQuery('from=x', false)).toBeNull();
    });

    it('ignores other hrefs', () => {
        expect(parseOrgLinkUri('https://example.com')).toBeNull();
    });
});

describe('normalizeScene', () => {
    const scene = normalizeScene(spec);

    it('expands labels into bound text elements', () => {
        const label = scene.elements.find(e => e.id === 'a-label')!;
        expect(label.type).toBe('text');
        expect(label.containerId).toBe('a');
        const a = scene.elements.find(e => e.id === 'a')!;
        expect(a.boundElements).toContainEqual({ id: 'a-label', type: 'text' });
        expect(a.width).toBeGreaterThan(0);
        expect(a.height).toBeGreaterThan(0);
    });

    it('binds arrows to shape edges', () => {
        const arrow = scene.elements.find(e => e.id === 'ab')!;
        const a = scene.elements.find(e => e.id === 'a')!;
        expect(arrow.startBinding?.elementId).toBe('a');
        expect(arrow.endBinding?.elementId).toBe('b');
        expect(arrow.x).toBeGreaterThan(a.x + a.width);
        const end = arrow.x + arrow.points![1][0];
        expect(end).toBeLessThan(300);
        expect(a.boundElements).toContainEqual({ id: 'ab', type: 'arrow' });
    });

    it('turns orgLink into a scimax URI', () => {
        const a = scene.elements.find(e => e.id === 'a')!;
        expect(a.link).toBe(orgLinkUri('file:notes.org::*Data'));
        expect(a.customData?.orgLink).toBe('file:notes.org::*Data');
    });

    it('produces a scene with no problems that normalizes to itself', () => {
        expect(checkScene(scene)).toEqual([]);
        const again = normalizeScene(scene);
        expect(again.elements.map(e => e.id)).toEqual(scene.elements.map(e => e.id));
        expect(checkScene(again)).toEqual([]);
    });

    it('accepts a bare element array', () => {
        expect(normalizeScene([{ type: 'text', text: 'hi' }]).elements).toHaveLength(1);
    });
});

describe('checkScene', () => {
    it('reports broken references', () => {
        const problems = checkScene({
            type: 'excalidraw', version: 2, elements: [
                { id: 't', type: 'text', x: 0, y: 0, width: 1, height: 1, text: 'x', containerId: 'nope' },
                { id: 'r', type: 'arrow', x: 0, y: 0, width: 1, height: 1, points: [[0, 0]], endBinding: { elementId: 'gone' } },
                { id: 'r', type: 'rectangle', x: 0, y: 0, width: 1, height: 1 },
            ],
        });
        expect(problems).toContain('duplicate id "r"');
        expect(problems.some(p => p.includes('containerId "nope"'))).toBe(true);
        expect(problems.some(p => p.includes('missing "gone"'))).toBe(true);
        expect(problems.some(p => p.includes('at least two points'))).toBe(true);
    });
});

describe('sceneLinks', () => {
    it('lists links with their label text and org link', () => {
        expect(sceneLinks(normalizeScene(spec))).toEqual([
            { id: 'a', text: 'Data', link: orgLinkUri('file:notes.org::*Data'), orgLink: 'file:notes.org::*Data' },
        ]);
    });
});

describe('payload', () => {
    it('round-trips through an embedded SVG', () => {
        const scene = normalizeScene(spec);
        const svg = renderSceneSvg(scene, { embedScene: true })!;
        expect(svg).toContain('payload-type:application/vnd.excalidraw+json');
        expect(decodeScenePayload(svg)).toEqual(JSON.parse(JSON.stringify(scene)));
        expect(parseSceneFile(svg, 'x.excalidraw.svg')?.elements).toHaveLength(scene.elements.length);
    });

    it('reads an uncompressed byte-string wrapper with non-ASCII text', () => {
        const scene = normalizeScene([{ type: 'text', text: 'Δ → α' }]);
        const encoded = Buffer.from(JSON.stringify(scene), 'utf8').toString('latin1');
        const payload = Buffer.from(JSON.stringify({ version: '1', encoding: 'bstring', compressed: false, encoded }), 'latin1').toString('base64');
        const svg = `<svg><!-- payload-type:application/vnd.excalidraw+json --><!-- payload-version:2 --><!-- payload-start -->${payload}<!-- payload-end --></svg>`;
        expect(decodeScenePayload(svg)?.elements[0].text).toBe('Δ → α');
        expect(encodeScenePayload(scene)).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('returns null without a payload', () => {
        expect(decodeScenePayload('<svg></svg>')).toBeNull();
    });
});

describe('renderSceneSvg', () => {
    it('wraps linked shapes and their labels in anchors', () => {
        const svg = renderSceneSvg(normalizeScene(spec))!;
        const anchors = svg.match(/<a href=/g) ?? [];
        expect(anchors).toHaveLength(2);
        expect(svg).toContain('<title>file:notes.org::*Data</title>');
        expect(svg).toContain('>Model</tspan>');
    });

    it('drops script links and escapes text', () => {
        const svg = renderSceneSvg(normalizeScene([
            { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, link: 'javascript:alert(1)' },
            { type: 'text', x: 0, y: 20, text: '<b>&' },
        ]))!;
        expect(svg).not.toContain('javascript:');
        expect(svg).toContain('&lt;b&gt;&amp;');
    });

    it('returns null for an empty scene', () => {
        expect(renderSceneSvg(normalizeScene([]))).toBeNull();
    });
});

describe('prepareSvgForHtml', () => {
    it('strips scripts and handlers and rewrites hrefs', () => {
        const svg = `<?xml version="1.0"?><svg onload="x()"><script>bad()</script>
<metadata>payload</metadata><a href="${orgLinkUri('file:n.org::*H')}" target="_blank"><rect/></a>
<a xlink:href="javascript:alert(1)"><rect/></a></svg>`;
        const out = prepareSvgForHtml(svg, href => {
            const org = parseOrgLinkUri(href);
            return org ? `n.html#${org.link.split('*')[1]}` : href;
        });
        expect(out).not.toMatch(/script|onload|metadata|javascript|target=/);
        expect(out).toContain('<a href="n.html#H">');
        expect(out).toContain('<a><rect/></a>');
    });
});

describe('stampLinkFrom', () => {
    const link = 'file:../notes.org::*A heading';
    const scene = normalizeScene({
        elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, label: 'A', orgLink: link }],
    } as never);
    const hrefs = (svg: string) => [...svg.matchAll(/<a href="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&'));

    it('names the drawing in org-link hrefs, as ~ under the home folder', () => {
        const svg = stampLinkFrom(renderSceneSvg(scene, { embedScene: true })!, '/home/u/j/diagrams/x.excalidraw.svg');
        const parsed = hrefs(svg).map(h => parseOrgLinkUri(h));
        expect(parsed.length).toBeGreaterThan(0);
        for (const p of parsed) {
            expect(p?.link).toBe(link);
            expect(p?.from).toBe(drawingFromPath('/home/u/j/diagrams/x.excalidraw.svg'));
        }
    });

    it('leaves the embedded scene alone, so the editor still resolves against the drawing', () => {
        const svg = stampLinkFrom(renderSceneSvg(scene, { embedScene: true })!, '/tmp/x.excalidraw.svg');
        const reread = parseSceneFile(svg, 'x.excalidraw.svg')!;
        expect(sceneLinks(reread).map(l => parseOrgLinkUri(l.link)?.from)).toEqual([undefined]);
    });

    it('keeps a from= the link already has, and is idempotent', () => {
        const own = renderSceneSvg(normalizeScene({
            elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, link: orgLinkUri('*H', 'notes.org') }],
        } as never))!;
        expect(own).toContain('from=notes.org');
        expect(stampLinkFrom(own, '/tmp/x.excalidraw.svg')).toBe(own);
        const once = stampLinkFrom(renderSceneSvg(scene)!, '/tmp/x.excalidraw.svg');
        expect(stampLinkFrom(once, '/tmp/x.excalidraw.svg')).toBe(once);
    });

    it('drawingFromPath uses ~ inside home and an absolute path outside it', () => {
        expect(drawingFromPath('/home/u/a/b.svg', '/home/u')).toBe('~/a/b.svg');
        expect(drawingFromPath('/srv/a/b.svg', '/home/u')).toBe(path.resolve('/srv/a/b.svg'));
    });
});
