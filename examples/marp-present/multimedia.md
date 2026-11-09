---
marp: true
presenter: true
window: app
theme: scimax
paginate: true
title: Multimedia in Scimax Marp slides
style: |
  /* A web page in a frame drawn at 1.5 times the size and scaled back down.
     The slide is 1280 x 720 and is scaled up to the screen (1.5 times on a
     1920 x 1080 screen); pages that draw on a canvas (Excalidraw, Desmos,
     PhET, 3Dmol, maps) would otherwise be drawn small and stretched, and look
     blurred. Use <div class="sharp" style="height:470px"><iframe ...></div>. */
  .sharp { position: relative; overflow: hidden; border: 1px solid #ccc; border-radius: 8px; }
  .sharp > iframe { position: absolute; top: 0; left: 0; width: 150%; height: 150%; border: 0; transform: scale(0.6667); transform-origin: 0 0; }
---

<!-- _class: lead -->

# Multimedia in Scimax Marp slides

Movies, YouTube, sound, a whiteboard, documents, simulations, molecules and maps.

Open with **Present**. Most slides here are live web pages, so they need a network connection.

<!-- All of this is plain HTML in the Markdown. A deck with `presenter: true` is built with HTML allowed (in a trusted workspace); in other decks turn on scimax.marp.enableHtml. -->

---

## A movie file

<video src="media/code-in-marp.mp4" poster="media/code-in-marp-poster.jpg" controls preload="metadata" style="display:block;height:430px;margin:0 auto;border-radius:8px"></video>

`<video src="media/code-in-marp.mp4" poster="…" controls>`, with a path next to the deck.

<!-- The poster is the frame shown before it plays. Space or click starts it. MP4 (H.264) plays everywhere; WebM and MOV work in Chrome-based browsers and VS Code. -->

---

<style scoped>
.columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1em; align-items: start; }
</style>

## Start at a time, play muted

<div class="columns">
<div>

<video src="media/code-in-marp.mp4#t=95" muted controls preload="metadata" style="width:100%;border-radius:8px"></video>

</div>
<div>

- `#t=95` starts at 1:35
- `#t=95,120` stops at 2:00
- `muted` for a demo you talk over
- `autoplay muted loop` to play by itself while the slide is shown

</div>
</div>

---

<!-- _class: invert -->
<!-- _paginate: false -->

<video src="media/background-loop.mp4" autoplay muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0"></video>

<div style="position:relative;z-index:1;background:rgba(5,12,25,0.45);padding:0.6em 1em;border-radius:10px">

# A movie behind the slide

`position:absolute; object-fit:cover` puts a muted, looping video under the text. Use footage with no text in it: this one is 12 seconds of waves made with ffmpeg (115 KB), and it loops with no jump.

</div>

<!-- Made with ffmpeg: each wave goes round a whole number of times in 12 seconds, so the end meets the start.
W='(sin(X/53+2*PI*T/12)+sin(Y/37-2*PI*T/6)+sin((X+Y)/71+2*PI*T/4))'
ffmpeg -f lavfi -i "nullsrc=s=640x360:r=24,format=gbrp" -vf "geq=r='20+6*$W':g='48+15*$W':b='110+30*$W'" -t 12 -crf 28 -pix_fmt yuv420p background-loop.mp4
A clip from a real movie works too (ffmpeg -ss 30 -t 12 -i in.mp4 -an clip.mp4), but a slide recording behind a slide just looks blurred. -->

---

## A YouTube video

<iframe src="https://www.youtube-nocookie.com/embed/DbXM1DxccQM?rel=0" title="scimax 5.0 - org-mode meets VS Code" style="display:block;width:768px;height:432px;margin:0 auto;border:0;border-radius:8px" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>

From *Share → Embed*, or `youtube-nocookie.com/embed/<id>`. Add `?start=90` to start at 1:30. Opened from a file, the slide shows a play button that opens the video on YouTube.

<!-- A YouTube "live" or "watch" URL does not play in a frame: use the /embed/ form. youtube-nocookie.com does not set tracking cookies until the video plays. After clicking into the player, click the slide outside it to get the arrow keys back. -->

---

## Sound

<audio src="media/narration-clip.m4a" controls style="width:80%;display:block;margin:1.5em auto"></audio>

`<audio src="media/narration-clip.m4a" controls>`: the first 25 seconds of the movie's narration, cut with

```bash
ffmpeg -ss 0 -t 25 -i code-in-marp.mp4 -vn -c:a aac narration-clip.m4a
```

---

## A whiteboard: Excalidraw

<div class="sharp" style="height:470px"><iframe src="https://excalidraw.com/" title="Excalidraw" loading="lazy"></iframe></div>

