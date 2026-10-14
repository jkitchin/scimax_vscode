/**
 * SVG and interactive HTML exports of the project Gantt chart.
 *
 * Both are drawn from the same GanttModel as the Excel and PDF exports, with
 * the PDF's colours and layout, so every export agrees with the project view.
 * The SVG is also what the PNG export rasterizes (in the project view's
 * webview, so no image library is needed).
 *
 * The HTML page is one self-contained, read-only file: the SVG, a little CSS
 * and a script for hover details, highlighting a task's dependency chain and
 * zooming. Nothing is loaded from the network, so it works offline and inside
 * a Marp slide (<iframe src="gantt.html">), where presenter decks inline it.
 *
 * No vscode imports: this module is unit tested directly.
 */

import {
    PDF_COLOURS,
    daysBetween,
    fitText,
    parseIsoDay,
    shiftDays,
    type GanttModel,
    type GanttRow,
    type GanttTaskRow,
} from './projectGantt';

type Rgb = [number, number, number];

const css = (c: Rgb) => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
const darker = (c: Rgb): Rgb => [c[0] * 0.45, c[1] * 0.45, c[2] * 0.45];
const n = (v: number) => (Math.round(v * 100) / 100).toString();

function xml(s: string): string {
    return s.replace(/[&<>"']/g, ch =>
        ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;');
}

/** Effort minutes as org writes them (1d = 8h). */
function effortText(minutes: number): string {
    const days = Math.floor(minutes / 480);
    const hours = Math.floor((minutes % 480) / 60);
    const mins = minutes % 60;
    return [days && `${days}d`, hours && `${hours}h`, mins && `${mins}min`].filter(Boolean).join(' ') || '0';
}

/** Inclusive date range text for an exclusive-end span. */
function spanText(start: string, end: string, milestone = false): string {
    const last = shiftDays(parseIsoDay(end), -1);
    const lastIso = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
    return milestone || lastIso <= start ? start : `${start} to ${lastIso}`;
}

const STATUS_TEXT: Record<GanttTaskRow['status'], string> = {
    done: 'done',
    blocked: 'blocked',
    active: 'in progress',
    planned: 'planned',
};

/** The hover text for a row. */
function rowTip(row: GanttRow): string {
    const lines: string[] = [];
    if (row.kind === 'group') {
        lines.push(row.label);
        if (row.start && row.end) lines.push(spanText(row.start, row.end));
    } else {
        lines.push(`${row.todo ? row.todo + ' ' : ''}${row.priority ? `[#${row.priority}] ` : ''}${row.title}`);
        lines.push(`${spanText(row.start, row.end, row.milestone)} (${row.milestone ? 'milestone' : STATUS_TEXT[row.status]})`);
        if (row.deadline) lines.push(`Deadline: ${row.deadline}`);
        if (row.assignees.length) lines.push(`Assigned: ${row.assignees.map(a => '@' + a).join(', ')}`);
        if (row.effortMinutes) lines.push(`Effort: ${effortText(row.effortMinutes)}`);
        if (row.tags.length) lines.push(`Tags: :${row.tags.join(':')}:`);
        lines.push(`${row.file}:${row.line}`);
    }
    if (row.progress) {
        const p = row.progress;
        const of = p.method === 'own' ? '' : ` (${p.done} of ${p.tasks} tasks done)`;
        lines.push(`Progress: ${Math.round(p.percent)}%${of}${row.behind ? ', behind schedule' : ''}`);
    }
    return lines.join('\n');
}

export interface GanttSvg {
    svg: string;
    width: number;
    height: number;
}

/**
 * The chart as a standalone SVG: task names on the left, a day grid with
 * weekends shaded, coloured bars, milestones as diamonds, dependency lines,
 * today's line and a legend. Each row carries a <title> (shown on hover) and
 * data attributes the HTML export uses for highlighting.
 */
export function ganttToSvg(model: GanttModel, title = 'Project'): GanttSvg {
    const start = parseIsoDay(model.start);
    const days = Math.max(1, daysBetween(start, parseIsoDay(model.end)));
    const labelW = 320;
    const margin = 20;
    const rowH = 22;
    const headerH = 64;
    const dayW = Math.max(8, Math.min(28, 900 / days));
    const chartW = days * dayW;
    const chartX = margin + labelW;
    const bodyTop = margin + headerH;
    const bodyH = model.rows.length * rowH;
    const legendTop = bodyTop + bodyH + 22;
    const width = Math.ceil(chartX + chartW + 40 + margin);
    const height = Math.ceil(legendTop + 16 + margin);
    const C = PDF_COLOURS;

    const out: string[] = [];
    const statuses = ['done', 'blocked', 'active', 'planned', 'summary'] as const;
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" class="gantt" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Helvetica, Arial, sans-serif">`);
    out.push(`<title>${xml(title)} Gantt chart</title>`);
    out.push('<defs>');
    for (const s of statuses) {
        out.push(`<pattern id="hatch-${s}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
            `<line x1="0" y1="0" x2="0" y2="4" stroke="${css(darker(C[s]))}" stroke-width="1.2"/></pattern>`);
    }
    out.push('</defs>');
    out.push(`<rect class="bg" width="${width}" height="${height}" fill="#ffffff"/>`);
    out.push(`<text x="${margin}" y="${margin + 16}" font-size="18" font-weight="bold" fill="${css(C.text)}">${xml(title)}</text>`);

    // Weekend shading, month and day labels, and the day grid.
    const grid: string[] = ['<g class="grid">'];
    let lastMonth = -1;
    const labelEvery = dayW >= 18 ? 1 : dayW >= 10 ? 2 : 7;
    for (let i = 0; i < days; i++) {
        const d = shiftDays(start, i);
        const x = chartX + i * dayW;
        if (d.getDay() === 0 || d.getDay() === 6) {
            grid.push(`<rect x="${n(x)}" y="${bodyTop}" width="${n(dayW)}" height="${bodyH}" fill="${css(C.weekend)}"/>`);
        }
        if (d.getMonth() !== lastMonth) {
            const month = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
            grid.push(`<text x="${n(x + 2)}" y="${margin + 42}" font-size="11" font-weight="bold" fill="${css(C.text)}">${month}</text>`);
            lastMonth = d.getMonth();
        }
        if (i % labelEvery === 0) {
            grid.push(`<text x="${n(x + 2)}" y="${margin + 58}" font-size="9" fill="${css(C.text)}">${d.getDate()}</text>`);
        }
    }
    const gridLines: string[] = [];
    for (let i = 0; i <= days; i++) gridLines.push(`M${n(chartX + i * dayW)} ${bodyTop}v${bodyH}`);
    for (let r = 0; r <= model.rows.length; r++) gridLines.push(`M${margin} ${bodyTop + r * rowH}h${n(labelW + chartW)}`);
    grid.push(`<path d="${gridLines.join('')}" stroke="${css(C.grid)}" stroke-width="0.5" fill="none"/>`);
    grid.push('</g>');
    out.push(...grid);

    const indentOf = (row: GanttRow) => model.groupBy === 'outline' ? Math.max(0, row.depth - 1) * 10 : 0;
    const xOf = (iso: string) => chartX + daysBetween(start, parseIsoDay(iso)) * dayW;
    const todayOffset = daysBetween(start, parseIsoDay(model.today));
    const todayX = chartX + todayOffset * dayW;

    /** Hatched done share, its percent after the bar, and the behind band under it. */
    const progressBits = (row: GanttRow, x1: number, x2: number, top: number, hatch: typeof statuses[number]): string => {
        const p = row.progress;
        if (!p) return '';
        const doneX = x1 + ((x2 - x1) * Math.min(100, p.percent)) / 100;
        let s = '';
        if (doneX - x1 > 0.5) {
            s += `<rect x="${n(x1 + 0.5)}" y="${top + 4}" width="${n(doneX - x1 - 0.5)}" height="${rowH - 8}" fill="url(#hatch-${hatch})"/>`;
        }
        if (p.percent > 0 && p.percent < 100) {
            s += `<line x1="${n(doneX)}" y1="${top + 4}" x2="${n(doneX)}" y2="${top + rowH - 4}" stroke="${css(darker(C[hatch]))}" stroke-width="1.2"/>`;
        }
        s += `<text x="${n(x2 + 4)}" y="${top + 15}" font-size="10" font-weight="bold" fill="${css(C.text)}">${Math.round(p.percent)}%</text>`;
        if (row.behind) {
            const to = Math.min(todayX, x2);
            s += `<rect x="${n(doneX)}" y="${top + rowH - 3.5}" width="${n(Math.max(2, to - doneX))}" height="2.2" fill="${css(C.behind)}"/>`;
        }
        return s;
    };
    const behindDot = (row: GanttRow, top: number) => row.behind
        ? `<circle cx="${chartX - 9}" cy="${top + rowH / 2}" r="3.5" fill="${css(C.behind)}"/>`
        : '';

    // Rows.
    const barOf = new Map<string, { x1: number; x2: number; mid: number }>();
    out.push('<g class="rows">');
    model.rows.forEach((row, index) => {
        const top = bodyTop + index * rowH;
        const indent = indentOf(row);
        const labelRoom = labelW - 8 - indent - (row.behind ? 14 : 0);
        const tip = `<title>${xml(rowTip(row))}</title>`;
        if (row.kind === 'group') {
            out.push(`<g class="row group" data-row="${index}">${tip}`);
            out.push(`<rect x="${margin}" y="${top}" width="${n(labelW + chartW)}" height="${rowH}" fill="${css(C.group)}" fill-opacity="0.85"/>`);
            out.push(`<text x="${margin + 4 + indent}" y="${top + 15}" font-size="12" font-weight="bold" fill="${css(C.text)}">${xml(fitText(row.label, labelRoom, 12))}</text>`);
            out.push(behindDot(row, top));
            if (row.start && row.end) {
                const x1 = xOf(row.start);
                const x2 = xOf(row.end);
                out.push(`<rect x="${n(x1 + 0.5)}" y="${top + 4}" width="${n(Math.max(1, x2 - x1 - 1))}" height="${rowH - 8}" rx="2" fill="${css(C.summary)}"/>`);
                out.push(progressBits(row, x1, x2, top, 'summary'));
            }
            out.push('</g>');
            return;
        }

        const deps = row.dependsOn.length ? ` data-deps="${xml(row.dependsOn.join(' '))}"` : '';
        out.push(`<g class="row task" data-row="${index}" data-id="${xml(row.ganttId)}"${deps}>${tip}`);
        // A transparent band so the whole row, not just the bar, takes hover and clicks.
        out.push(`<rect class="hit" x="${margin}" y="${top}" width="${n(labelW + chartW)}" height="${rowH}" fill="transparent"/>`);
        const who = row.assignees.length ? `  @${row.assignees.join(', @')}` : '';
        const label = `${row.todo ? row.todo + ' ' : ''}${row.status === 'blocked' ? '[blocked] ' : ''}${row.title}${who}`;
        out.push(`<text x="${margin + 4 + indent}" y="${top + 15}" font-size="11" fill="${css(C.text)}"${row.summary ? ' font-weight="bold"' : ''}>${xml(fitText(label, labelRoom, 11))}</text>`);
        out.push(behindDot(row, top));

        const mid = top + rowH / 2;
        if (row.milestone) {
            const cx = xOf(row.start) + dayW / 2;
            const r = rowH * 0.36;
            out.push(`<path class="bar" d="M${n(cx)} ${n(mid - r)}L${n(cx + r)} ${n(mid)}L${n(cx)} ${n(mid + r)}L${n(cx - r)} ${n(mid)}Z" fill="${css(C.milestone)}"/>`);
            barOf.set(row.ganttId, { x1: cx - r, x2: cx + r, mid });
        } else {
            const x1 = xOf(row.start);
            const x2 = xOf(row.end);
            const colour = row.summary ? C.summary : C[row.status];
            out.push(`<rect class="bar" x="${n(x1 + 0.5)}" y="${top + 4}" width="${n(Math.max(1, x2 - x1 - 1))}" height="${rowH - 8}" rx="2" fill="${css(colour)}"/>`);
            out.push(progressBits(row, x1, x2, top, row.summary ? 'summary' : row.status));
            barOf.set(row.ganttId, { x1, x2, mid });
        }
        out.push('</g>');
    });
    out.push('</g>');

    // Dependency lines: from the end of the dependency to the start of the task.
    out.push('<g class="deps" fill="none" stroke="#666666" stroke-width="1">');
    for (const row of model.rows) {
        if (row.kind !== 'task') continue;
        const to = barOf.get(row.ganttId);
        for (const dep of row.dependsOn) {
            const from = barOf.get(dep);
            if (!from || !to) continue;
            const elbow = Math.max(from.x2 + 4, Math.min(to.x1 - 4, from.x2 + 8));
            out.push(`<path data-from="${xml(dep)}" data-to="${xml(row.ganttId)}" d="M${n(from.x2)} ${n(from.mid)}H${n(elbow)}V${n(to.mid)}H${n(to.x1)}"/>`);
        }
    }
    out.push('</g>');

    if (todayOffset >= 0 && todayOffset <= days) {
        out.push(`<line class="today" x1="${n(todayX)}" y1="${bodyTop - 6}" x2="${n(todayX)}" y2="${bodyTop + bodyH}" stroke="${css(C.today)}" stroke-width="1.5"><title>Today, ${model.today}</title></line>`);
    }

    // Legend.
    const legend: Array<[string, string]> = [
        ['done', `<rect width="12" height="10" fill="${css(C.done)}"/>`],
        ['blocked', `<rect width="12" height="10" fill="${css(C.blocked)}"/>`],
        ['in progress', `<rect width="12" height="10" fill="${css(C.active)}"/>`],
        ['planned', `<rect width="12" height="10" fill="${css(C.planned)}"/>`],
        ['milestone', `<path d="M6 0L12 5L6 10L0 5Z" fill="${css(C.milestone)}"/>`],
    ];
    if (model.progress) {
        legend.push(
            ['done share', `<rect width="12" height="10" fill="${css(C.planned)}"/><rect width="12" height="10" fill="url(#hatch-planned)"/>`],
            ['summary', `<rect width="12" height="10" fill="${css(C.summary)}"/>`],
            ['behind schedule', `<circle cx="6" cy="5" r="4" fill="${css(C.behind)}"/>`],
        );
    }
    out.push(`<g class="legend" font-size="11" fill="${css(C.text)}">`);
    legend.forEach(([label, swatch], i) => {
        const x = margin + i * 100;
        out.push(`<g transform="translate(${x} ${legendTop - 9})">${swatch}</g><text x="${x + 16}" y="${legendTop}">${label}</text>`);
    });
    out.push('</g>');
    out.push('</svg>');

    return { svg: out.join('\n'), width, height };
}

/** A standalone SVG file (with the XML declaration). */
export function ganttToSvgFile(model: GanttModel, title = 'Project'): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n${ganttToSvg(model, title).svg}\n`;
}

/**
 * A self-contained, read-only HTML page: the SVG chart sized to the window,
 * with hover details, click-to-highlight of a task's dependency chain, and
 * zoom (+/-, Fit, or Ctrl/Cmd+wheel).
 */
export function ganttToHtml(model: GanttModel, title = 'Project'): string {
    const { svg } = ganttToSvg(model, title);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${xml(title)} Gantt chart</title>
<style>
html, body { margin: 0; height: 100%; background: #ffffff; }
#wrap { position: absolute; inset: 0; overflow: auto; }
#wrap.fit svg.gantt { width: 100%; height: 100%; }
svg.gantt { display: block; }
.row.task { cursor: pointer; }
.row.task:hover .hit { fill: rgba(0, 0, 0, 0.05); }
svg.focus .row, svg.focus .deps path { opacity: 0.18; transition: opacity 0.15s; }
svg.focus .row.on, svg.focus .deps path.on { opacity: 1; }
svg.focus .deps path.on { stroke: #222222; stroke-width: 2; }
svg.focus .row.picked .bar { stroke: #222222; stroke-width: 1.5; }
#tools { position: fixed; top: 6px; right: 8px; display: none; gap: 4px; opacity: 0.35; transition: opacity 0.15s; z-index: 2; }
body.live #tools { display: flex; }
#tools:hover { opacity: 1; }
#tools button { font: 12px Helvetica, Arial, sans-serif; padding: 2px 8px; border: 1px solid #bbbbbb; border-radius: 4px; background: #ffffff; color: #222222; cursor: pointer; }
#tools button.active { background: #e4ecf7; border-color: #7a9cc6; }
#tip { position: fixed; pointer-events: none; z-index: 3; max-width: 360px; padding: 6px 8px; border-radius: 4px;
  background: rgba(30, 30, 30, 0.92); color: #ffffff; font: 12px/1.4 Helvetica, Arial, sans-serif; white-space: pre-line; }
</style>
</head>
<body>
<div id="tools">
  <button id="zoomOut" title="Zoom out">&minus;</button>
  <button id="zoomIn" title="Zoom in">+</button>
  <button id="fit" class="active" title="Fit the chart to the window">Fit</button>
</div>
<div id="wrap" class="fit">
${svg}
</div>
<div id="tip" hidden></div>
<script>
(function () {
    var svg = document.querySelector('svg.gantt');
    var wrap = document.getElementById('wrap');
    var tip = document.getElementById('tip');
    var W = svg.viewBox.baseVal.width, H = svg.viewBox.baseVal.height;
    // The zoom buttons appear once someone points or touches, so pictures of
    // the page (Marp's PDF, PPTX and image exports) do not show them.
    function live() { document.body.classList.add('live'); }
    document.addEventListener('mousemove', live, { once: true });
    document.addEventListener('touchstart', live, { once: true, passive: true });
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

    // Hover details: move each <title> into data-tip so the browser's own
    // tooltip does not show as well.
    Array.prototype.forEach.call(svg.querySelectorAll('.row > title, line.today > title'), function (t) {
        t.parentNode.setAttribute('data-tip', t.textContent);
        t.parentNode.removeChild(t);
    });
    svg.addEventListener('mousemove', function (e) {
        var el = e.target.closest('[data-tip]');
        if (!el) { tip.hidden = true; return; }
        tip.textContent = el.getAttribute('data-tip');
        tip.hidden = false;
        var x = e.clientX + 14, y = e.clientY + 14;
        if (x + tip.offsetWidth > window.innerWidth - 4) x = e.clientX - tip.offsetWidth - 10;
        if (y + tip.offsetHeight > window.innerHeight - 4) y = e.clientY - tip.offsetHeight - 10;
        tip.style.left = Math.max(4, x) + 'px';
        tip.style.top = Math.max(4, y) + 'px';
    });
    svg.addEventListener('mouseleave', function () { tip.hidden = true; });

    // Click a task: highlight what it waits on and what waits on it.
    var tasks = {}, waitsOn = {}, waitedOnBy = {};
    Array.prototype.forEach.call(svg.querySelectorAll('.row.task'), function (g) {
        var id = g.getAttribute('data-id');
        tasks[id] = g;
        waitsOn[id] = (g.getAttribute('data-deps') || '').split(' ').filter(Boolean);
        waitsOn[id].forEach(function (d) { (waitedOnBy[d] = waitedOnBy[d] || []).push(id); });
    });
    function reach(id, edges, seen) {
        (edges[id] || []).forEach(function (next) {
            if (!seen[next]) { seen[next] = true; reach(next, edges, seen); }
        });
        return seen;
    }
    function clearFocus() {
        svg.classList.remove('focus');
        Array.prototype.forEach.call(svg.querySelectorAll('.on, .picked'), function (el) {
            el.classList.remove('on'); el.classList.remove('picked');
        });
    }
    function focus(id) {
        clearFocus();
        var chain = reach(id, waitsOn, {});
        reach(id, waitedOnBy, chain);
        chain[id] = true;
        Object.keys(chain).forEach(function (k) { if (tasks[k]) tasks[k].classList.add('on'); });
        tasks[id].classList.add('picked');
        Array.prototype.forEach.call(svg.querySelectorAll('.deps path'), function (p) {
            if (chain[p.getAttribute('data-from')] && chain[p.getAttribute('data-to')]) p.classList.add('on');
        });
        svg.classList.add('focus');
    }
    svg.addEventListener('click', function (e) {
        var g = e.target.closest('.row.task');
        if (!g || g.classList.contains('picked')) { clearFocus(); return; }
        focus(g.getAttribute('data-id'));
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') clearFocus(); });

    // Zoom: Fit sizes the chart to the window; +/- and Ctrl/Cmd+wheel scale it.
    var scale = 1, fit = true;
    function apply() {
        wrap.classList.toggle('fit', fit);
        document.getElementById('fit').classList.toggle('active', fit);
        if (fit) { svg.removeAttribute('style'); return; }
        svg.style.width = Math.round(W * scale) + 'px';
        svg.style.height = Math.round(H * scale) + 'px';
    }
    function zoom(f) {
        if (fit) { scale = svg.getBoundingClientRect().width / W; fit = false; }
        scale = Math.min(8, Math.max(0.2, scale * f));
        apply();
    }
    document.getElementById('zoomIn').addEventListener('click', function () { zoom(1.25); });
    document.getElementById('zoomOut').addEventListener('click', function () { zoom(0.8); });
    document.getElementById('fit').addEventListener('click', function () { fit = !fit; if (!fit) scale = 1; apply(); });
    wrap.addEventListener('wheel', function (e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        zoom(e.deltaY < 0 ? 1.1 : 0.9);
    }, { passive: false });
    apply();
})();
</script>
</body>
</html>
`;
}
