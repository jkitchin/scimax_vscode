/**
 * Scimax's Excalidraw editor webview.
 *
 * The extension (src/excalidraw/editorProvider.ts) owns the file. It sends the
 * scene in, and this page sends the whole serialized file back after each
 * edit: Excalidraw JSON for `.excalidraw` / `.excalidraw.json`, or an SVG with
 * the scene embedded for `.excalidraw.svg`.
 *
 * Beyond plain Excalidraw it ties a drawing to org notes:
 *  - a shape's org link opens in VS Code directly (no OS round trip)
 *  - "Link to note" / "Linked box" ask the extension for a heading to link to
 *  - shapes linked to headings show the heading's TODO state and priority,
 *    and hovering one shows the heading and the start of its entry.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
    Excalidraw,
    CaptureUpdateAction,
    convertToExcalidrawElements,
    exportToSvg,
    restore,
    sceneCoordsToViewportCoords,
    serializeAsJSON,
    viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import './editor.css';

type AnyElement = {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    isDeleted?: boolean;
    link?: string | null;
    containerId?: string | null;
    text?: string;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = any;

/** What the extension knows about the target of one element's link. */
export interface LinkStatus {
    /** Heading title, without stars, keyword, priority or tags */
    title?: string;
    todo?: string;
    done?: boolean;
    priority?: string;
    /** The headings above it: "Projects › Grant" */
    outline?: string;
    /** First lines of the entry */
    snippet?: string;
    file?: string;
    line?: number;
    /** Why the link cannot be followed */
    broken?: string;
}

type FromHost =
    | { type: 'init'; scene: unknown; format: 'json' | 'svg'; name: string }
    | { type: 'scene'; scene: unknown }
    | { type: 'status'; statuses: Record<string, LinkStatus> }
    | { type: 'setLink'; elementIds: string[]; uri: string }
    | { type: 'insertLinked'; items: Array<{ uri: string; label: string }> };

declare function acquireVsCodeApi(): { postMessage(m: unknown): void };
const vscode = acquireVsCodeApi();

/** Debounce for sending edits back to the extension. */
const SAVE_DELAY_MS = 350;

function isDark(): boolean {
    const c = document.body.classList;
    return c.contains('vscode-dark') || c.contains('vscode-high-contrast');
}

/** The element a bound label belongs to, so hovering/linking a label means its box. */
function owner(el: AnyElement, byId: Map<string, AnyElement>): AnyElement {
    return el.containerId ? byId.get(el.containerId) ?? el : el;
}

function stateClass(s: LinkStatus): string {
    if (s.broken) return 'broken';
    if (!s.todo) return 'plain';
    return s.done ? 'done' : 'todo';
}