<!-- Draw with the toolbar. The drawing lives in this browser (excalidraw.com's local storage), so it is still there next time you open the deck in the same browser. To draw over any slide instead, press a for the presenter pen. To show a finished diagram, save it from Excalidraw as .excalidraw.svg and use it as an image. The frame is in a "sharp" box (see the style at the top of the deck): a plain iframe draws Excalidraw small and stretches it with the slide, so the lines look jagged. -->

---

## A Google Doc (or Sheet, or Slides)

<div class="sharp" style="height:470px"><iframe src="https://docs.google.com/document/d/1s6jT5Wb5qyMugkdnEJ-7vv--jIzVlyQ9TgzCnifzMBE/preview" title="A Google Doc" loading="lazy"></iframe></div>

<!-- Replace /edit... with /preview in a Doc, Sheet or Slides URL. The file must be shared as "anyone with the link can view", or the audience sees a sign-in page. For a cleaner page use File → Share → Publish to web → Embed. -->

---

## An interactive simulation (PhET)

<div class="sharp" style="height:500px;border:0"><iframe src="https://phet.colorado.edu/sims/html/gas-properties/latest/gas-properties_all.html" title="PhET Gas Properties" allowfullscreen loading="lazy"></iframe></div>

<!-- PhET simulations from the University of Colorado Boulder, free to embed: Share → Embed on any simulation's page. -->

---

## A 3D molecule you can turn (3Dmol.js)

<div class="sharp" style="height:470px;border:0"><iframe src="https://3dmol.org/viewer.html?pdb=1UBQ&style=cartoon:color~spectrum" title="Ubiquitin (PDB 1UBQ)" loading="lazy"></iframe></div>

Ubiquitin, PDB 1UBQ. Drag to rotate, scroll to zoom. Change `pdb=` to show another structure.

---

<style scoped>
.columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1em; align-items: start; }
</style>

## A graphing calculator and a map

<div class="columns">
<div>

<div class="sharp" style="height:440px"><iframe src="https://www.desmos.com/calculator" title="Desmos graphing calculator" loading="lazy"></iframe></div>

</div>
<div>

<div class="sharp" style="height:440px"><iframe src="https://www.openstreetmap.org/export/embed.html?bbox=-79.9495%2C40.4400%2C-79.9365%2C40.4470&layer=mapnik&marker=40.4433%2C-79.9436" title="Carnegie Mellon University on OpenStreetMap" loading="lazy"></iframe></div>

</div>
</div>

<!-- Any page that allows framing works the same way: Desmos, GeoGebra, Observable notebooks, Plotly or Bokeh HTML files, Jupyter-built widgets saved as HTML. Some sites refuse to be framed (they send X-Frame-Options); those show an empty box, so link to them instead. -->

---

## Animation without a file: inline SVG

<svg viewBox="0 0 600 600" style="display:block;height:430px;margin:0 auto">
  <ellipse cx="300" cy="300" rx="270" ry="80" fill="none" stroke="#9aa" stroke-width="3"/>
  <ellipse cx="300" cy="300" rx="270" ry="80" fill="none" stroke="#9aa" stroke-width="3" transform="rotate(60 300 300)"/>
  <ellipse cx="300" cy="300" rx="270" ry="80" fill="none" stroke="#9aa" stroke-width="3" transform="rotate(-60 300 300)"/>
  <circle cx="300" cy="300" r="34" fill="#c41230"/>
  <circle cx="30" cy="300" r="14" fill="#2a6ebb"><animateMotion dur="3s" repeatCount="indefinite" path="M0,0 a270,80 0 1,0 540,0 a270,80 0 1,0 -540,0"/></circle>
  <g transform="rotate(60 300 300)"><circle cx="30" cy="300" r="14" fill="#2a6ebb"><animateMotion dur="4s" repeatCount="indefinite" path="M0,0 a270,80 0 1,0 540,0 a270,80 0 1,0 -540,0"/></circle></g>
  <g transform="rotate(-60 300 300)"><circle cx="30" cy="300" r="14" fill="#2a6ebb"><animateMotion dur="5s" repeatCount="indefinite" path="M0,0 a270,80 0 1,0 540,0 a270,80 0 1,0 -540,0"/></circle></g>
</svg>

`<animateMotion>` in an `<svg>` written in the slide. An animated GIF works too: `![](spin.gif)`.

---

## What plays where

| | Present / HTML | `deck.html` (s) | PDF, PPTX |
|---|---|---|---|
| Movie and sound files | ✓ | ✓ inside the file | poster or blank |
| YouTube | opens on YouTube | opens on YouTube | blank box |
| Docs, web pages | ✓ online | ✓ online | blank box |
| Inline SVG, GIF | ✓ | ✓ | first frame |

- **s** in the slideshow saves one `deck.html` with the movies inside it, so it plays offline. Each movie is in it once, however often it is used: this deck comes to about 8 MB
- Click a slide outside a frame to get the arrow keys back after using it
- For a PDF handout, put the link under each embed

<!-- Movies in the HTML file are stored as base64, a third larger than the files. Keep long movies next to the deck and use Present, or shrink them first. A screen recording shrinks a lot at 15 frames a second: ffmpeg -i in.mp4 -vf scale=1280:-2,fps=15 -crf 30 -tune stillimage out.mp4 (this deck's movie went from 13 MB to 4.5 MB) -->
