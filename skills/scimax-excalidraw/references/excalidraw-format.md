# Excalidraw spec reference

`scimax excalidraw build` reads JSON: either `{"elements": [...]}` (optionally with
`appState` and `files`) or a bare array of elements. Every field Excalidraw needs that you
leave out (seed, version, roundness, bindings, ...) is filled in, so a spec only says what
the drawing should look like.

## Elements

Common fields (all optional except `type` and the position):

| Field | Meaning | Default |
|-------|---------|---------|
| `id` | Stable name, used by `from`/`to` | generated |
| `type` | `rectangle`, `ellipse`, `diamond`, `arrow`, `line`, `text`, `freedraw`, `image`, `frame` | `rectangle` |
| `x`, `y` | Top-left corner (arrows: start point) | `0` |
| `width`, `height` | Size; shapes with a `label` and no size fit the label | `0` |
| `strokeColor` | Outline / text colour | `#1e1e1e` |
| `backgroundColor` | Fill colour, or `transparent` | `transparent` |
| `fillStyle` | `solid`, `hachure`, `cross-hatch` | `solid` |
| `strokeWidth` | 1 thin, 2 bold, 4 extra bold | `2` |
| `strokeStyle` | `solid`, `dashed`, `dotted` | `solid` |
| `roughness` | 0 architect, 1 artist, 2 cartoonist | `1` |
| `opacity` | 0-100 | `100` |
| `angle` | Rotation in radians | `0` |
| `roundness` | `null` for sharp corners | rounded |
| `link` | Any URL the element opens | none |
| `groupIds` | Elements sharing an id move together | `[]` |

Shorthands (expanded by `build`, gone from the saved drawing):

| Field | On | Effect |
|-------|----|--------|
| `label` | rectangle, ellipse, diamond, arrow, line | Text centred in the shape (or on the arrow), bound to it so they move together |
| `labelFontSize` | same | Label size (default 20 in shapes, 16 on arrows) |
| `from`, `to` | arrow, line | Ids of the shapes it connects; endpoints sit on the shapes' edges and stay attached when shapes are moved in the editor |
| `orgLink` | any element | Org link followed by scimax (see below) |

Text elements: `text` (use `\n` for line breaks), `fontSize` (16 small, 20 normal, 28
large, 36 title), `fontFamily` (5 hand-drawn Excalifont, 6 normal Nunito, 8 code),
`textAlign` (`left`, `center`, `right`).

Arrows and lines without `from`/`to`: `points` are offsets from `x`,`y`, e.g.
`[[0,0],[200,0],[200,120]]` for an elbow. `startArrowhead`/`endArrowhead`: `null`, `arrow`,
`triangle`, `bar`, `dot` (arrows default to an `arrow` end).

## Org links (`orgLink`)

| Target | Value |
|--------|-------|
| Heading in a file | `file:../notes.org::*Exact heading title` |
| Custom id | `file:../notes.org::#custom-id` |
| Org ID (any file) | `id:2f6a...` |
| Line | `file:../analysis.py::42` |
| File | `file:../data/results.csv` |
| Citation (VS Code only) | `cite:&smith2020` |
| Web | `https://...` or `doi:10.1021/...` |

Relative paths are relative to the drawing's folder. The heading title must match the
heading without stars, TODO keyword, priority and tags. `build` and `check` report links
whose file, heading or custom id does not exist (`id:` and `cite:` are not checked).

## Layout rules

- Work on a grid: columns 250-300 px apart, rows 150 px apart. Leave at least 60 px
  between shapes so arrows and their labels have room.
- Flow left to right or top to bottom; put the title as a `text` element above the
  diagram (`fontSize` 28).
- Leave `width`/`height` off labelled shapes unless shapes in a row should be the same
  size; then give them all the same size.
- Use `rectangle` for steps and things, `ellipse` for starts, ends and states, `diamond`
  for decisions; `dashed` arrows for optional or indirect relations.
- Keep labels short (1-4 words); put detail in the linked org section, not the figure.
- Mark linked shapes consistently, e.g. a coloured fill, and say so in the caption.

## Palette (Excalidraw's own)

| Use | Stroke | Fill |
|-----|--------|------|
| Neutral | `#1e1e1e` | `#e9ecef` |
| Blue | `#1971c2` | `#a5d8ff` |
| Green | `#2f9e44` | `#b2f2bb` |
| Red | `#e03131` | `#ffc9c9` |
| Yellow | `#f08c00` | `#ffec99` |
| Violet | `#6741d9` | `#d0bfff` |

## Example

```json
{"elements": [
  {"type": "text", "x": 0, "y": -70, "text": "Analysis pipeline", "fontSize": 28},
  {"id": "data", "type": "rectangle", "x": 0, "y": 0, "width": 180, "height": 80,
   "label": "Raw data", "backgroundColor": "#a5d8ff", "strokeColor": "#1971c2",
   "orgLink": "file:../notes.org::#data"},
  {"id": "fit", "type": "rectangle", "x": 280, "y": 0, "width": 180, "height": 80,
   "label": "Model fit", "backgroundColor": "#b2f2bb", "strokeColor": "#2f9e44",
   "orgLink": "file:../notes.org::*Model fitting"},
  {"id": "ok", "type": "diamond", "x": 560, "y": -10, "width": 160, "height": 100,
   "label": "Good fit?"},
  {"id": "paper", "type": "ellipse", "x": 820, "y": 0, "width": 160, "height": 80,
   "label": "Paper", "link": "https://doi.org/10.1021/acscatal.0c00000"},
  {"type": "arrow", "from": "data", "to": "fit", "label": "clean"},
  {"type": "arrow", "from": "fit", "to": "ok"},
  {"type": "arrow", "from": "ok", "to": "paper", "label": "yes"},
  {"type": "arrow", "x": 640, "y": 95, "points": [[0, 0], [0, 80], [-270, 80], [-270, -10]],
   "label": "no", "strokeStyle": "dashed"}
]}
```

## Files

- `.excalidraw.svg`: an SVG image with the scene embedded. The Excalidraw editor opens and
  saves it; browsers, GitHub and HTML export show it. Use this by default.
- `.excalidraw` / `.excalidraw.json`: the scene as JSON only. `scimax excalidraw render`
  turns one into an `.excalidraw.svg`.

The SVG `build` writes uses clean shapes and system fonts; the Excalidraw editor redraws
it in its sketchy style the next time the user saves it.