function App(): JSX.Element {
    const [api, setApi] = useState<Api>(null);
    const [initial, setInitial] = useState<{ scene: unknown; format: 'json' | 'svg' } | null>(null);
    const [statuses, setStatuses] = useState<Record<string, LinkStatus>>({});
    const [showStatus, setShowStatus] = useState(true);
    const [view, setView] = useState(0); // bumps on scroll/zoom so badges move
    const [selected, setSelected] = useState<string[]>([]);
    const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);

    const format = useRef<'json' | 'svg'>('json');
    const lastSent = useRef<string>('');
    const saveTimer = useRef<number | undefined>(undefined);
    const lastVersion = useRef<string | null>(null);
    const hoverTimer = useRef<number | undefined>(undefined);
    const lastSelection = useRef('');
    const lastView = useRef('');
    const theme = useMemo(() => (isDark() ? 'dark' : 'light'), []);
    const data = useMemo(() => (initial ? restore(initial.scene as never, null, null) : null), [initial]);

    // ---- messages from the extension ----
    useEffect(() => {
        const onMessage = (event: MessageEvent<FromHost>) => {
            const m = event.data;
            switch (m.type) {
                case 'init':
                    format.current = m.format;
                    setInitial({ scene: m.scene, format: m.format });
                    break;
                case 'scene':
                    if (!api) return;
                    {
                        // Edited outside this view (git, a text editor, undo in
                        // VS Code). Remember its versions so it is not sent back.
                        const data = restore(m.scene as never, null, null);
                        if (data.files) api.addFiles(Object.values(data.files));
                        api.updateScene({ elements: data.elements, captureUpdate: CaptureUpdateAction.NEVER });
                        lastVersion.current = versionKey(api.getSceneElements());
                    }
                    break;
                case 'status':
                    setStatuses(m.statuses);
                    break;
                case 'setLink': {
                    if (!api) return;
                    const ids = new Set(m.elementIds);
                    const elements = api.getSceneElements().map((el: AnyElement) =>
                        ids.has(el.id) ? { ...el, link: m.uri, version: (el as never as { version: number }).version + 1 } : el);
                    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
                    break;
                }
                case 'insertLinked':
                    if (api) insertLinked(api, m.items);
                    break;
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [api]);

    useEffect(() => { vscode.postMessage({ type: 'ready' }); }, []);

    // Excalidraw's own undo/redo, not VS Code's: VS Code would otherwise also
    // undo the whole-file edit this page last sent. Registered after
    // Excalidraw's document listener, so Excalidraw has handled the key first.
    useEffect(() => {
        if (!api) return;
        const onKey = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            if ((e.metaKey || e.ctrlKey) && (key === 'z' || key === 'y')) e.stopPropagation();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [api]);

    // ---- sending edits back ----
    const serialize = useCallback(async (): Promise<string> => {
        const elements = api.getSceneElements();
        const appState = api.getAppState();
        const files = api.getFiles();
        if (format.current === 'svg') {
            const svg = await exportToSvg({
                elements,
                appState: { ...appState, exportEmbedScene: true, exportBackground: true },
                files,
            });
            return svg.outerHTML;
        }
        return serializeAsJSON(elements, appState, files, 'local');
    }, [api]);

    const onChange = useCallback((elements: readonly AnyElement[], appState: { selectedElementIds: Record<string, boolean>; scrollX: number; scrollY: number; zoom: { value: number } }) => {
        // onChange fires on every render: set state only on real changes, or
        // the re-render it causes fires onChange again, forever.
        const sel = Object.keys(appState.selectedElementIds).filter(id => appState.selectedElementIds[id]);
        const selKey = sel.join(',');
        if (selKey !== lastSelection.current) {
            lastSelection.current = selKey;
            setSelected(sel);
        }
        const viewKey = `${appState.scrollX},${appState.scrollY},${appState.zoom.value}`;
        if (viewKey !== lastView.current) {
            lastView.current = viewKey;
            setView(v => v + 1);
        }
        if (!api) return;
        // Only element changes edit the file, not scrolling or selection.
        const version = versionKey(elements);
        if (version === lastVersion.current) return;
        const first = lastVersion.current === null;
        lastVersion.current = version;
        if (first) return; // the scene as loaded
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(async () => {
            const text = await serialize();
            if (text === lastSent.current) return;
            lastSent.current = text;
            vscode.postMessage({ type: 'edit', text, linkedIds: linkedIds(api) });
        }, SAVE_DELAY_MS);
    }, [api, serialize]);

    // ---- links ----
    const onLinkOpen = useCallback((element: AnyElement, event: CustomEvent<{ nativeEvent: MouseEvent }>) => {
        if (!element.link) return;
        event.preventDefault();
        vscode.postMessage({ type: 'openLink', href: element.link });
    }, []);

    const pickLink = useCallback(() => {
        if (!api) return;
        const byId = new Map<string, AnyElement>(api.getSceneElements().map((e: AnyElement) => [e.id, e]));
        const ids = [...new Set(selected.map(id => byId.get(id)).filter(Boolean).map(e => owner(e as AnyElement, byId).id))];
        if (ids.length) vscode.postMessage({ type: 'pickLink', elementIds: ids });
    }, [api, selected]);

    const pickInsert = useCallback(() => vscode.postMessage({ type: 'pickInsert' }), []);

    // ---- hover tooltips for linked shapes ----
    const onPointerUpdate = useCallback((payload: { pointer: { x: number; y: number } }) => {
        if (!api) return;
        window.clearTimeout(hoverTimer.current);
        const { x, y } = payload.pointer;
        const hit = api.getSceneElements().find((el: AnyElement) =>
            !el.isDeleted && el.link && statuses[el.id]
            && x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height);
        if (!hit) { setHover(null); return; }
        if (hover?.id === hit.id) return;
        hoverTimer.current = window.setTimeout(() => {
            const appState = api.getAppState();
            const p = sceneCoordsToViewportCoords({ sceneX: hit.x + hit.width, sceneY: hit.y }, appState);
            setHover({ id: hit.id, x: p.x, y: p.y });
        }, 400);
    }, [api, statuses, hover]);

    // ---- status badges over linked shapes ----
    const badges = useMemo(() => {
        if (!api || !showStatus) return [];
        const appState = api.getAppState();
        return api.getSceneElements()
            .filter((el: AnyElement) => !el.isDeleted && statuses[el.id])
            .map((el: AnyElement) => {
                const s = statuses[el.id];
                const tl = sceneCoordsToViewportCoords({ sceneX: el.x, sceneY: el.y }, appState);
                const br = sceneCoordsToViewportCoords({ sceneX: el.x + el.width, sceneY: el.y + el.height }, appState);
                return { id: el.id, s, tl, br };
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, statuses, showStatus, view]);

    const initialData = useMemo(() => data && ({
        elements: data.elements, appState: { ...data.appState, theme }, files: data.files, scrollToContent: true,
    }), [data, theme]);

    const topRight = useCallback(() => (
        <div className="scimax-tools">
            <button onClick={pickLink} disabled={!selected.length}
                title="Link the selected shapes to an org heading, file or notebook (C-c C-l)">🔗 Link to note</button>
            <button onClick={pickInsert} title="Add a box linked to an org heading (C-c C-b)">＋ Linked box</button>
            <button onClick={() => setShowStatus(s => !s)} className={showStatus ? 'on' : ''}
                title="Show the TODO state of linked headings on their shapes">Status</button>
        </div>
    ), [pickLink, pickInsert, selected.length, showStatus]);

    if (!initial || !initialData) return <div className="loading">Loading drawing…</div>;
    const hovered = hover ? statuses[hover.id] : undefined;

    return (
        <div className="root">
            <Excalidraw
                excalidrawAPI={setApi}
                initialData={initialData as never}
                theme={theme}
                onChange={onChange as never}
                onLinkOpen={onLinkOpen as never}
                onPointerUpdate={onPointerUpdate as never}
                UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true } } }}
                renderTopRightUI={topRight}
            />
            {badges.map((b: { id: string; s: LinkStatus; tl: { x: number; y: number }; br: { x: number; y: number } }) => (
                <React.Fragment key={b.id}>
                    <div className={`scimax-frame ${stateClass(b.s)}`}
                        style={{ left: b.tl.x - 4, top: b.tl.y - 4, width: b.br.x - b.tl.x + 8, height: b.br.y - b.tl.y + 8 }} />
                    {(b.s.todo || b.s.priority || b.s.broken) && (
                        <div className={`scimax-badge ${stateClass(b.s)}`} style={{ left: b.tl.x - 4, top: b.tl.y - 12 }}>
                            {b.s.broken ? '⚠ broken link' : [b.s.priority && `#${b.s.priority}`, b.s.todo].filter(Boolean).join(' ')}
                        </div>
                    )}
                </React.Fragment>
            ))}
            {hover && hovered && (
                <div className="scimax-tooltip" style={{ left: Math.min(hover.x + 8, window.innerWidth - 380), top: Math.max(hover.y, 8) }}>
                    {hovered.broken ? (
                        <div className="broken">⚠ {hovered.broken}</div>
                    ) : (
                        <>
                            {hovered.outline && <div className="outline">{hovered.outline}</div>}
                            <div className="title">
                                {hovered.todo && <span className={`kw ${hovered.done ? 'done' : 'todo'}`}>{hovered.todo}</span>}
                                {hovered.priority && <span className="pri">[#{hovered.priority}]</span>}
                                {hovered.title}
                            </div>
                            {hovered.snippet && <pre className="snippet">{hovered.snippet}</pre>}
                            {hovered.file && <div className="where">{hovered.file}{hovered.line ? `:${hovered.line}` : ''}</div>}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

/** Changes when any element is added, removed or edited. */
function versionKey(elements: readonly AnyElement[]): string {
    return elements.map(e => `${e.id}:${(e as never as { version: number }).version}`).join(',');
}

/** Ids of elements that carry a link, for the extension to look up. */
function linkedIds(api: Api): Array<{ id: string; link: string }> {
    return api.getSceneElements()
        .filter((el: AnyElement) => !el.isDeleted && el.link)
        .map((el: AnyElement) => ({ id: el.id, link: el.link as string }));
}

/** Add a row of boxes, each linked to a note, at the middle of the view. */
function insertLinked(api: Api, items: Array<{ uri: string; label: string }>): void {
    const appState = api.getAppState();
    const centre = viewportCoordsToSceneCoords(
        { clientX: appState.offsetLeft + appState.width / 2, clientY: appState.offsetTop + appState.height / 2 },
        appState
    );
    const W = 220;
    const H = 80;
    const GAP = 40;
    const startX = centre.x - (items.length * W + (items.length - 1) * GAP) / 2;
    const skeletons = items.map((item, i) => ({
        type: 'rectangle' as const,
        x: startX + i * (W + GAP),
        y: centre.y - H / 2,
        width: W,
        height: H,
        backgroundColor: '#a5d8ff',
        fillStyle: 'solid' as const,
        roundness: { type: 3 },
        link: item.uri,
        label: { text: item.label.length > 60 ? item.label.slice(0, 57) + '…' : item.label },
    }));
    const added = convertToExcalidrawElements(skeletons as never, { regenerateIds: true });
    api.updateScene({
        elements: [...api.getSceneElements(), ...added],
        appState: { selectedElementIds: Object.fromEntries(added.filter((e: AnyElement) => e.type !== 'text').map((e: AnyElement) => [e.id, true])) },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
}

// Org-style chords inside the canvas: C-c C-l links the selection, C-c C-b adds a linked box.
let ctrlC = 0;
document.addEventListener('keydown', e => {
    if (!e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'c' && !window.getSelection()?.toString()) {
        ctrlC = Date.now();
        return;
    }
    if (Date.now() - ctrlC > 2000) return;
    ctrlC = 0;
    if (key === 'l') document.querySelector<HTMLButtonElement>('.scimax-tools button')?.click();
    else if (key === 'b') document.querySelectorAll<HTMLButtonElement>('.scimax-tools button')[1]?.click();
    else return;
    e.preventDefault();
    e.stopPropagation();
}, true);

createRoot(document.getElementById('app')!).render(<App />);
